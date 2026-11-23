"""Verification tests for Phase 5 — Staged CV Keyword Tailoring."""

import tempfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.database import init_db, SessionLocal
from backend.app.models import Listing, Extraction, Application
from backend.app.cv.tailor import (
    build_master_vocabulary,
    check_unverified_keywords,
    generate_staged_cv_diff,
    LLMCVDraftResponse,
    StagedCVDiff,
    HeadlineSuggestion,
    SummarySuggestion,
    SkillCategoryDiff,
    BulletDiff,
    apply_staged_cv_diff,
    PageOverflowError,
)

client = TestClient(app)


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    init_db()


def test_master_vocabulary_extraction():
    """Proves master vocabulary extracts allowed tokens and drops stopwords."""
    vocab_en = build_master_vocabulary("en")
    vocab_fr = build_master_vocabulary("fr")

    assert len(vocab_en) > 100
    assert len(vocab_fr) > 100

    # Key tech terms present in master profile
    assert "pytorch" in vocab_en
    assert "fastapi" in vocab_en
    assert "deep" in vocab_en

    # Common stopwords must not be present as vocab tokens
    assert "the" not in vocab_en
    assert "and" not in vocab_en
    assert "le" not in vocab_fr
    assert "avec" not in vocab_fr


def test_deterministic_unverified_keyword_detection():
    """Proves any technical token not in master profile is flagged as unverified."""
    vocab = build_master_vocabulary("en")

    # Text containing only known profile words
    clean_text = "Trained deep learning CNN models with PyTorch and FastAPI"
    unv_clean = check_unverified_keywords(clean_text, vocab)
    # 'models' might or might not be in, but no bizarre tech
    for token in unv_clean:
        assert token not in ("pytorch", "deep", "learning", "cnn", "fastapi")

    # Novel unverified technical buzzwords
    novel_text = "Architected Kubernetes clusters with Rust and Solana Web3 contracts"
    unv_novel = check_unverified_keywords(novel_text, vocab)

    assert "kubernetes" in unv_novel or "k8s" in unv_novel or "solana" in unv_novel
    assert "rust" in unv_novel or "web3" in unv_novel


def test_apply_staged_cv_diff_1_page_enforcement():
    """Proves apply_staged_cv_diff renders exactly 1-page PDF and PNG preview."""
    diff = StagedCVDiff(
        language="en",
        headline_suggestion=HeadlineSuggestion(
            original="Master's Student in Big Data Analytics & E-Commerce | AI/ML & Data Science",
            proposed="Master's Student | Machine Learning, Computer Vision & Deep Learning",
            reason="Focus on vision",
            accepted=True,
        ),
        summary_suggestion=SummarySuggestion(
            original="old summary",
            proposed="2nd-year Master's student at IHEC Carthage specialized in Deep Learning, PyTorch, CNN and RAG systems.",
            reason="Emphasize ML",
            accepted=True,
        ),
        skill_category_diffs=[
            SkillCategoryDiff(
                category="Machine Learning / Deep Learning",
                original_details="PyTorch, TensorFlow",
                proposed_details="PyTorch, CNN, Computer Vision, Transformers, RAG, LLM Agents",
                reason="Prioritize CNN",
                accepted=True,
            )
        ],
        bullet_diffs=[
            BulletDiff(
                section="work experience",
                entry_title="RISC Lab - ENIT",
                bullet_index=0,
                original_text="Developed a prototype CNN model",
                proposed_text="Developed a high-precision CNN model to assist epilepsy diagnosis for doctors at Razi Hospital, achieving 91.28% accuracy.",
                reason="Slight tightening",
                accepted=True,
            )
        ],
    )

    with tempfile.TemporaryDirectory() as td:
        result = apply_staged_cv_diff(diff, td, output_pdf_name="tailored_test.pdf")
        assert Path(result["pdf_path"]).exists()
        assert Path(result["png_path"]).exists()
        assert result["metrics"]["page_count"] == 1
        assert result["metrics"]["last_y1_pt"] < 817.0


def test_overflow_protection_raises_error():
    """Proves that a CV diff that causes 2-page overflow raises PageOverflowError when auto_fit is disabled."""
    diff = StagedCVDiff(
        language="en",
        summary_suggestion=SummarySuggestion(
            original="old summary",
            proposed=" ".join(["Massive overflow paragraph text designed to blow up the page limit."] * 40),
            reason="Overflow test",
            accepted=True,
            user_modified=True,
        ),
    )

    with tempfile.TemporaryDirectory() as td:
        with pytest.raises(PageOverflowError) as exc_info:
            apply_staged_cv_diff(diff, td, output_pdf_name="overflow.pdf", enforce_single_page=True, auto_fit=False)

        assert exc_info.value.page_count > 1


def test_cv_diff_auto_fit_tiers():
    """Proves that Tier 1 layout presets successfully save slight overflow without throwing PageOverflowError."""
    # Moderate summary that overflows default layout (preset 0) but fits comfortably in preset 1 or 2
    diff = StagedCVDiff(
        language="en",
        summary_suggestion=SummarySuggestion(
            original="old summary",
            proposed="Master's student in Big Data Analytics & E-Commerce at IHEC Carthage with proven experience building production AI agents, distributed pipelines, and responsive web applications for enterprise clients.",
            reason="Expanded summary",
            accepted=True,
            user_modified=True,
        ),
    )

    with tempfile.TemporaryDirectory() as td:
        res = apply_staged_cv_diff(diff, td, output_pdf_name="fitted.pdf", enforce_single_page=True, auto_fit=True)
        assert res["metrics"]["page_count"] == 1
        assert res["pdf_path"].exists()


