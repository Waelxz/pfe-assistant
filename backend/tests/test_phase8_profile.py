"""Unit tests for Phase 8: Profile & CV Studio schema, converters, and endpoints."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app.cv.profile_schema import (
    load_candidate_profile,
    compile_profile_to_yaml_dict,
    get_candidate_facts,
    CandidateProfile,
    CertificationItem,
    ExtracurricularItem,
)
from backend.app.cv.render import render_cv_pdf, verify_cv_layout, MAX_BOTTOM_Y1_PT


@pytest.fixture
def isolated_client(tmp_path: Path):
    """Sets up an isolated SQLite test database and TestClient."""
    db_file = tmp_path / "test_profile.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file}"

    from backend.app.database import init_db, get_db
    init_db()

    from backend.app.main import app
    client = TestClient(app)
    yield client


def test_load_candidate_profile_roundtrip():
    """Verifies that existing master profiles parse into CandidateProfile accurately."""
    prof_en = load_candidate_profile("en")
    assert prof_en.basics.name
    assert "@" in prof_en.basics.email
    assert len(prof_en.work_experience) >= 1
    assert len(prof_en.skills) >= 1

    facts_en = get_candidate_facts(prof_en)
    assert facts_en["name"] == prof_en.basics.name
    assert facts_en["email"] == prof_en.basics.email

    prof_fr = load_candidate_profile("fr")
    assert prof_fr.basics.name
    assert len(prof_fr.work_experience) >= 1
    assert len(prof_fr.skills) >= 1


def test_compile_and_render_1_page(tmp_path: Path):
    """Verifies that compiling a CandidateProfile back to RenderCV YAML renders exactly 1 page."""
    import yaml

    prof_en = load_candidate_profile("en")
    doc_dict = compile_profile_to_yaml_dict(prof_en, "en")

    yaml_file = tmp_path / "compiled_master.en.yaml"
    yaml_file.write_text(yaml.safe_dump(doc_dict, sort_keys=False, allow_unicode=True), encoding="utf-8")

    pdf_path = render_cv_pdf(yaml_file, tmp_path, output_name="test_en.pdf", enforce_single_page=True)
    metrics = verify_cv_layout(pdf_path)
    assert metrics["page_count"] == 1
    assert metrics["last_y1_pt"] <= MAX_BOTTOM_Y1_PT


def test_optional_sections_serialization(tmp_path: Path):
    """Verifies that optional sections appear in compiled YAML only when non-empty."""
    import yaml

    prof = load_candidate_profile("en")
    # Empty optional sections
    prof.certifications = []
    prof.extracurricular = []
    d_empty = compile_profile_to_yaml_dict(prof, "en")
    sections_empty = d_empty["cv"]["sections"]
    assert "certifications" not in sections_empty
    assert "extracurricular" not in sections_empty

    # Populated optional sections
    prof.certifications = [
        CertificationItem(name="AWS Certified Solutions Architect", issuer="AWS", date="2025-05")
    ]
    prof.extracurricular = [
        ExtracurricularItem(organization="AI Student Club", role="Lead Organizer", highlights=["Led 3 workshops"])
    ]
    d_populated = compile_profile_to_yaml_dict(prof, "en")
    sections_pop = d_populated["cv"]["sections"]
    assert "certifications" in sections_pop
    assert "extracurricular" in sections_pop
    assert len(sections_pop["certifications"]) == 1
    assert len(sections_pop["extracurricular"]) == 1


def test_get_profile_endpoint(isolated_client: TestClient):
    """Tests GET /api/profile endpoint returns both profiles and layout status."""
    resp = isolated_client.get("/api/profile")
    assert resp.status_code == 200
    data = resp.json()
    assert "en" in data
    assert "fr" in data
    assert "metrics" in data
    assert data["en"]["basics"]["name"]
    assert data["fr"]["basics"]["name"]
    assert data["profile_hash"] is not None


def test_preview_draft_endpoint(isolated_client: TestClient):
    """Tests POST /api/profile/preview-draft/en renders draft without modifying master YAML."""
    prof_en = load_candidate_profile("en")
    payload = prof_en.model_dump()
    resp = isolated_client.post("/api/profile/preview-draft/en", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert data["page_count"] == 1
    assert data["valid_1_page"] is True
    assert "pdf_url" in data


def test_ats_normalization_and_locale_defaults(tmp_path: Path):
    """Verifies deterministic 90+ Resume Worded / ATS rules on arbitrary profiles."""
    from backend.app.cv.profile_schema import (
        ProfileBasics,
        ExperienceItem,
        ProjectItem,
        EducationItem,
        SkillCategoryItem,
        normalize_profile_for_ats,
    )

    raw_prof = CandidateProfile(
        language="en",
        basics=ProfileBasics(
            name="Alex Rough",
            email="alex@example.com",
            phone="+216 20 000 000",
            location="Tunis, Tunisia",
            linkedin="https://www.linkedin.com/in/alex-rough/",
            github="https://github.com/alexrough",
        ),
        headline="Data Science | Master's Student",
        summary="",
        work_experience=[
            ExperienceItem(
                company="Acme",
                position="Intern | Python & SQL",
                start_date="2024-06",
                end_date="présent",
                location="Tunis",
                highlights=["Built an ETL pipeline."],
            )
        ],
        projects=[
            ProjectItem(
                name="Side Project (Python)",
                date="2025-11",
                highlights=["Implemented a CLI tool."],
            )
        ],
        education=[
            EducationItem(
                institution="Univ",
                degree="Master's",
                area="CS",
                start_date="2025-09",
                end_date="2028-06",
                location="Tunis",
            )
        ],
        skills=[SkillCategoryItem(label="Languages", details="Python, SQL")],
    )

    norm = normalize_profile_for_ats(raw_prof)
    assert norm.basics.phone == "+216 20000000"
    assert norm.basics.linkedin == "alex-rough"
    assert norm.basics.github == "alexrough"
    assert norm.work_experience[0].end_date == "present"
    assert norm.education[0].end_date == "present"
    assert norm.projects[0].date is None

    # Compiling with a non-existent base YAML must inject 3-letter EN months & zero hyphenation
    compiled = compile_profile_to_yaml_dict(raw_prof, "en", base_yaml_path=tmp_path / "missing.yaml")
    assert compiled["design"]["typography"]["alignment"] == "justified-with-no-hyphenation"
    assert compiled["locale"]["month_abbreviations"] == [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ]
    assert compiled["cv"]["phone"] == "+216 20000000"


def test_profile_optimize_endpoint(isolated_client: TestClient, monkeypatch):
    """Tests POST /api/profile/optimize loads profile_optimize prompt and normalizes response."""
    from backend.app.cv.profile_schema import ProfileOptimizeResponse
    from backend.app.llm.prompts.loader import load_job_prompt

    spec = load_job_prompt("profile_optimize")
    assert spec.name == "profile_optimize"
    assert spec.output_schema == "ProfileOptimizeResponse"

    prof_en = load_candidate_profile("en")
    prof_en.basics.phone = "+216 20 000 000"

    def fake_generate(**kwargs):
        return ProfileOptimizeResponse(
            profile=prof_en,
            improvements=["Removed summary paragraph", "Replaced weak verbs"],
        )

    monkeypatch.setattr("backend.app.llm.client.generate_structured_content", fake_generate)

    resp = isolated_client.post(
        "/api/profile/optimize",
        json={"lang": "en", "profile": prof_en.model_dump()},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert data["profile"]["basics"]["phone"] == "+216 20000000"
    assert len(data["improvements"]) == 2
