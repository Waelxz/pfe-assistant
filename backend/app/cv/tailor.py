"""Staged CV Keyword Tailoring Engine.

Generates structured diffs against master profile YAMLs, verifies keywords against
master profile vocabulary, and enforces the 1-page CV layout lock before PDF emission.
"""

from __future__ import annotations

import re
import tempfile
from pathlib import Path
from typing import Any, Literal
import yaml
from pydantic import BaseModel, Field

from google.genai import types
from backend.app.config import get_settings
from backend.app.llm.client import generate_structured_content, DEFAULT_MODEL
from backend.app.llm.prompts.loader import load_job_prompt
from backend.app.cv.render import render_cv_pdf, render_pdf_to_png, verify_cv_layout, PageOverflowError

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
PROFILE_DIR = REPO_ROOT / "profile"

# Stopwords to exclude when extracting vocabulary tokens
BASE_STOPWORDS = {
    # English stopwords
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
    "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
    "but", "by", "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does",
    "doesn't", "doing", "don't", "down", "during", "each", "few", "for", "from", "further", "had",
    "hadn't", "has", "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
    "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i", "i'd",
    "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself",
    "let's", "me", "more", "most", "mustn't", "my", "myself", "no", "nor", "not", "of", "off",
    "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own",
    "same", "shan't", "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such",
    "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then", "there",
    "there's", "these", "they", "they'd", "they'll", "they're", "they've", "this", "those", "through",
    "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're",
    "we've", "were", "weren't", "what", "what's", "when", "when's", "where", "where's", "which",
    "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you",
    "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves",
    # French stopwords
    "au", "aux", "avec", "ce", "ces", "dans", "de", "des", "du", "elle", "en", "et", "eux", "il",
    "ils", "je", "la", "le", "les", "leur", "lui", "ma", "mais", "me", "même", "mes", "moi", "mon",
    "ne", "nos", "notre", "nous", "on", "ou", "par", "pas", "pour", "qu", "que", "qui", "sa", "se",
    "ses", "son", "sur", "ta", "te", "tes", "toi", "ton", "tu", "un", "une", "vos", "votre", "vous",
    "c", "d", "j", "l", "m", "n", "s", "t", "y", "été", "étée", "étées", "étés", "étant", "étante",
    "étants", "étantes", "suis", "es", "est", "sommes", "êtes", "sont", "serai", "seras", "sera",
    "serons", "serez", "seront", "serais", "serait", "serions", "seriez", "seraient", "étais",
    "était", "étions", "étiez", "étaient", "fus", "fut", "fûmes", "fûtes", "furent", "sois", "soit",
    "soyons", "soyez", "soient", "fusse", "fusses", "fût", "fussions", "fussiez", "fussent", "ayant",
    "ayante", "ayantes", "ayants", "eu", "eue", "eues", "eus", "ai", "as", "avons", "avez", "ont",
    "aurai", "auras", "aura", "aurons", "aurez", "auront", "aurais", "aurait", "aurions", "auriez",
    "auraient", "avais", "avait", "avions", "aviez", "avaient", "eut", "eûmes", "eûtes", "eurent",
    "aie", "aies", "ait", "ayons", "ayez", "aient", "eusse", "eusses", "eût", "eussions", "eussiez",
    "eussent",
}


def tokenize(text: str) -> set[str]:
    """Extracts alphanumeric words / technical tokens, downcased and stripped of punctuation."""
    words = re.findall(r"[\w\+#\.\-]+", text.lower())
    clean_words = set()
    for w in words:
        w_stripped = w.strip(".-_")
        if len(w_stripped) > 1 and w_stripped not in BASE_STOPWORDS and not w_stripped.isdigit():
            clean_words.add(w_stripped)
    return clean_words


def build_master_vocabulary(lang: str = "en") -> set[str]:
    """Builds a set of allowed technical tokens and words from master profile YAML."""
    from backend.app.cv.profiles import get_active_profile_dir
    pdir = get_active_profile_dir()
    lang_norm = "fr" if lang.lower().startswith("fr") else "en"
    yaml_file = pdir / f"master.{lang_norm}.yaml"
    if not yaml_file.exists():
        other = "en" if lang_norm == "fr" else "fr"
        yaml_file = pdir / f"master.{other}.yaml"
    if not yaml_file.exists():
        return set()
    with open(yaml_file, "r", encoding="utf-8") as f:
        content = f.read()
    return tokenize(content)


def check_unverified_keywords(text: str, allowed_vocab: set[str]) -> list[str]:
    """Identifies technical keywords or novel tokens in text that are missing from master vocabulary."""
    tokens = tokenize(text)
    unverified = sorted(list(tokens - allowed_vocab))
    return unverified


# Pydantic Schemas for Staged CV Diff

class HeadlineSuggestion(BaseModel):
    original: str
    proposed: str
    reason: str
    accepted: bool = True
    user_modified: bool = False


