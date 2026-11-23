"""Profile matching module evaluating candidate fit against PFE subjects using structured LLM prompts."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from backend.app.config import get_settings
from backend.app.llm.client import generate_structured_content, DEFAULT_MODEL
from backend.app.llm.prompts.loader import load_job_prompt
from backend.app.llm.schemas import (
    SubjectItem,
    SubjectMatchResult,
    BatchMatchResponse,
    TopicComparisonResponse,
)


def get_profile_hash() -> str:
    """Compute SHA256 hash of active profile's master YAMLs and career_goals.json."""
    from backend.app.cv.profiles import get_active_profile_dir
    pdir = get_active_profile_dir()
    en_path = pdir / "master.en.yaml"
    fr_path = pdir / "master.fr.yaml"
    goals_path = pdir / "career_goals.json"

    content = ""
    if en_path.exists():
        content += en_path.read_text(encoding="utf-8")
    if fr_path.exists():
        content += fr_path.read_text(encoding="utf-8")
    if goals_path.exists():
        content += goals_path.read_text(encoding="utf-8")

    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def load_profile_yaml(language: str = "fr") -> str:
    """Load the active candidate's master profile YAML for matching/drafting."""
    from backend.app.cv.profiles import get_active_profile_dir
    pdir = get_active_profile_dir()
    lang = "fr" if language.lower().startswith("fr") else "en"
    path = pdir / f"master.{lang}.yaml"
    if not path.exists():
        other = "en" if lang == "fr" else "fr"
        path = pdir / f"master.{other}.yaml"
    return path.read_text(encoding="utf-8") if path.exists() else ""


MATCH_CHUNK_SIZE = 15


def _call_match_batch(
    subjects: list[SubjectItem],
    language: str,
    profile_yaml: str,
    candidate_name: str,
    goals: object,
    active_model: str,
    spec: object,
) -> dict[str, SubjectMatchResult]:
    """Run one batched LLM match call for a chunk of subjects."""
    subjects_payload = [
        {
            "ref": s.ref,
            "title": s.title,
            "summary": s.summary,
            "technologies": s.technologies,
            "target_profile": s.target_profile,
        }
        for s in subjects
    ]

    user_prompt = f"""<candidate_profile language="{language.upper()}">
{profile_yaml}
</candidate_profile>

<career_goals>
Target Roles: {goals.target_roles}
Tech to Learn: {goals.tech_to_learn}
Dealbreakers / Low-Interest Work: {goals.dealbreakers}
PFE Priorities: {goals.pfe_priorities}
</career_goals>

<subjects>
{json.dumps(subjects_payload, indent=2, ensure_ascii=False)}
</subjects>

<task>
Evaluate EVERY subject in this list against candidate {candidate_name}'s profile AND career goals.
Return both:
1. Profile Fit (`score` 0-100, `compatibility_tier`, `why_match`, `matched_skills`, `missing_gaps`)
2. Topic Value & Richness (`interest_score` 0-100, `interest_tier`, `why_interesting`)
</task>
"""

    batch_response = generate_structured_content(
        contents=user_prompt,
        response_schema=BatchMatchResponse,
        model=active_model,
        temperature=spec.temperature if spec.temperature is not None else 0.1,
        system_instruction=spec.system_prompt,
    )

    if not batch_response.matches:
        raise ValueError(f"LLM failed to return batched subject matches from {active_model}.")

    return {m.subject_ref: m for m in batch_response.matches}


