"""Unit tests for Phase 7.6 LLM prompt loader, multi-provider config, and template helpers."""

import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
from backend.app.config import Settings
from backend.app.llm.prompts.loader import load_job_prompt, get_prompt_hash
from backend.app.llm.client import prepare_pdf_input
from backend.app.draft import (
    apply_subject_line_template,
    DraftResponse,
    is_synthetic_ref,
    is_bare_numeric_ref,
)
from backend.app.llm.schemas import (
    ListingExtraction,
    BatchMatchResponse,
    SubjectItem,
    ApplicationRules,
    SubjectMatchResult,
)
from backend.app.cv.tailor import LLMCVDraftResponse, LLMSkillChange, LLMBulletChange


def test_load_all_job_prompts():
    """Verify all 4 job prompts load cleanly from markdown with valid frontmatter."""
    jobs = ["extract", "match", "draft", "tailor"]
    expected_schemas = {
        "extract": "ListingExtraction",
        "match": "BatchMatchResponse",
        "draft": "DraftResponse",
        "tailor": "LLMCVDraftResponse",
    }

    for job in jobs:
        spec = load_job_prompt(job)
        assert spec.name == job
        assert len(spec.system_prompt.strip()) > 50
        assert 0.0 <= spec.temperature <= 1.0
        assert spec.output_schema == expected_schemas[job]

        prompt_hash = get_prompt_hash(job)
        assert len(prompt_hash) == 64
        # Cache check: repeated calls return same hash
        assert get_prompt_hash(job) == prompt_hash


def test_apply_subject_line_template():
    """Verify template replacements and fallback behavior."""
    # Custom template with various placeholders
    template = "Candidature PFE 2026 - {REF} - {TITLE} - {CANDIDATE_NAME} - {COMPANY}"
    result = apply_subject_line_template(
        template=template,
        ref="DS-01",
        title="ML Engineer Intern",
        company="Actia",
        candidate_name="Alex Doe",
    )
    assert result == "Candidature PFE 2026 - DS-01 - ML Engineer Intern - Alex Doe - Actia"

    # Fallback when template is empty
    default_result = apply_subject_line_template(
        template=None,
        ref="DS-02",
        title="Data Engineer",
        company="Vermeg",
        candidate_name="Alex Doe",
    )
    assert "DS-02" in default_result
    assert "Alex Doe" in default_result
    assert "Data Engineer" in default_result

    # Missing placeholder keys handled gracefully
    partial_template = "Application: {REF} at {COMPANY}"
    partial_result = apply_subject_line_template(
        template=partial_template,
        ref="AI-09",
        title="Agentic AI",
        company="Google",
    )
    assert partial_result == "Application: AI-09 at Google"

    # Synthetic reference detection and suppression
    assert is_synthetic_ref("SUBJ-01") is True
    assert is_synthetic_ref("SUBJ-42") is True
    assert is_synthetic_ref("subj-10") is True
    assert is_synthetic_ref("WEB-01") is False
    assert is_synthetic_ref("PFE-01") is False
    assert is_synthetic_ref("18") is False
    assert is_synthetic_ref(None) is False

    assert is_bare_numeric_ref("18") is True
    assert is_bare_numeric_ref("01") is True
    assert is_bare_numeric_ref("SUBJ-01") is False
    assert is_bare_numeric_ref("WEB-01") is False

    # Synthetic reference with NO template: must use project title and never leak SUBJ-42
    synth_result = apply_subject_line_template(
        template=None,
        ref="SUBJ-42",
        title="Efficacité thermique et énergétique",
        company="Fayat Bâtiment",
        candidate_name="Alex Doe",
        language="fr",
    )
    assert "SUBJ-42" not in synth_result
    assert "Efficacité thermique et énergétique" in synth_result
    assert synth_result == "Candidature PFE 2027 – Alex Doe – Efficacité thermique et énergétique"

    # Synthetic reference WITH company template: {REF} becomes title
    tmpl_synth = apply_subject_line_template(
        template="PFE {REF}",
        ref="SUBJ-42",
        title="Efficacité thermique et énergétique",
        company="Fayat Bâtiment",
        candidate_name="Alex Doe",
        language="fr",
    )
    assert "SUBJ-42" not in tmpl_synth
    assert tmpl_synth == "PFE Efficacité thermique et énergétique"

    # Bare numeric reference with title
    bare_result = apply_subject_line_template(
        template=None,
        ref="18",
        title="Application multi-agents",
        company="Capgemini",
        candidate_name="Alex Doe",
        language="fr",
    )
    assert "Sujet 18 : Application multi-agents" in bare_result

    # Multiple subjects (default and templated)
    multi_default = apply_subject_line_template(
        template=None,
        subjects=[
            {"ref": "SUBJ-01", "title": "RAG Pipeline"},
            {"ref": "SUBJ-02", "title": "Computer Vision"},
        ],
        language="en",
    )
    assert "RAG Pipeline" in multi_default
    assert "Computer Vision" in multi_default
    assert "SUBJ-" not in multi_default

    multi_tmpl = apply_subject_line_template(
        template="Candidature PFE - {REF} - {NOM}",
        subjects=[
            {"ref": "PFE-01", "title": "NLP"},
            {"ref": "PFE-02", "title": "MLOps"},
        ],
        nom="Dridi",
        language="fr",
    )
    assert multi_tmpl == "Candidature PFE - PFE-01, PFE-02 - Dridi"