class SummarySuggestion(BaseModel):
    original: str
    proposed: str
    reason: str
    accepted: bool = True
    user_modified: bool = False
    unverified_keywords: list[str] = Field(default_factory=list)


class SkillCategoryDiff(BaseModel):
    category: str
    original_details: str
    proposed_details: str
    reason: str
    accepted: bool = True
    priority: Literal["high", "medium", "low"] = "high"
    user_modified: bool = False
    unverified_keywords: list[str] = Field(default_factory=list)


class BulletDiff(BaseModel):
    section: str  # "work experience" or "projects"
    entry_title: str  # Company or Project name
    bullet_index: int
    original_text: str
    proposed_text: str
    reason: str
    accepted: bool = True
    priority: Literal["high", "medium", "low"] = "high"
    user_modified: bool = False
    unverified_keywords: list[str] = Field(default_factory=list)


class TopicKeywords(BaseModel):
    subject_ref: str
    subject_title: str
    keywords: list[str] = Field(default_factory=list)


class StagedCVDiff(BaseModel):
    language: Literal["en", "fr"]
    headline_suggestion: HeadlineSuggestion | None = None
    summary_suggestion: SummarySuggestion | None = None
    skill_category_diffs: list[SkillCategoryDiff] = Field(default_factory=list)
    bullet_diffs: list[BulletDiff] = Field(default_factory=list)
    has_unverified_keywords: bool = False
    all_unverified_keywords: list[str] = Field(default_factory=list)
    target_keywords: list[str] = Field(default_factory=list)
    topic_keywords: list[TopicKeywords] = Field(default_factory=list)
    available_bullets: list[BulletDiff] = Field(default_factory=list)
    available_skills: list[SkillCategoryDiff] = Field(default_factory=list)


class LLMSkillChange(BaseModel):
    category: str = Field(
        description="Name of the skill category to reorder (e.g. 'Machine Learning / Deep Learning')."
    )
    proposed_details: str = Field(
        description="Comma-separated skills list with subject-relevant technologies ordered first."
    )
    reason: str = Field(
        description="Brief explanation of why skills were reordered."
    )
    priority: Literal["high", "medium", "low"] = Field(
        default="high",
        description="Priority level of this change."
    )


class LLMBulletChange(BaseModel):
    section: str = Field(
        description="'work experience' or 'projects'"
    )
    entry_title: str = Field(
        description="Exact company name or project name"
    )
    bullet_index: int = Field(
        description="0-based integer index of the bullet being updated matching the prompt index"
    )
    proposed_text: str = Field(
        description="Reworded bullet text matching original character length within character limit."
    )
    reason: str = Field(
        description="Brief rationale for the rephrasing."
    )
    priority: Literal["high", "medium", "low"] = Field(
        default="high",
        description="Priority level of this change."
    )


class LLMCVDraftResponse(BaseModel):
    headline_proposed: str | None = Field(
        default=None,
        description="Proposed headline tailoring the specialization, or null."
    )
    headline_reason: str | None = Field(
        default=None,
        description="Reason for the headline suggestion."
    )
    summary_proposed: str | None = Field(
        default=None,
        description="Proposed summary text highlighting relevant keywords within character limit (~280-320 chars), or null."
    )
    summary_reason: str | None = Field(
        default=None,
        description="Reason for the summary suggestion."
    )
    skill_changes: list[LLMSkillChange] = Field(
        default_factory=list,
        description="List of skill category reorderings."
    )
    bullet_changes: list[LLMBulletChange] = Field(
        default_factory=list,
        description="List of up to 1-3 targeted bullet rewordings."
    )