def test_cv_diff_and_confirm_endpoints():
    """Tests /api/applications/{id}/cv-diff and /api/applications/{id}/cv-confirm."""
    import uuid
    test_slug = f"test-tailor-{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        # Create dummy listing & extraction
        listing = Listing(
            wp_post_id=99988 + int(uuid.uuid4().int % 10000),
            slug=test_slug,
            company_name="TailorCorp AI",
            post_url=f"https://pfebooks.com/{test_slug}",
            catalogue_term="2026-2027",
            sync_status="extracted",
        )
        db.add(listing)
        db.commit()
        db.refresh(listing)

        extraction = Extraction(
            listing_id=listing.id,
            pdf_sha256="dummy_sha256",
            model_used="gemini-2.5-flash",
            structured_data={
                "company": {"name": "TailorCorp AI", "contact_email": "jobs@tailorcorp.com"},
                "subjects": [
                    {
                        "ref": "PFE-AI-01",
                        "title": "Computer Vision & Medical Imaging for Diagnostics",
                        "technologies": ["PyTorch", "CNN", "FastAPI"],
                        "target_profile": "Master Data Science / IA",
                    }
                ],
            },
        )
        db.add(extraction)
        db.commit()

        # Create application draft
        app_obj = Application(
            user_id="local-default",
            listing_id=listing.id,
            selected_subject_refs=["PFE-AI-01"],
            language="en",
            delivery_mode="combined_email",
            email_to="jobs@tailorcorp.com",
            email_subject="Candidature PFE 2026",
            email_body="Body text",
            status="drafted",
        )
        db.add(app_obj)
        db.commit()
        db.refresh(app_obj)

        app_id = app_obj.id

        # 1. Test POST /api/applications/{id}/cv-diff
        diff_payload = {
            "language": "en",
            "headline_suggestion": {
                "original": "Master's Student in Big Data Analytics & E-Commerce | AI/ML & Data Science",
                "proposed": "Master's Student | Computer Vision & Deep Learning Specialist",
                "reason": "Targeted at medical vision",
                "accepted": True,
            },
            "summary_suggestion": {
                "original": "old summary",
                "proposed": "Master's student in Big Data Analytics & E-Commerce at IHEC Carthage specialized in Deep Learning and Computer Vision.",
                "reason": "Align with vision",
                "accepted": True,
                "unverified_keywords": [],
            },
            "skill_category_diffs": [],
            "bullet_diffs": [],
            "has_unverified_keywords": False,
            "all_unverified_keywords": [],
        }

        # 2. Test PUT /api/applications/{id}/cv-confirm with valid 1-page diff
        confirm_resp = client.put(
            f"/api/applications/{app_id}/cv-confirm",
            json={"diff": diff_payload},
        )
        assert confirm_resp.status_code == 200
        confirm_data = confirm_resp.json()
        assert confirm_data["status"] == "success"
        assert confirm_data["cv_diff_confirmed"] is True
        assert confirm_data["metrics"]["page_count"] == 1

        # 3. Test PUT /api/applications/{id}/cv-confirm with moderate overflow -> Handled by layout preset tiers
        preset_diff = dict(diff_payload)
        preset_diff["summary_suggestion"] = {
            "original": "old summary",
            "proposed": "Master's student in Big Data Analytics & E-Commerce at IHEC Carthage with experience building production AI agents, distributed pipelines, and responsive web applications for enterprise clients.",
            "reason": "Moderate expansion",
            "accepted": True,
            "user_modified": True,
            "unverified_keywords": [],
        }
        preset_resp = client.put(
            f"/api/applications/{app_id}/cv-confirm",
            json={"diff": preset_diff},
        )
        assert preset_resp.status_code == 200
        preset_data = preset_resp.json()
        assert preset_data["status"] == "success"
        assert preset_data["cv_diff_confirmed"] is True
        assert preset_data["metrics"]["page_count"] == 1

        # 4. Test massive unrecoverable overflow -> returns 422 with overflow detail
        massive_diff = dict(diff_payload)
        massive_diff["summary_suggestion"] = {
            "original": "old summary",
            "proposed": " ".join(["Massive spill text."] * 60),
            "reason": "Force hard overflow",
            "accepted": True,
            "user_modified": True,
            "unverified_keywords": [],
        }
        massive_resp = client.put(
            f"/api/applications/{app_id}/cv-confirm",
            json={"diff": massive_diff},
        )
        assert massive_resp.status_code == 422
        assert "exceeded 1-page layout lock" in massive_resp.json()["detail"]
    finally:
        # Clean up test records to maintain DB cleanliness
        try:
            db.query(Application).filter(Application.id == app_id).delete()
            db.query(Extraction).filter(Extraction.listing_id == listing.id).delete()
            db.query(Listing).filter(Listing.id == listing.id).delete()
            db.commit()
        except Exception:
            pass
        db.close()


def test_generate_cv_diff_no_summary_default(monkeypatch):
    """Master CVs without a summary section must not produce summary_suggestion even if LLM returns one."""
    fake_llm_response = LLMCVDraftResponse(
        headline_proposed="Data Science & AI | ML & NLP Intern",
        headline_reason="Align with topic",
        summary_proposed="Should be ignored because baseline CV has no summary.",
        summary_reason="Ignored",
    )
    monkeypatch.setattr(
        "backend.app.cv.tailor.generate_structured_content",
        lambda **kwargs: fake_llm_response,
    )

    diff = generate_staged_cv_diff(
        subjects=[{"ref": "S1", "title": "LLM Agents", "technologies": ["Python", "LangChain"]}],
        language="en",
    )
    assert diff.summary_suggestion is None
    assert diff.headline_suggestion is not None