def test_schema_field_descriptions():
    """Verify core LLM Pydantic schemas include docstrings/descriptions for LLM guidance."""
    schemas = [
        ListingExtraction,
        SubjectItem,
        ApplicationRules,
        BatchMatchResponse,
        SubjectMatchResult,
        DraftResponse,
        LLMCVDraftResponse,
        LLMSkillChange,
        LLMBulletChange,
    ]
    for schema_cls in schemas:
        schema_dict = schema_cls.model_json_schema()
        assert "properties" in schema_dict
        properties = schema_dict["properties"]
        # Ensure at least half the fields have explicit descriptions
        described = [k for k, v in properties.items() if "description" in v]
        assert len(described) >= len(properties) // 2


def test_settings_model_resolution():
    """Verify per-job LLM model selection logic."""
    settings = Settings(
        llm_model="gemini-2.5-flash",
        llm_fallback_model="gemini-1.5-pro",
        llm_model_tailor="gemini-1.5-pro",
    )
    assert settings.get_model_for_job("extract") == "gemini-2.5-flash"
    assert settings.get_model_for_job("match") == "gemini-2.5-flash"
    assert settings.get_model_for_job("draft") == "gemini-2.5-flash"
    assert settings.get_model_for_job("tailor") == "gemini-1.5-pro"


def test_prepare_pdf_input_gemini_mode(tmp_path):
    """Verify prepare_pdf_input delegates to upload_pdf_cached in Gemini mode."""
    import pymupdf
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((50, 50), "PFE Subject: Big Data Pipeline\nTechnologies: Spark, Kafka")
    pdf_path = tmp_path / "test_booklet.pdf"
    doc.save(str(pdf_path))
    doc.close()

    mock_uploaded = MagicMock()
    mock_uploaded.name = "files/test_file_id"

    with patch("backend.app.llm.client.get_settings") as mock_settings, \
         patch("backend.app.llm.client.upload_pdf_cached", return_value=mock_uploaded) as mock_upload:
        mock_settings.return_value = Settings(llm_provider="gemini")
        result = prepare_pdf_input(pdf_path)
        assert result == mock_uploaded
        mock_upload.assert_called_once_with(pdf_path, cache_key=None)


def test_prepare_pdf_input_openai_mode(tmp_path):
    """Verify prepare_pdf_input extracts text pages or images in OpenAI/fallback mode."""
    import pymupdf

    # Case 1: Adequate text (>= 100 chars) -> returns page string
    doc_text = pymupdf.open()
    page1 = doc_text.new_page()
    page1.insert_text((50, 50), "PFE Internship Booklet 2026.\n" + ("Detailed project description and requirements. " * 5))
    pdf_text_path = tmp_path / "test_booklet_text.pdf"
    doc_text.save(str(pdf_text_path))
    doc_text.close()

    with patch("backend.app.llm.client.get_settings") as mock_settings:
        mock_settings.return_value = Settings(llm_provider="openai_compatible")
        result_str = prepare_pdf_input(pdf_text_path)
        assert isinstance(result_str, str)
        assert "=== PAGE 1 ===" in result_str
        assert "PFE Internship Booklet" in result_str

    # Case 2: Low text / scanned document (< 100 chars) -> returns base64 images
    doc_img = pymupdf.open()
    page2 = doc_img.new_page()
    page2.insert_text((50, 50), "Short text")
    pdf_img_path = tmp_path / "test_booklet_img.pdf"
    doc_img.save(str(pdf_img_path))
    doc_img.close()

    with patch("backend.app.llm.client.get_settings") as mock_settings:
        mock_settings.return_value = Settings(llm_provider="openai_compatible")
        result_imgs = prepare_pdf_input(pdf_img_path)
        assert isinstance(result_imgs, list)
        assert len(result_imgs) == 1
        assert result_imgs[0]["type"] == "image_url"
        assert result_imgs[0]["image_url"]["url"].startswith("data:image/jpeg;base64,")


