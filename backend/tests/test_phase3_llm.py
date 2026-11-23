"""Tests for Phase 3: Gemini extraction and profile matching schemas and caching."""

import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.database import SessionLocal, init_db
from backend.app.models import Listing, Extraction, SubjectMatch
from backend.app.llm.schemas import (
    SubjectItem,
    ApplicationRules,
    ListingExtraction,
    SubjectMatchResult,
    BatchMatchResponse,
)
from backend.app.llm.match import get_profile_hash, load_profile_yaml
from backend.app.llm.service import process_listing

client = TestClient(app)


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    init_db()


def test_schema_contracts():
    """Verify all Pydantic schemas enforce strict contracts."""
    rules = ApplicationRules(
        method="email",
        recipient_email="jobs@tech.tn",
        cc_emails=["hr@tech.tn"],
        subject_line_template="[PFE 2026] - {REF} - Nom",
        max_subjects_allowed=1,
        cover_letter_requested=True,
        required_documents=["cv", "cover_letter"],
        required_documents_raw=["CV", "Lettre de motivation"],
    )
    assert rules.method == "email"
    assert rules.cover_letter_requested is True

    subject = SubjectItem(
        ref="PFE-01",
        title="AI Agent Architecture",
        summary="Build autonomous agents using LangChain.",
        technologies=["Python", "FastAPI", "LangChain"],
        target_profile="Master Big Data",
        page_in_pdf=2,
    )
    assert subject.ref == "PFE-01"
    assert len(subject.technologies) == 3

    extraction = ListingExtraction(
        company_name="Tech Solutions",
        primary_language="fr",
        company_overview="Leading IT consultancy.",
        application_rules=rules,
        subjects=[subject],
        conflicts_with_description=["HTML stated 2 subjects, PDF has 1."],
    )
    dumped = extraction.model_dump()
    assert dumped["company_name"] == "Tech Solutions"
    assert len(dumped["subjects"]) == 1

    match = SubjectMatchResult(
        subject_ref="PFE-01",
        score=92,
        compatibility_tier="high",
        why_match="Candidate's extensive experience with LLM agents and FastAPI fits directly.",
        matched_skills=["Python", "FastAPI"],
        missing_gaps=["LangChain"],
    )
    batch = BatchMatchResponse(matches=[match])
    assert batch.matches[0].score == 92
    assert batch.matches[0].compatibility_tier == "high"


def test_profile_loader_and_hash():
    """Verify profile loading and hash stability."""
    profile_hash = get_profile_hash()
    assert isinstance(profile_hash, str)
    assert len(profile_hash) == 64

    yaml_fr = load_profile_yaml("fr")
    yaml_en = load_profile_yaml("en")
    assert "cv:" in yaml_fr
    assert "cv:" in yaml_en
    assert len(yaml_en) > 100


def test_database_cached_processing():
    """Verify that process_listing reuses cached results when files haven't changed."""
    db = SessionLocal()
    try:
        listing = db.query(Listing).filter(Listing.slug == "aquadeep").first()
        assert listing is not None, "aquadeep listing must exist"

        # Cached call should return immediately without API call
        ext, matches = process_listing(db, listing, force_extract=False, force_match=False)
        assert ext is not None
        assert ext.structured_data["company_name"] == "AquaDeep"
        assert len(matches) == 3

        # Verify best score is high
        best_score = max(m.score for m in matches)
        assert best_score >= 80
    finally:
        db.close()


def test_api_extraction_endpoints():
    """Verify GET and POST extraction API endpoints."""
    db = SessionLocal()
    try:
        listing = db.query(Listing).filter(Listing.slug == "pcp").first()
        assert listing is not None
        listing_id = listing.id
    finally:
        db.close()

    # GET extraction endpoint
    res = client.get(f"/api/listings/{listing_id}/extraction")
    assert res.status_code == 200
    data = res.json()
    assert data["extracted"] is True
    assert data["extraction"]["company_name"] == "Public Cloud Platform Consulting"
    assert len(data["matches"]) == 3

    # Check listings summary has match fields populated
    res_list = client.get("/api/listings")
    assert res_list.status_code == 200
    items = res_list.json()
    pcp_item = next(i for i in items if i["slug"] == "pcp")
    assert pcp_item["best_match_score"] is not None
    assert pcp_item["subject_count"] == 3


def test_compare_subjects_caching_and_persistence():
    """Verify compare-subjects caches in SQLite by refs+profile_hash and restores via GET extraction."""
    from unittest.mock import patch
    from backend.app.llm.schemas import TopicComparisonResponse, TopicComparisonItem
    from backend.app.models import SubjectComparison

    db = SessionLocal()
    try:
        listing = db.query(Listing).filter(Listing.slug == "pcp").first()
        assert listing is not None
        listing_id = listing.id
        refs = [s["ref"] for s in listing.extraction.structured_data["subjects"][:2]]
        db.query(SubjectComparison).filter(SubjectComparison.listing_id == listing_id).delete()
        db.commit()
    finally:
        db.close()

    mock_resp = TopicComparisonResponse(
        recommended_refs=[refs[0]],
        overall_verdict="Pick #1 for stronger thesis.",
        comparisons=[
            TopicComparisonItem(
                subject_ref=refs[0],
                rank=1,
                richness_verdict="Rich",
                thesis_potential="High",
                career_growth="Strong",
                pros=["Good stack"],
                cons=["None"],
            ),
            TopicComparisonItem(
                subject_ref=refs[1],
                rank=2,
                richness_verdict="Moderate",
                thesis_potential="Medium",
                career_growth="Fair",
                pros=["Simple"],
                cons=["Narrower"],
            ),
        ],
    )

    with patch("backend.app.llm.match.compare_listing_subjects", return_value=mock_resp) as mock_fn:
        # 1. First call -> cache miss
        r1 = client.post(f"/api/listings/{listing_id}/compare-subjects", json={"subject_refs": refs})
        assert r1.status_code == 200
        assert r1.json()["cached"] is False
        assert mock_fn.call_count == 1

        # 2. Second call with reversed refs -> cache hit
        r2 = client.post(f"/api/listings/{listing_id}/compare-subjects", json={"subject_refs": list(reversed(refs))})
        assert r2.status_code == 200
        assert r2.json()["cached"] is True
        assert r2.json()["overall_verdict"] == "Pick #1 for stronger thesis."
        assert mock_fn.call_count == 1

        # 3. GET extraction returns latest_comparison
        r_ext = client.get(f"/api/listings/{listing_id}/extraction")
        assert r_ext.status_code == 200
        latest = r_ext.json()["latest_comparison"]
        assert latest is not None
        assert latest["cached"] is True
        assert set(latest["subject_refs"]) == set(refs)

        # 4. Force re-compare -> calls LLM again
        r3 = client.post(
            f"/api/listings/{listing_id}/compare-subjects",
            json={"subject_refs": refs, "force": True},
        )
        assert r3.status_code == 200
        assert r3.json()["cached"] is False
        assert mock_fn.call_count == 2