def load_master_cv(lang: str) -> dict[str, Any]:
    """Loads master CV YAML into a Python dictionary."""
    from backend.app.cv.profiles import get_active_profile_dir
    pdir = get_active_profile_dir()
    lang_norm = "fr" if lang.lower().startswith("fr") else "en"
    yaml_file = pdir / f"master.{lang_norm}.yaml"
    if not yaml_file.exists():
        other = "en" if lang_norm == "fr" else "fr"
        yaml_file = pdir / f"master.{other}.yaml"
    if not yaml_file.exists():
        raise FileNotFoundError(f"Master CV file not found in {pdir}")
    with open(yaml_file, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def find_section_key(sections: dict[str, Any], query: str) -> str | None:
    """Finds section key case-insensitively and accent-insensitively."""
    q = query.lower()
    for k in sections.keys():
        kl = k.lower()
        if q in kl or (q == "skills" and ("skill" in kl or "compétence" in kl or "competence" in kl)):
            return k
        if (q in ("work experience", "experience") and ("work" in kl or "expérience" in kl or "experience" in kl)):
            return k
        if (q == "projects" and ("proj" in kl)):
            return k
    return None


def recompute_unverified_keywords(diff: StagedCVDiff) -> StagedCVDiff:
    """Recomputes unverified keywords across all active/proposed items in a StagedCVDiff."""
    allowed_vocab = build_master_vocabulary(diff.language)
    all_unverified: set[str] = set()

    if diff.summary_suggestion and diff.summary_suggestion.accepted:
        unv = check_unverified_keywords(diff.summary_suggestion.proposed, allowed_vocab)
        diff.summary_suggestion.unverified_keywords = unv
        all_unverified.update(unv)

    for sk in diff.skill_category_diffs:
        if sk.accepted:
            unv = check_unverified_keywords(sk.proposed_details, allowed_vocab)
            sk.unverified_keywords = unv
            all_unverified.update(unv)

    for b in diff.bullet_diffs:
        if b.accepted:
            unv = check_unverified_keywords(b.proposed_text, allowed_vocab)
            b.unverified_keywords = unv
            all_unverified.update(unv)

    diff.all_unverified_keywords = sorted(list(all_unverified))
    diff.has_unverified_keywords = len(all_unverified) > 0
    return diff


def generate_staged_cv_diff(
    subjects: list[dict[str, Any]],
    language: Literal["en", "fr"] = "fr",
    user_instruction: str | None = None,
    model: str | None = None,
) -> StagedCVDiff:
    """Uses LLM to propose targeted keyword tailoring for the chosen subjects."""
    settings = get_settings()
    active_model = model or settings.get_model_for_job("tailor") or DEFAULT_MODEL
    spec = load_job_prompt("tailor")

    master_data = load_master_cv(language)
    cv = master_data.get("cv", {})
    sections = cv.get("sections", {})

    # Extract original headline and summary
    summary_sec_name = find_section_key(sections, "summary") or find_section_key(sections, "profil") or find_section_key(sections, "profile")
    if not summary_sec_name:
        first_key = list(sections.keys())[0] if sections else ""
        if first_key and first_key.lower() not in ("work experience", "expérience professionnelle", "projects", "projets", "education", "formation", "skills", "compétences"):
            summary_sec_name = first_key

    original_headline = cv.get("headline") or summary_sec_name or ""
    original_summary = sections[summary_sec_name][0] if summary_sec_name and summary_sec_name in sections else ""

    # Extract original skills
    skills_key = find_section_key(sections, "skills")
    original_skills = sections.get(skills_key, []) if skills_key else []
    skills_map = {s.get("label", ""): s.get("details", "") for s in original_skills}

    # Extract work experience & projects
    work_key = find_section_key(sections, "work experience")
    work_exp = sections.get(work_key, []) if work_key else []
    proj_key = find_section_key(sections, "projects")
    projects = sections.get(proj_key, []) if proj_key else []

    # Extract target keywords from subjects
    target_kws: set[str] = set()
    topic_keywords_list: list[TopicKeywords] = []
    stopwords_title = {"pfe", "stage", "sujet", "projet", "internship", "project", "the", "and", "pour", "dans", "avec"}

    for s in subjects:
        ref = s.get("ref", "") or "General"
        title = s.get("title", "")
        s_kws: set[str] = set()
        for tech in s.get("technologies", []):
            if tech.strip():
                s_kws.add(tech.strip())
                target_kws.add(tech.strip())
        for title_token in tokenize(title):
            if len(title_token) > 2 and title_token.lower() not in stopwords_title:
                s_kws.add(title_token)
                target_kws.add(title_token)
        if not s_kws:
            s_kws.add(ref)
            target_kws.add(ref)
        topic_keywords_list.append(
            TopicKeywords(
                subject_ref=ref,
                subject_title=title or ref,
                keywords=sorted(list(s_kws)),
            )
        )

    # Format subjects
    subjects_repr = "\n".join(
        [
            f"- Ref: {s.get('ref', '')} | Title: {s.get('title', '')} | Tech: {', '.join(s.get('technologies', []))} | Target: {s.get('target_profile', '')}"
            for s in subjects
        ]
    )

    allowed_vocab = build_master_vocabulary(language)

    # Pre-index bullets with budget hints for robust LLM mapping
    formatted_work_exp = []
    for w in work_exp:
        cname = w.get("company", "")
        pos = w.get("position", "")
        hls = [
            f"[{idx}] (max {len(hl) + 10} chars): {hl}"
            for idx, hl in enumerate(w.get("highlights", []))
        ]
        formatted_work_exp.append({"company": cname, "position": pos, "highlights": hls})

    formatted_projects = []
    for p in projects:
        pname = p.get("name", "")
        hls = [
            f"[{idx}] (max {len(hl) + 10} chars): {hl}"
            for idx, hl in enumerate(p.get("highlights", []))
        ]
        formatted_projects.append({"name": pname, "highlights": hls})

    try:
        from backend.app.draft import get_candidate_facts_for_lang
        facts = get_candidate_facts_for_lang(language)
        candidate_degree = f"{facts.get('degree', '')} ({facts.get('institution', '')})".strip(" ()")
        if not candidate_degree:
            candidate_degree = "Master's / Engineering Candidate" if language == "en" else "Étudiant(e) en Mastère / Cycle Ingénieur"
    except Exception:
        candidate_degree = "Master's / Engineering Candidate" if language == "en" else "Étudiant(e) en Mastère / Cycle Ingénieur"

    summary_prompt_line = (
        f"Current Summary (~{len(original_summary)} chars): {original_summary}"
        if original_summary.strip()
        else "Current Summary: None (no-summary layout; return null for summary_proposed)"
    )

    user_prompt = f"""<candidate_profile>
Degree: {candidate_degree}
Current Headline: {original_headline}
{summary_prompt_line}

Skills Categories:
{yaml.dump(original_skills, allow_unicode=True)}
</candidate_profile>

<bullets_with_budgets>
Work Experience:
{yaml.dump(formatted_work_exp, allow_unicode=True)}

Projects:
{yaml.dump(formatted_projects, allow_unicode=True)}
</bullets_with_budgets>

<subjects>
{subjects_repr}
</subjects>

<task>
Language: {"French" if language == "fr" else "English"}
User Instruction: {user_instruction or "Tailor keywords and emphasis to highlight maximum alignment with target subjects without fabricating facts or adding unverifiable claims."}
Propose targeted keyword adjustments following the rules and character limits.
</task>
"""

    llm_output = generate_structured_content(
        contents=user_prompt,
        response_schema=LLMCVDraftResponse,
        model=active_model,
        temperature=spec.temperature if spec.temperature is not None else 0.2,
        system_instruction=spec.system_prompt,
    )

    all_unverified: set[str] = set()

    # Headline
    headline_diff: HeadlineSuggestion | None = None
    if llm_output.headline_proposed and llm_output.headline_proposed.strip() != original_headline.strip():
        headline_diff = HeadlineSuggestion(
            original=original_headline,
            proposed=llm_output.headline_proposed.strip(),
            reason=llm_output.headline_reason or "Tailored to target subjects",
            accepted=True,
        )

    # Summary (only tailor if baseline CV actually has a summary section)
    summary_diff: SummarySuggestion | None = None
    if (
        original_summary.strip()
        and llm_output.summary_proposed
        and llm_output.summary_proposed.strip() != original_summary.strip()
    ):
        unverified_sum = check_unverified_keywords(llm_output.summary_proposed, allowed_vocab)
        all_unverified.update(unverified_sum)
        summary_diff = SummarySuggestion(
            original=original_summary,
            proposed=llm_output.summary_proposed.strip(),
            reason=llm_output.summary_reason or "Emphasize key tech alignment",
            accepted=True,
            unverified_keywords=unverified_sum,
        )

    # Skills diffs
    skill_diffs: list[SkillCategoryDiff] = []
    used_categories: set[str] = set()
    for sc in llm_output.skill_changes:
        cat = sc.category
        proposed_det = sc.proposed_details
        orig_det = skills_map.get(cat, "")
        if not orig_det:
            # Match case-insensitively
            for k, v in skills_map.items():
                if k.lower() == cat.lower():
                    cat = k
                    orig_det = v
                    break

        if orig_det and proposed_det and orig_det.strip() != proposed_det.strip():
            unv = check_unverified_keywords(proposed_det, allowed_vocab)
            all_unverified.update(unv)
            used_categories.add(cat.lower())
            skill_diffs.append(
                SkillCategoryDiff(
                    category=cat,
                    original_details=orig_det,
                    proposed_details=proposed_det,
                    reason=sc.reason,
                    accepted=True,
                    priority=sc.priority,
                    unverified_keywords=unv,
                )
            )

    # Remaining skills available for manual editing
    available_skills: list[SkillCategoryDiff] = []
    for cat, det in skills_map.items():
        if cat.lower() not in used_categories:
            available_skills.append(
                SkillCategoryDiff(
                    category=cat,
                    original_details=det,
                    proposed_details=det,
                    reason="Baseline skill category available for custom refinement",
                    accepted=False,
                    priority="medium",
                    unverified_keywords=[],
                )
            )

    # Bullet diffs
    bullet_diffs: list[BulletDiff] = []
    used_bullets: set[tuple[str, int]] = set()

    for bc in llm_output.bullet_changes:
        sec_name = bc.section
        entry_title = bc.entry_title
        b_idx = bc.bullet_index
        proposed_t = bc.proposed_text

        # Find original text
        orig_t = ""
        target_list = work_exp if ("work" in sec_name.lower() or "exp" in sec_name.lower()) else projects
        matched_title = entry_title
        for item in target_list:
            item_name = item.get("company") or item.get("name") or ""
            if entry_title.lower() in item_name.lower() or item_name.lower() in entry_title.lower():
                matched_title = item_name
                highlights = item.get("highlights", [])
                if 0 <= b_idx < len(highlights):
                    orig_t = highlights[b_idx]
                    break

        if orig_t and proposed_t and orig_t.strip() != proposed_t.strip():
            unv = check_unverified_keywords(proposed_t, allowed_vocab)
            all_unverified.update(unv)
            used_bullets.add((matched_title.lower(), b_idx))
            bullet_diffs.append(
                BulletDiff(
                    section=sec_name,
                    entry_title=matched_title,
                    bullet_index=b_idx,
                    original_text=orig_t,
                    proposed_text=proposed_t,
                    reason=bc.reason,
                    accepted=True,
                    priority=bc.priority,
                    unverified_keywords=unv,
                )
            )

    # Available remaining bullets from master CV
    available_bullets: list[BulletDiff] = []
    for item in work_exp:
        cname = item.get("company", "")
        for idx, hl in enumerate(item.get("highlights", [])):
            if (cname.lower(), idx) not in used_bullets:
                available_bullets.append(
                    BulletDiff(
                        section="work experience",
                        entry_title=cname,
                        bullet_index=idx,
                        original_text=hl,
                        proposed_text=hl,
                        reason="Master profile experience highlight",
                        accepted=False,
                        priority="medium",
                        unverified_keywords=[],
                    )
                )

    for item in projects:
        pname = item.get("name", "")
        for idx, hl in enumerate(item.get("highlights", [])):
            if (pname.lower(), idx) not in used_bullets:
                available_bullets.append(
                    BulletDiff(
                        section="projects",
                        entry_title=pname,
                        bullet_index=idx,
                        original_text=hl,
                        proposed_text=hl,
                        reason="Master profile project highlight",
                        accepted=False,
                        priority="medium",
                        unverified_keywords=[],
                    )
                )

    return StagedCVDiff(
        language=language,
        headline_suggestion=headline_diff,
        summary_suggestion=summary_diff,
        skill_category_diffs=skill_diffs,
        bullet_diffs=bullet_diffs,
        has_unverified_keywords=len(all_unverified) > 0,
        all_unverified_keywords=sorted(list(all_unverified)),
        target_keywords=sorted(list(target_kws)),
        topic_keywords=topic_keywords_list,
        available_bullets=available_bullets,
        available_skills=available_skills,
    )


def apply_layout_preset(cv_dict: dict[str, Any], preset_level: int) -> None:
    """Micro-squeezes design whitespace or font size to fit within the 1-page budget without altering text.

    Level 0: Default master layout.
    Level 1: Tight whitespace (margins, section/entry gaps, line spacing), identical 9.5pt font.
    Level 2: Micro-font fit (9.1pt font + tight whitespace).
    """
    if preset_level == 0:
        return

    design = cv_dict.setdefault("design", {})
    page = design.setdefault("page", {})
    typography = design.setdefault("typography", {})
    font_size = typography.setdefault("font_size", {})
    section_titles = design.setdefault("section_titles", {})
    sections = design.setdefault("sections", {})
    entries = design.setdefault("entries", {})
    highlights = entries.setdefault("highlights", {})
    header = design.setdefault("header", {})

    if preset_level == -1:
        # Relaxed vertical spacing to eliminate excessive bottom deadspace
        page["top_margin"] = "1.05cm"
        page["bottom_margin"] = "1.05cm"
        typography["line_spacing"] = "0.66em"
        section_titles["space_above"] = "0.35cm"
        section_titles["space_below"] = "0.18cm"
        sections["space_between_regular_entries"] = "0.24cm"
        sections["space_between_text_based_entries"] = "0.26cm"
        highlights["space_above"] = "0.08cm"
        highlights["space_between_items"] = "0.09cm"
        header["space_below_connections"] = "0.20cm"
        return

    if preset_level >= 1:
        # Gentle whitespace step (~2 lines reclaimed, keeps full visual balance)
        page["top_margin"] = "0.82cm"
        page["bottom_margin"] = "0.82cm"
        typography["line_spacing"] = "0.58em"
        section_titles["space_above"] = "0.24cm"
        section_titles["space_below"] = "0.12cm"
        sections["space_between_regular_entries"] = "0.15cm"
        sections["space_between_text_based_entries"] = "0.18cm"
        highlights["space_above"] = "0.05cm"
        highlights["space_between_items"] = "0.05cm"

    if preset_level >= 2:
        # Medium whitespace step (~4 lines reclaimed, same 9.5pt font)
        page["top_margin"] = "0.75cm"
        page["bottom_margin"] = "0.75cm"
        page["left_margin"] = "0.95cm"
        page["right_margin"] = "0.95cm"
        typography["line_spacing"] = "0.55em"
        section_titles["space_above"] = "0.20cm"
        section_titles["space_below"] = "0.10cm"
        sections["space_between_regular_entries"] = "0.13cm"
        sections["space_between_text_based_entries"] = "0.15cm"
        highlights["space_above"] = "0.04cm"
        highlights["space_between_items"] = "0.04cm"
        header["space_below_connections"] = "0.12cm"

    if preset_level >= 3:
        # Micro-font fit (~7 lines reclaimed, 9.2pt body font)
        font_size["body"] = "9.2pt"
        font_size["connections"] = "9.1pt"
        typography["line_spacing"] = "0.52em"
        page["top_margin"] = "0.68cm"
        page["bottom_margin"] = "0.68cm"
        page["left_margin"] = "0.9cm"
        page["right_margin"] = "0.9cm"
        section_titles["space_above"] = "0.17cm"
        section_titles["space_below"] = "0.09cm"


def auto_fit_cv_text_with_llm(
    diff: StagedCVDiff,
    allow_condense_user_modified: bool = False,
    subjects: list[dict[str, Any]] | None = None,
) -> StagedCVDiff:
    """Uses LLM to compress copy to 1-page budget.
    
    If allow_condense_user_modified is False (Pass 2): locks user-modified items verbatim and compresses only AI fields.
    If allow_condense_user_modified is True (Pass 3): condenses all fields including user-modified ones, but strictly
    preserves every user keyword, metric, and core intent while tightening verbose wording.
    """
    user_edited_items: list[str] = []
    candidates_to_compress: list[str] = []

    if diff.headline_suggestion and diff.headline_suggestion.accepted:
        if diff.headline_suggestion.user_modified and not allow_condense_user_modified:
            user_edited_items.append(f"Headline (PROTECTED - DO NOT ALTER): {diff.headline_suggestion.proposed}")
        else:
            candidates_to_compress.append(f"Headline: {diff.headline_suggestion.proposed}")

    if diff.summary_suggestion and diff.summary_suggestion.accepted:
        if diff.summary_suggestion.user_modified and not allow_condense_user_modified:
            user_edited_items.append(f"Summary (PROTECTED - DO NOT ALTER): {diff.summary_suggestion.proposed}")
        else:
            candidates_to_compress.append(f"Summary: {diff.summary_suggestion.proposed}")

    for idx, s in enumerate(diff.skill_category_diffs):
        if s.accepted:
            if s.user_modified and not allow_condense_user_modified:
                user_edited_items.append(f"Skills[{idx}] {s.category} (PROTECTED): {s.proposed_details}")
            else:
                candidates_to_compress.append(f"Skills[{idx}] {s.category}: {s.proposed_details}")

    for idx, b in enumerate(diff.bullet_diffs):
        if b.accepted:
            if b.user_modified and not allow_condense_user_modified:
                user_edited_items.append(f"Bullet[{idx}] {b.section} - {b.entry_title} (PROTECTED): {b.proposed_text}")
            else:
                candidates_to_compress.append(f"Bullet[{idx}] {b.section} - {b.entry_title}: {b.proposed_text}")

    if not candidates_to_compress:
        return diff

    prompt = f"""You are an expert technical CV layout condensation editor. The candidate's CV slightly exceeds the 1-page budget.
Your task is to tighten and shorten the candidate items by ~10-15% (matching their original baseline length) so it fits cleanly on 1 full page without leaving excessive dead whitespace at the bottom.

RULES:
1. STRICT PRESERVATION: Keep ALL technical keywords, tools, metrics, numbers, and core claims.
2. TARGET LENGTH: Trim only excess verbosity so each item matches its original baseline length (~280 chars for summary, ~160-200 chars per bullet). Do NOT over-truncate into 1-line fragments.
{"3. USER-MODIFIED DIRECTIVES: Tighten user-written text without deleting any user-injected terms or direction." if allow_condense_user_modified else "3. LOCKED ITEMS: Do not alter protected items listed below."}

LOCKED ITEMS (VERBATIM):
{chr(10).join(user_edited_items) if user_edited_items else "None"}

ITEMS TO CONDENSE:
{chr(10).join(candidates_to_compress)}

LANGUAGE: {"French" if diff.language == "fr" else "English"}

Return the shortened items in JSON conforming to the schema.
"""
    try:
        active_model = settings.get_model_for_job("tailor") or DEFAULT_MODEL
        compressed_res = generate_structured_content(
            contents=[prompt],
            response_schema=LLMCVDraftResponse,
            model=active_model,
            temperature=0.1,
        )

        if compressed_res.headline_proposed and diff.headline_suggestion:
            if allow_condense_user_modified or not diff.headline_suggestion.user_modified:
                diff.headline_suggestion.proposed = compressed_res.headline_proposed.strip()

        if compressed_res.summary_proposed and diff.summary_suggestion:
            if allow_condense_user_modified or not diff.summary_suggestion.user_modified:
                diff.summary_suggestion.proposed = compressed_res.summary_proposed.strip()

        for sc in compressed_res.skill_changes:
            for item in diff.skill_category_diffs:
                if item.category.lower() == sc.category.lower():
                    if allow_condense_user_modified or not item.user_modified:
                        item.proposed_details = sc.proposed_details.strip()

        for bc in compressed_res.bullet_changes:
            for b in diff.bullet_diffs:
                if (
                    b.entry_title.lower() in bc.entry_title.lower()
                    or bc.entry_title.lower() in b.entry_title.lower()
                ) and b.bullet_index == bc.bullet_index:
                    if allow_condense_user_modified or not b.user_modified:
                        b.proposed_text = bc.proposed_text.strip()
    except Exception:
        # If LLM compression fails or times out, proceed without crashing
        pass

    return diff


def apply_staged_cv_diff(
    diff: StagedCVDiff,
    output_dir: str | Path,
    output_pdf_name: str = "CV_Tailored.pdf",
    enforce_single_page: bool = True,
    auto_fit: bool = True,
) -> dict[str, Any]:
    """Applies accepted diff items onto master YAML, renders PDF & PNG preview, enforcing 1-page budget with auto-fit tiers."""
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    def build_patched_cv(current_diff: StagedCVDiff) -> dict[str, Any]:
        data = load_master_cv(current_diff.language)
        cv = data.get("cv", {})
        sections = cv.get("sections", {})

        # 1. Headline & Summary
        summary_section_key = find_section_key(sections, "summary") or find_section_key(sections, "profil")
        if not summary_section_key:
            first_key = list(sections.keys())[0] if sections else ""
            if first_key and first_key.lower() not in ("work experience", "expérience professionnelle", "projects", "projets", "education", "formation", "skills", "compétences"):
                summary_section_key = first_key

        if current_diff.headline_suggestion and current_diff.headline_suggestion.accepted:
            new_headline = current_diff.headline_suggestion.proposed.strip()
            cv["headline"] = new_headline
            if summary_section_key and summary_section_key in sections:
                summary_content = sections.pop(summary_section_key)
                new_sections = {new_headline: summary_content}
                for k, v in sections.items():
                    if k != new_headline:
                        new_sections[k] = v
                cv["sections"] = new_sections
                summary_section_key = new_headline

        if (
            current_diff.summary_suggestion
            and current_diff.summary_suggestion.accepted
            and current_diff.summary_suggestion.proposed.strip()
        ):
            prop_sum = current_diff.summary_suggestion.proposed.strip()
            if summary_section_key and summary_section_key in cv.get("sections", {}):
                cv["sections"][summary_section_key][0] = prop_sum
            else:
                # Add summary section under headline or 'Summary'
                sum_title = cv.get("headline") or ("Summary" if current_diff.language == "en" else "Profil")
                new_sections = {sum_title: [prop_sum]}
                new_sections.update(cv.get("sections", {}))
                cv["sections"] = new_sections

        # 2. Skills
        skills_sec_name = find_section_key(cv.get("sections", {}), "skills")
        if skills_sec_name and skills_sec_name in cv.get("sections", {}):
            current_skills = cv["sections"][skills_sec_name]
            for sdiff in current_diff.skill_category_diffs:
                if sdiff.accepted:
                    for s in current_skills:
                        if s.get("label", "").lower() == sdiff.category.lower():
                            s["details"] = sdiff.proposed_details.strip()

        # 3. Bullets
        for bdiff in current_diff.bullet_diffs:
            if bdiff.accepted:
                is_work = "work" in bdiff.section.lower() or "exp" in bdiff.section.lower()
                target_key = find_section_key(
                    cv.get("sections", {}), "work experience" if is_work else "projects"
                )

                if target_key:
                    entry_list = cv["sections"][target_key]
                    for item in entry_list:
                        item_title = item.get("company") or item.get("name") or ""
                        if (
                            bdiff.entry_title.lower() in item_title.lower()
                            or item_title.lower() in bdiff.entry_title.lower()
                        ):
                            highlights = item.get("highlights", [])
                            if 0 <= bdiff.bullet_index < len(highlights):
                                highlights[bdiff.bullet_index] = bdiff.proposed_text.strip()
        return data

    active_diff = diff
    last_error: PageOverflowError | None = None
    max_preset = 3 if auto_fit else 0

    # Pass 1: Try progressive layout presets (Levels 0 through 3) without altering any copy
    for preset_level in range(max_preset + 1):
        patched_data = build_patched_cv(active_diff)
        apply_layout_preset(patched_data, preset_level)

        with tempfile.NamedTemporaryFile("w", suffix=".yaml", encoding="utf-8", delete=False) as tf:
            yaml.dump(patched_data, tf, allow_unicode=True, sort_keys=False)
            temp_yaml = Path(tf.name)

        try:
            rendered_pdf = render_cv_pdf(
                temp_yaml,
                output_dir=output_dir,
                output_name=output_pdf_name,
                enforce_single_page=enforce_single_page,
            )
            metrics = verify_cv_layout(rendered_pdf)

            # If preset 0 left significant deadspace at the bottom (< 755pt), expand vertical rhythm (-1)
            if auto_fit and preset_level == 0 and metrics.get("last_y1_pt", 800.0) < 755.0:
                expanded_data = build_patched_cv(active_diff)
                apply_layout_preset(expanded_data, -1)
                with tempfile.NamedTemporaryFile("w", suffix=".yaml", encoding="utf-8", delete=False) as tf2:
                    yaml.dump(expanded_data, tf2, allow_unicode=True, sort_keys=False)
                    temp_yaml2 = Path(tf2.name)
                try:
                    exp_pdf = render_cv_pdf(
                        temp_yaml2,
                        output_dir=output_dir,
                        output_name=output_pdf_name,
                        enforce_single_page=enforce_single_page,
                    )
                    metrics = verify_cv_layout(exp_pdf)
                    rendered_pdf = exp_pdf
                except PageOverflowError:
                    # Revert to preset 0 if expanded spacing overflows
                    rendered_pdf = render_cv_pdf(
                        temp_yaml,
                        output_dir=output_dir,
                        output_name=output_pdf_name,
                        enforce_single_page=enforce_single_page,
                    )
                finally:
                    if temp_yaml2.exists():
                        temp_yaml2.unlink(missing_ok=True)

            png_name = output_pdf_name.replace(".pdf", ".png")
            png_path = render_pdf_to_png(rendered_pdf, output_dir / png_name)

            return {
                "pdf_path": rendered_pdf,
                "png_path": png_path,
                "metrics": metrics,
                "layout_preset_applied": preset_level,
                "fitted_diff": active_diff,
            }
        except PageOverflowError as poe:
            last_error = poe
            continue
        finally:
            if temp_yaml.exists():
                temp_yaml.unlink(missing_ok=True)

    # Pass 2: If Pass 1 still overflows, compress non-user-modified AI copy first (keeping user edits verbatim)
    if auto_fit and last_error is not None:
        compressed_ai_diff = auto_fit_cv_text_with_llm(active_diff, allow_condense_user_modified=False)
        for preset_level in range(max_preset + 1):
            patched_data = build_patched_cv(compressed_ai_diff)
            apply_layout_preset(patched_data, preset_level)

            with tempfile.NamedTemporaryFile("w", suffix=".yaml", encoding="utf-8", delete=False) as tf:
                yaml.dump(patched_data, tf, allow_unicode=True, sort_keys=False)
                temp_yaml = Path(tf.name)

            try:
                rendered_pdf = render_cv_pdf(
                    temp_yaml,
                    output_dir=output_dir,
                    output_name=output_pdf_name,
                    enforce_single_page=enforce_single_page,
                )
                metrics = verify_cv_layout(rendered_pdf)
                png_name = output_pdf_name.replace(".pdf", ".png")
                png_path = render_pdf_to_png(rendered_pdf, output_dir / png_name)

                return {
                    "pdf_path": rendered_pdf,
                    "png_path": png_path,
                    "metrics": metrics,
                    "layout_preset_applied": preset_level,
                    "fitted_diff": compressed_ai_diff,
                    "auto_compressed": True,
                }
            except PageOverflowError as poe:
                last_error = poe
                continue
            finally:
                if temp_yaml.exists():
                    temp_yaml.unlink(missing_ok=True)

    # Pass 3: If still overflowing (due to user edits / large text additions), condense everything
    # while strictly preserving all user-injected keywords, direction, and core intent
    if auto_fit and last_error is not None:
        smart_condensed_diff = auto_fit_cv_text_with_llm(active_diff, allow_condense_user_modified=True)
        for preset_level in range(max_preset + 1):
            patched_data = build_patched_cv(smart_condensed_diff)
            apply_layout_preset(patched_data, preset_level)

            with tempfile.NamedTemporaryFile("w", suffix=".yaml", encoding="utf-8", delete=False) as tf:
                yaml.dump(patched_data, tf, allow_unicode=True, sort_keys=False)
                temp_yaml = Path(tf.name)

            try:
                rendered_pdf = render_cv_pdf(
                    temp_yaml,
                    output_dir=output_dir,
                    output_name=output_pdf_name,
                    enforce_single_page=enforce_single_page,
                )
                metrics = verify_cv_layout(rendered_pdf)
                png_name = output_pdf_name.replace(".pdf", ".png")
                png_path = render_pdf_to_png(rendered_pdf, output_dir / png_name)

                return {
                    "pdf_path": rendered_pdf,
                    "png_path": png_path,
                    "metrics": metrics,
                    "layout_preset_applied": preset_level,
                    "fitted_diff": smart_condensed_diff,
                    "auto_compressed": True,
                }
            except PageOverflowError as poe:
                last_error = poe
                continue
            finally:
                if temp_yaml.exists():
                    temp_yaml.unlink(missing_ok=True)

    # If all auto-fit passes fail, raise overflow error
    if last_error:
        raise last_error

    raise PageOverflowError(2, output_dir / output_pdf_name, "Unable to fit within 1-page layout budget.")