def test_career_goals_and_compare_prompt(tmp_path, monkeypatch):
    """Verify CareerGoals sidecar persistence, compare.md loading, and dual-score matching."""
    from backend.app.cv.profile_schema import CareerGoals, load_career_goals, save_career_goals
    from backend.app.llm.prompts.loader import load_job_prompt
    from backend.app.llm.match import match_listing_subjects, compare_listing_subjects
    from backend.app.llm.schemas import (
        SubjectItem,
        SubjectMatchResult,
        BatchMatchResponse,
        TopicComparisonItem,
        TopicComparisonResponse,
    )

    goals = CareerGoals(
        target_roles="Agentic AI, Data Engineering",
        tech_to_learn="Databricks, Spark, LangGraph",
        dealbreakers="Basic CRUD",
        pfe_priorities="Strong thesis depth",
    )
    save_career_goals(goals, profile_dir=tmp_path)
    loaded = load_career_goals(profile_dir=tmp_path)
    assert "Databricks" in loaded.tech_to_learn
    assert loaded.dealbreakers == "Basic CRUD"

    compare_spec = load_job_prompt("compare")
    assert compare_spec.name == "compare"
    assert "richness_verdict" in compare_spec.system_prompt

    subjs = [
        SubjectItem(ref="T-1", title="Databricks Lakehouse + RAG", summary="Build lakehouse & agentic RAG", technologies=["Databricks", "Spark", "LangGraph"], target_profile="Master's in Data Science"),
        SubjectItem(ref="T-2", title="Admin CRUD Portal", summary="Basic dashboard", technologies=["React", "SQL"], target_profile="Software Engineering"),
    ]

    fake_batch = BatchMatchResponse(
        matches=[
            SubjectMatchResult(
                subject_ref="T-1",
                score=80,
                compatibility_tier="high",
                why_match="Strong RAG overlap.",
                interest_score=94,
                interest_tier="high",
                why_interesting="Hits Databricks + LangGraph goals with rich architecture.",
            ),
            SubjectMatchResult(
                subject_ref="T-2",
                score=85,
                compatibility_tier="high",
                why_match="Familiar web stack.",
                interest_score=25,
                interest_tier="low",
                why_interesting="Basic CRUD work; low thesis richness.",
            ),
        ]
    )
    monkeypatch.setattr("backend.app.llm.match.generate_structured_content", lambda **kw: fake_batch)
    res = match_listing_subjects(subjs, language="en")
    assert len(res) == 2
    assert res[0].interest_score == 94
    assert res[1].interest_tier == "low"

    fake_cmp = TopicComparisonResponse(
        recommended_refs=["T-1", "T-2"],
        overall_verdict="Pick T-1 for rich Databricks + RAG engineering.",
        comparisons=[
            TopicComparisonItem(
                subject_ref="T-1",
                rank=1,
                richness_verdict="High architecture depth.",
                thesis_potential="Strong metrics.",
                career_growth="Adds Databricks & Spark.",
                pros=["Databricks"],
                cons=["Steep ramp-up"],
            )
        ],
    )
    monkeypatch.setattr("backend.app.llm.match.generate_structured_content", lambda **kw: fake_cmp)
    cmp_res = compare_listing_subjects(subjs, language="en")
    assert cmp_res.recommended_refs == ["T-1", "T-2"]