def match_listing_subjects(
    subjects: list[SubjectItem],
    language: str = "fr",
    model: str | None = None,
) -> list[SubjectMatchResult]:
    """Score all subjects of a listing against the candidate's profile in chunked batched calls."""
    if not subjects:
        return []

    settings = get_settings()
    active_model = model or settings.get_model_for_job("match") or DEFAULT_MODEL
    spec = load_job_prompt("match")

    profile_yaml = load_profile_yaml(language)
    try:
        from backend.app.cv.profile_schema import load_candidate_profile, load_career_goals
        candidate_name = load_candidate_profile(language).basics.name
        goals = load_career_goals()
    except Exception:
        candidate_name = "Candidate"
        from backend.app.cv.profile_schema import CareerGoals
        goals = CareerGoals()

    match_dict: dict[str, SubjectMatchResult] = {}
    for i in range(0, len(subjects), MATCH_CHUNK_SIZE):
        chunk = subjects[i : i + MATCH_CHUNK_SIZE]
        match_dict.update(
            _call_match_batch(
                chunk, language, profile_yaml, candidate_name, goals, active_model, spec
            )
        )

    missing_subjects = [s for s in subjects if s.ref not in match_dict]
    if missing_subjects:
        try:
            match_dict.update(
                _call_match_batch(
                    missing_subjects, language, profile_yaml, candidate_name, goals, active_model, spec
                )
            )
        except Exception:
            pass

    results: list[SubjectMatchResult] = []

    for s in subjects:
        if s.ref in match_dict:
            m = match_dict[s.ref]
            fit_sum = m.fit_domain + m.fit_stack + m.fit_academic + m.fit_deliverable
            if fit_sum > 0:
                m.score = min(100, max(0, fit_sum))
            rich_sum = m.richness_career + m.richness_thesis + m.richness_market
            if rich_sum > 0:
                capped = rich_sum
                if m.is_dealbreaker:
                    capped = min(capped, 35)
                elif m.is_vague_brief:
                    capped = min(capped, 65)
                elif 0 <= m.interest_score < capped and (m.interest_score <= 35 or m.interest_score == 65):
                    capped = m.interest_score
                m.interest_score = min(100, max(0, capped))
            m.compatibility_tier = (
                "high" if m.score >= 70 else ("medium" if m.score >= 40 else "low")
            )
            m.interest_tier = (
                "high" if m.interest_score >= 70 else ("medium" if m.interest_score >= 40 else "low")
            )
            results.append(m)
        else:
            # Fallback in case of missing ref even after retry
            results.append(
                SubjectMatchResult(
                    subject_ref=s.ref,
                    score=30,
                    compatibility_tier="low",
                    why_match="Evaluation pending detailed review.",
                    interest_score=30,
                    interest_tier="low",
                    why_interesting="Evaluation pending detailed review.",
                    matched_skills=[],
                    missing_gaps=[],
                )
            )

    return results


def compare_listing_subjects(
    subjects: list[SubjectItem],
    language: str = "fr",
    model: str | None = None,
) -> TopicComparisonResponse:
    """Head-to-head comparison of 2+ shortlisted subjects against CV + CareerGoals."""
    if len(subjects) < 2:
        raise ValueError("At least 2 subjects are required for head-to-head comparison.")

    settings = get_settings()
    active_model = model or settings.get_model_for_job("match") or DEFAULT_MODEL
    spec = load_job_prompt("compare")

    profile_yaml = load_profile_yaml(language)
    try:
        from backend.app.cv.profile_schema import load_career_goals
        goals = load_career_goals()
    except Exception:
        from backend.app.cv.profile_schema import CareerGoals
        goals = CareerGoals()

    subjects_payload = [
        {
            "ref": s.ref,
            "title": s.title,
            "summary": s.summary,
            "technologies": s.technologies,
            "target_profile": s.target_profile,
        }
        for s in subjects
    ]

    user_prompt = f"""<candidate_profile language="{language.upper()}">
{profile_yaml}
</candidate_profile>

<career_goals>
Target Roles: {goals.target_roles}
Tech to Learn: {goals.tech_to_learn}
Dealbreakers / Low-Interest Work: {goals.dealbreakers}
PFE Priorities: {goals.pfe_priorities}
</career_goals>

<subjects>
{json.dumps(subjects_payload, indent=2, ensure_ascii=False)}
</subjects>

<task>
Compare these {len(subjects)} shortlisted PFE topics head-to-head and rank them from best (1) to least recommended.
</task>
"""

    return generate_structured_content(
        contents=user_prompt,
        response_schema=TopicComparisonResponse,
        model=active_model,
        temperature=spec.temperature if spec.temperature is not None else 0.2,
        system_instruction=spec.system_prompt,
    )