def test_match_subscore_summation_and_v3_prompt(monkeypatch):
    """Verify sub-scores sum deterministically in Python and match.md v3 rules are loaded."""
    from backend.app.llm.match import match_listing_subjects
    from backend.app.llm.prompts.loader import load_job_prompt
    from backend.app.llm.schemas import BatchMatchResponse, SubjectItem, SubjectMatchResult

    spec = load_job_prompt("match")
    assert spec.version == 3
    assert "fit_domain" in spec.system_prompt
    assert "richness_career" in spec.system_prompt
    assert "Industrial/Physical Domain Curve Penalty" in spec.system_prompt

    subjs = [
        SubjectItem(ref="S-1", title="RO Optimization", summary="ML + RO fouling", technologies=["Python"], target_profile="Data Science")
    ]
    # Intentionally pass mismatched holistic scores (99/99) to ensure sub-scores win
    fake_batch = BatchMatchResponse(
        matches=[
            SubjectMatchResult(
                subject_ref="S-1",
                fit_domain=32,
                fit_stack=22,
                fit_academic=13,
                fit_deliverable=8,
                score=99,
                compatibility_tier="high",
                why_match="+ PyTorch & time-series CNN proven; - No RO membrane/fouling domain (-10 domain)",
                richness_career=26,
                richness_thesis=32,
                richness_market=20,
                interest_score=99,
                interest_tier="high",
                why_interesting="+ Quantitative ML thesis metrics; - Niche industrial domain",
            )
        ]
    )
    monkeypatch.setattr("backend.app.llm.match.generate_structured_content", lambda **kw: fake_batch)
    res = match_listing_subjects(subjs, language="en")
    assert res[0].score == 75
    assert res[0].compatibility_tier == "high"
    assert res[0].interest_score == 78
    assert res[0].interest_tier == "high"


def test_match_caps_chunking_retry_and_breakdown(monkeypatch):
    """Verify deterministic caps, >15 chunking, missing-ref retry, and score_breakdown builder."""
    from backend.app.llm.match import match_listing_subjects
    from backend.app.llm.service import build_subject_match_row
    from backend.app.llm.schemas import BatchMatchResponse, SubjectItem, SubjectMatchResult

    subjs = [
        SubjectItem(
            ref=f"S-{i}",
            title=f"Topic {i}",
            summary="Work",
            technologies=["Python"],
            target_profile="Unspecified",
        )
        for i in range(18)
    ]

    calls: list[list[str]] = []

    def fake_gen(**kw):
        import json as _json
        prompt = kw["contents"]
        raw_subjs = _json.loads(prompt.split("<subjects>\n")[1].split("\n</subjects>")[0])
        refs = [item["ref"] for item in raw_subjs]
        calls.append(refs)
        # Drop S-0 on first call to exercise missing-ref retry
        if len(calls) == 1:
            refs = [r for r in refs if r != "S-0"]
        matches = []
        for r in refs:
            if r == "S-0":
                matches.append(
                    SubjectMatchResult(
                        subject_ref=r,
                        fit_domain=35,
                        fit_stack=20,
                        fit_academic=9,
                        fit_deliverable=7,
                        score=71,
                        compatibility_tier="high",
                        why_match="+ Python; - Unspecified degree",
                        richness_career=25,
                        richness_thesis=25,
                        richness_market=20,
                        interest_score=70,
                        interest_tier="high",
                        why_interesting="+ Dealbreaker CRUD; - Low depth",
                        is_dealbreaker=True,
                    )
                )
            elif r == "S-1":
                matches.append(
                    SubjectMatchResult(
                        subject_ref=r,
                        fit_domain=30,
                        fit_stack=20,
                        fit_academic=9,
                        fit_deliverable=6,
                        score=65,
                        compatibility_tier="medium",
                        why_match="+ Python; - Vague brief",
                        richness_career=25,
                        richness_thesis=25,
                        richness_market=20,
                        interest_score=70,
                        interest_tier="high",
                        why_interesting="+ Generic Python; - Vague brief",
                        is_vague_brief=True,
                    )
                )
            else:
                matches.append(
                    SubjectMatchResult(
                        subject_ref=r,
                        fit_domain=30,
                        fit_stack=20,
                        fit_academic=9,
                        fit_deliverable=6,
                        score=65,
                        compatibility_tier="medium",
                        why_match="+ Python; - Gap",
                        richness_career=20,
                        richness_thesis=20,
                        richness_market=15,
                        interest_score=55,
                        interest_tier="medium",
                        why_interesting="+ Transferable; - Moderate",
                    )
                )
        return BatchMatchResponse(matches=matches)

    monkeypatch.setattr("backend.app.llm.match.generate_structured_content", fake_gen)
    res = match_listing_subjects(subjs, language="en")

    assert len(res) == 18
    # 15 + 3 chunking + 1 retry for S-0
    assert len(calls) == 3
    assert calls[2] == ["S-0"]
    assert res[0].interest_score == 35
    assert res[0].interest_tier == "low"
    assert res[1].interest_score == 65
    assert res[1].interest_tier == "medium"

    orm_row = build_subject_match_row(res[0], listing_id=1, user_id="u1", profile_hash="abc")
    assert orm_row.score_breakdown == {
        "fit": {"domain": 35, "stack": 20, "academic": 9, "deliverable": 7},
        "richness": {"career": 25, "thesis": 25, "market": 20},
    }
