"""Canonical Candidate Profile Schema & Lossless YAML Converters.

Defines the structured candidate profile model, bidirectional converters to/from
RenderCV v2.8 YAML files (profile/master.<lang>.yaml), and helper methods for
dynamic prompt/drafting fact injection.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Literal
import yaml
from pydantic import BaseModel, Field

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
PROFILE_DIR = REPO_ROOT / "profile"


class ProfileBasics(BaseModel):
    name: str = Field(..., description="Full legal name of candidate")
    first_name: str | None = None
    last_name: str | None = None
    email: str = Field(..., description="Primary contact email")
    phone: str = Field(..., description="Contact phone number with international code")
    location: str = Field(..., description="City and country, e.g. 'Tunis, Tunisia'")
    linkedin: str | None = Field(default=None, description="LinkedIn profile handle or full URL")
    github: str | None = Field(default=None, description="GitHub profile handle or full URL")
    website: str | None = Field(default=None, description="Personal portfolio or website URL")
    institution: str | None = Field(default=None, description="Current university or educational institution")
    degree: str | None = Field(default=None, description="Current degree / major specialization")
    availability: str | None = Field(
        default="PFE 2027 (Starting February 2027 / 4-6 months)",
        description="Internship availability window",
    )


class ExperienceItem(BaseModel):
    company: str
    position: str
    start_date: str = Field(..., description="YYYY-MM or string")
    end_date: str = Field(..., description="YYYY-MM or present")
    location: str
    highlights: list[str] = Field(default_factory=list)


class ProjectItem(BaseModel):
    name: str
    date: str | None = None
    url: str | None = None
    highlights: list[str] = Field(default_factory=list)


class EducationItem(BaseModel):
    institution: str
    degree: str
    area: str
    start_date: str
    end_date: str
    location: str
    highlights: list[str] = Field(default_factory=list)


class SkillCategoryItem(BaseModel):
    label: str = Field(..., description="Category label, e.g. 'Machine Learning / Deep Learning'")
    details: str = Field(..., description="Comma-separated skills list")


class CertificationItem(BaseModel):
    name: str
    issuer: str | None = None
    date: str | None = None
    details: str | None = None


class ExtracurricularItem(BaseModel):
    organization: str
    role: str
    start_date: str | None = None
    end_date: str | None = None
    highlights: list[str] = Field(default_factory=list)


class CareerGoals(BaseModel):
    target_roles: str = Field(
        default="AI/ML Engineer, Agentic AI & RAG Systems, Data Engineering & Lakehouse, MLOps, Deep Learning",
        description="Target roles and technical domains the candidate wants to pursue.",
    )
    tech_to_learn: str = Field(
        default="Databricks, Apache Spark, LangGraph, vLLM, Kubernetes, Docker, Cloud MLOps (AWS/Azure/GCP), Vector Databases",
        description="Technologies and frameworks the candidate wants to learn or deepen.",
    )
    dealbreakers: str = Field(
        default="Basic CRUD web/mobile apps, static BI dashboard maintenance, manual Excel/reporting tasks, WordPress/no-code, non-data IT support",
        description="Low-interest work or dealbreakers to penalize.",
    )
    pfe_priorities: str = Field(
        default="High technical richness, measurable ML/engineering architecture for PFE thesis defense, modern production stack, pre-hiring (embauche) potential",
        description="What makes a PFE topic high-value for the candidate's thesis and career.",
    )


class CandidateProfile(BaseModel):
    language: Literal["en", "fr"] = "en"
    basics: ProfileBasics
    career_goals: CareerGoals = Field(default_factory=CareerGoals)
    headline: str = Field(
        default="",
        description="Candidate headline or section subtitle.",
    )
    summary: str = Field(
        default="",
        description="Optional executive summary paragraph.",
    )
    work_experience: list[ExperienceItem] = Field(default_factory=list)
    projects: list[ProjectItem] = Field(default_factory=list)
    education: list[EducationItem] = Field(default_factory=list)
    skills: list[SkillCategoryItem] = Field(default_factory=list)
    certifications: list[CertificationItem] = Field(default_factory=list)
    extracurricular: list[ExtracurricularItem] = Field(default_factory=list)


class ProfileImportResponse(BaseModel):
    detected_language: Literal["en", "fr"] = Field(
        ...,
        description="Detected primary language of the uploaded CV: 'en' for English or 'fr' for French.",
    )
    profile: CandidateProfile = Field(
        ...,
        description="Full structured candidate profile extracted accurately from the uploaded CV.",
    )


class ProfileTranslateResponse(BaseModel):
    target_language: Literal["en", "fr"] = Field(
        ...,
        description="Target language of the translated profile ('en' or 'fr').",
    )
    profile: CandidateProfile = Field(
        ...,
        description="Translated candidate profile preserving all facts, companies, dates, metrics, and character budgets.",
    )


class ProfileOptimizeResponse(BaseModel):
    profile: CandidateProfile = Field(
        ...,
        description="ATS-optimized candidate profile following 90+ Resume Worded standards with zero fabricated facts.",
    )
    improvements: list[str] = Field(
        default_factory=list,
        description="Short bullet list of concrete ATS improvements applied (e.g. removed summary, replaced weak verbs, scrubbed buzzwords).",
    )


def _normalize_phone(phone: str | None) -> str:
    """Format phone as '+<country_code> <contiguous_digits>' so ATS regexes never split it."""
    if not phone:
        return ""
    raw = phone.strip()
    if not raw:
        return ""
    m = re.match(r"^\+(\d{1,3})[\s\-\.\(\)]*(.+)$", raw)
    if m:
        cc = m.group(1)
        rest = re.sub(r"\D+", "", m.group(2))
        return f"+{cc} {rest}" if rest else raw
    digits = re.sub(r"\D+", "", raw)
    return digits if digits else raw


def _normalize_end_date(value: str | None, clamp_future_to_present: bool = False) -> str:
    """Normalize ongoing date markers to RenderCV's literal 'present' and optionally clamp future years."""
    if not value:
        return "present"
    v = str(value).strip()
    if v.lower() in {"present", "présent", "actuel", "actuellement", "en cours", "current", "ongoing", "now", "today"}:
        return "present"
    if clamp_future_to_present:
        from datetime import date
        m = re.match(r"^(\d{4})(?:-(\d{1,2}))?$", v)
        if m:
            year = int(m.group(1))
            month = int(m.group(2)) if m.group(2) else 12
            today = date.today()
            if year > today.year or (year == today.year and month > today.month):
                return "present"
    return v


def normalize_profile_for_ats(profile: CandidateProfile) -> CandidateProfile:
    """Apply deterministic 90+ Resume Worded / ATS formatting normalizations without fabricating facts."""
    p = profile.model_copy(deep=True)
    p.basics.phone = _normalize_phone(p.basics.phone)
    p.basics.linkedin = _clean_username(p.basics.linkedin, "linkedin")
    p.basics.github = _clean_username(p.basics.github, "github")

    for exp in p.work_experience:
        exp.end_date = _normalize_end_date(exp.end_date, clamp_future_to_present=False)

    for edu in p.education:
        edu.end_date = _normalize_end_date(edu.end_date, clamp_future_to_present=True)

    # Omit project dates when work experience exists so ATS timeline checkers don't flag out-of-order dates
    if p.work_experience:
        for proj in p.projects:
            proj.date = None

    return p


def _clean_username(value: str | None, network: str) -> str | None:
    if not value:
        return None
    val = value.strip()
    if network.lower() == "linkedin":
        val = re.sub(r"^https?://(?:www\.)?linkedin\.com/in/", "", val)
    elif network.lower() == "github":
        val = re.sub(r"^https?://(?:www\.)?github\.com/", "", val)
    return val.strip("/")


def _resolve_profile_dir(profile_dir: Path | None = None) -> Path:
    if profile_dir is not None:
        return profile_dir
    from backend.app.cv.profiles import get_active_profile_dir
    return get_active_profile_dir()


def load_career_goals(profile_dir: Path | None = None) -> CareerGoals:
    """Loads sidecar career_goals.json without polluting RenderCV master YAML."""
    base_dir = _resolve_profile_dir(profile_dir)
    goals_file = base_dir / "career_goals.json"
    if not goals_file.exists():
        return CareerGoals()
    try:
        data = json.loads(goals_file.read_text(encoding="utf-8"))
        return CareerGoals(**data)
    except Exception:
        return CareerGoals()


def save_career_goals(goals: CareerGoals, profile_dir: Path | None = None) -> Path:
    """Persists career goals to profile/career_goals.json."""
    base_dir = _resolve_profile_dir(profile_dir)
    base_dir.mkdir(parents=True, exist_ok=True)
    goals_file = base_dir / "career_goals.json"
    goals_file.write_text(
        json.dumps(goals.model_dump(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return goals_file


def load_candidate_profile(
    lang: Literal["en", "fr"] = "en",
    profile_dir: Path | None = None,
) -> CandidateProfile:
    """Parses active profile's master.<lang>.yaml into structured CandidateProfile."""
    base_dir = _resolve_profile_dir(profile_dir)
    lang_norm = "fr" if str(lang).lower().startswith("fr") else "en"
    target_file = base_dir / f"master.{lang_norm}.yaml"
    if not target_file.exists():
        # Symmetric fallback for single-language profiles
        other = "en" if lang_norm == "fr" else "fr"
        target_file = base_dir / f"master.{other}.yaml"
    if not target_file.exists():
        raise FileNotFoundError(f"Master profile YAML not found in {base_dir}")

    content = target_file.read_text(encoding="utf-8")
    raw = yaml.safe_load(content) or {}
    cv = raw.get("cv", {})
    sections = cv.get("sections", {})

    full_name = cv.get("name", "Candidate")
    name_parts = full_name.split(maxsplit=1)
    first_name = name_parts[0] if name_parts else ""
    last_name = name_parts[1] if len(name_parts) > 1 else ""

    linkedin_handle = None
    github_handle = None
    website_url = None
    for sn in cv.get("social_networks", []):
        if not isinstance(sn, dict):
            continue
        net = str(sn.get("network", "")).lower()
        usr = str(sn.get("username", ""))
        if "linkedin" in net:
            linkedin_handle = usr
        elif "github" in net:
            github_handle = usr
        elif "website" in net or "portfolio" in net:
            website_url = usr

    headline = cv.get("headline", "") or ""
    summary = ""
    work_exp: list[ExperienceItem] = []
    projects: list[ProjectItem] = []
    education: list[EducationItem] = []
    skills: list[SkillCategoryItem] = []
    certifications: list[CertificationItem] = []
    extracurricular: list[ExtracurricularItem] = []

    for key, val in sections.items():
        norm_key = str(key).strip().lower()
        if norm_key in ("work experience", "expérience professionnelle", "experience", "experiences"):
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, dict):
                        work_exp.append(ExperienceItem(**item))
        elif norm_key in ("projects", "projets", "personal projects"):
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, dict):
                        projects.append(ProjectItem(**item))
        elif norm_key in ("education", "formation", "formations"):
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, dict):
                        education.append(EducationItem(**item))
        elif norm_key in ("skills", "compétences", "competences", "technical skills"):
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, dict):
                        skills.append(SkillCategoryItem(**item))
        elif norm_key in ("certifications", "certificates", "certificats"):
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, dict):
                        certifications.append(CertificationItem(**item))
        elif norm_key in ("extracurricular", "activités associatives", "activites associatives", "engagement associatif", "leadership"):
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, dict):
                        extracurricular.append(ExtracurricularItem(**item))
        elif norm_key in ("summary", "profil", "profile", "about me", "a propos"):
            if isinstance(val, list) and val:
                summary = str(val[0]).strip()
            elif isinstance(val, str):
                summary = val.strip()
        else:
            # Assume dynamic Headline / Summary section if headline not explicitly set
            if not headline:
                headline = str(key).strip()
            if isinstance(val, list) and val:
                summary = str(val[0]).strip()
            elif isinstance(val, str):
                summary = val.strip()

    # Determine degree & institution from education if not explicitly present
    default_degree = None
    default_institution = None
    if education:
        top_edu = education[0]
        default_institution = top_edu.institution
        default_degree = f"{top_edu.degree} in {top_edu.area}" if top_edu.area else top_edu.degree

    basics = ProfileBasics(
        name=full_name,
        first_name=first_name,
        last_name=last_name,
        email=cv.get("email", ""),
        phone=cv.get("phone", ""),
        location=cv.get("location", ""),
        linkedin=linkedin_handle,
        github=github_handle,
        website=website_url,
        institution=default_institution,
        degree=default_degree,
        availability="PFE 2027 (Starting February 2027 / 4-6 months)",
    )

    return CandidateProfile(
        language=lang,
        basics=basics,
        career_goals=load_career_goals(base_dir),
        headline=headline or "Master's Student | AI & Data Science",
        summary=summary,
        work_experience=work_exp,
        projects=projects,
        education=education,
        skills=skills,
        certifications=certifications,
        extracurricular=extracurricular,
    )


def compile_profile_to_yaml_dict(
    profile: CandidateProfile,
    lang: Literal["en", "fr"] = "en",
    base_yaml_path: Path | None = None,
) -> dict[str, Any]:
    """Compiles CandidateProfile into RenderCV v2.8 YAML dictionary preserving design/locale blocks."""
    # Load base design/templates/locale from existing file if available
    active_dir = _resolve_profile_dir(None)
    source_path = base_yaml_path or (active_dir / f"master.{lang}.yaml")
    if not source_path.exists():
        other = "fr" if lang == "en" else "en"
        alt_path = active_dir / f"master.{other}.yaml"
        if alt_path.exists():
            source_path = alt_path
    base_doc: dict[str, Any] = {}
    if source_path.exists():
        try:
            base_doc = yaml.safe_load(source_path.read_text(encoding="utf-8")) or {}
        except Exception:
            base_doc = {}

    design_block = base_doc.get("design", {
        "theme": "pfeclassic",
        "page": {
            "size": "a4",
            "top_margin": "0.9cm",
            "bottom_margin": "0.9cm",
            "left_margin": "1.0cm",
            "right_margin": "1.0cm",
            "show_footer": False,
            "show_top_note": False,
        },
        "colors": {
            "body": "rgb(0, 0, 0)",
            "name": "rgb(0, 0, 0)",
            "headline": "rgb(0, 0, 0)",
            "connections": "rgb(0, 0, 0)",
            "section_titles": "rgb(0, 0, 0)",
            "links": "rgb(0, 0, 0)",
        },
        "typography": {
            "font_family": {
                "body": "XCharter",
                "name": "XCharter",
                "headline": "XCharter",
                "connections": "XCharter",
                "section_titles": "XCharter",
            },
            "font_size": {
                "name": "18pt",
                "headline": "12pt",
                "connections": "9.5pt",
                "section_titles": "11pt",
                "body": "9.5pt",
            },
            "bold": {"name": True, "headline": True, "section_titles": False},
            "small_caps": {"section_titles": False},
            "line_spacing": "0.60em",
            "alignment": "justified-with-no-hyphenation",
        },
        "header": {
            "alignment": "center",
            "space_below_name": "0.08cm",
            "space_below_headline": "0.08cm",
            "space_below_connections": "0.15cm",
            "connections": {
                "phone_number_format": "international",
                "show_icons": False,
                "separator": " • ",
                "space_between_connections": "0.3cm",
                "hyperlink": True,
            },
        },
        "section_titles": {
            "type": "with_full_line",
            "line_thickness": "0.5pt",
            "space_above": "0.28cm",
            "space_below": "0.14cm",
        },
        "sections": {
            "space_between_regular_entries": "0.18cm",
            "space_between_text_based_entries": "0.22cm",
            "show_time_spans_in": [],
        },
        "entries": {
            "date_and_location_width": "4.5cm",
            "side_space": "0cm",
            "space_between_columns": "0.1cm",
            "short_second_row": False,
            "summary": {"space_above": "0.05cm"},
            "highlights": {
                "bullet": "•",
                "space_above": "0.06cm",
                "space_between_items": "0.06cm",
                "space_between_bullet_and_text": "0.18cm",
                "space_left": "0.25cm",
            },
        },
        "templates": {
            "experience_entry": {
                "main_column": "**POSITION**\nCOMPANY\nSUMMARY\nHIGHLIGHTS",
                "date_and_location_column": "LOCATION\nDATE",
            },
            "education_entry": {
                "degree_column": None,
                "main_column": "**DEGREE**, AREA\nINSTITUTION\nSUMMARY\nHIGHLIGHTS",
            },
        },
    })
    # Ensure zero-hyphenation ATS typography invariant on every compiled CV
    design_block.setdefault("typography", {})["alignment"] = "justified-with-no-hyphenation"

    if lang == "en":
        default_locale: dict[str, Any] = {
            "language": "english",
            "month_abbreviations": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
            "present": "Present",
        }
    else:
        default_locale = {
            "language": "french",
            "present": "présent",
        }
    locale_block = dict(base_doc.get("locale") or {})
    for k, v in default_locale.items():
        locale_block.setdefault(k, v)
    # Always enforce target language and 3-letter English month abbreviations
    locale_block["language"] = default_locale["language"]
    if lang == "en":
        locale_block["month_abbreviations"] = default_locale["month_abbreviations"]
        locale_block.setdefault("present", "Present")
    else:
        locale_block.pop("month_abbreviations", None)
        locale_block["present"] = locale_block.get("present") or "présent"

    # Normalize phone/dates deterministically before serializing
    profile = normalize_profile_for_ats(profile)

    # Build social networks
    socials: list[dict[str, str]] = []
    if profile.basics.linkedin:
        u = _clean_username(profile.basics.linkedin, "linkedin")
        if u:
            socials.append({"network": "LinkedIn", "username": u})
    if profile.basics.github:
        u = _clean_username(profile.basics.github, "github")
        if u:
            socials.append({"network": "GitHub", "username": u})
    if profile.basics.website:
        socials.append({"network": "Website", "username": profile.basics.website.strip()})

    sections: dict[str, Any] = {}

    # 1. Headline & Summary (only create section if summary has content)
    if profile.summary and profile.summary.strip():
        headline_key = profile.headline.strip() or (
            "PFE Candidate | Software, Data & AI Engineering"
            if lang == "en"
            else "Candidat PFE | Ingénierie Logicielle, Data & IA"
        )
        sections[headline_key] = [profile.summary.strip()]

    # 2. Work experience
    exp_key = "work experience" if lang == "en" else "expérience professionnelle"
    if profile.work_experience:
        sections[exp_key] = [
            exp.model_dump(exclude_none=True) for exp in profile.work_experience
        ]

    # 3. Projects
    proj_key = "projects" if lang == "en" else "projets"
    if profile.projects:
        sections[proj_key] = [
            p.model_dump(exclude_none=True) for p in profile.projects
        ]

    # 4. Education
    edu_key = "education" if lang == "en" else "formation"
    if profile.education:
        sections[edu_key] = [
            edu.model_dump(exclude_none=True) for edu in profile.education
        ]

    # 5. Skills
    skills_key = "skills" if lang == "en" else "compétences"
    if profile.skills:
        sections[skills_key] = [
            s.model_dump(exclude_none=True) for s in profile.skills
        ]

    # 6. Optional Certifications (omitted if empty)
    if profile.certifications:
        sections["certifications"] = [
            c.model_dump(exclude_none=True) for c in profile.certifications
        ]

    # 7. Optional Extracurricular (omitted if empty)
    if profile.extracurricular:
        extra_key = "extracurricular" if lang == "en" else "activités associatives"
        sections[extra_key] = [
            extra.model_dump(exclude_none=True) for extra in profile.extracurricular
        ]

    cv_dict = {
        "name": profile.basics.name,
        "headline": profile.headline if profile.headline else None,
        "location": profile.basics.location,
        "email": profile.basics.email,
        "phone": profile.basics.phone,
        "social_networks": socials,
        "sections": sections,
    }

    full_dict = {
        "cv": cv_dict,
        "design": design_block,
        "locale": locale_block,
    }

    return full_dict


def get_candidate_facts(profile: CandidateProfile) -> dict[str, str]:
    """Generates localized candidate facts dictionary for LLM drafting and matching prompts."""
    is_fr = profile.language == "fr"
    top_edu = profile.education[0] if profile.education else None
    degree_label = (
        profile.basics.degree
        or (f"{top_edu.degree} en {top_edu.area}" if is_fr and top_edu else (f"{top_edu.degree} in {top_edu.area}" if top_edu else "Master's Degree"))
    )
    institution_label = (
        profile.basics.institution
        or (top_edu.institution if top_edu else "University")
    )

    name_parts = (profile.basics.name or "").split()
    return {
        "name": profile.basics.name,
        "first_name": profile.basics.first_name or (name_parts[0] if name_parts else ""),
        "last_name": profile.basics.last_name or (" ".join(name_parts[1:]) if len(name_parts) > 1 else ""),
        "email": profile.basics.email,
        "phone": profile.basics.phone,
        "location": profile.basics.location,
        "linkedin": profile.basics.linkedin or "",
        "github": profile.basics.github or "",
        "institution": institution_label,
        "degree": degree_label,
        "availability": profile.basics.availability or "PFE 2027 (Starting February 2027 / 4-6 months)",
        "headline": profile.headline,
        "summary": profile.summary,
    }


def save_candidate_profile(
    profile: CandidateProfile,
    lang: Literal["en", "fr"] = "en",
    profile_dir: Path | None = None,
    auto_fit: bool = True,
) -> Path:
    """Compile CandidateProfile to master.<lang>.yaml (with optional 1-page preset fit) and save career goals."""
    import tempfile
    from backend.app.cv.render import (
        render_cv_pdf,
        verify_cv_layout,
        apply_typography_preset_to_yaml_dict,
        MAX_BOTTOM_Y1_PT,
    )

    lang_code: Literal["en", "fr"] = "fr" if str(lang).lower().startswith("fr") else "en"
    base_dir = _resolve_profile_dir(profile_dir)
    base_dir.mkdir(parents=True, exist_ok=True)
    target_path = base_dir / f"master.{lang_code}.yaml"

    yaml_dict = compile_profile_to_yaml_dict(
        profile,
        lang_code,
        base_yaml_path=target_path if target_path.exists() else None,
    )

    best_doc = yaml_dict
    if auto_fit:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            for p in (0, 1, 2, 3):
                candidate_doc = apply_typography_preset_to_yaml_dict(yaml_dict, preset_level=p)
                t_yaml = tmp_path / f"test_{lang_code}.yaml"
                t_yaml.write_text(
                    yaml.safe_dump(candidate_doc, sort_keys=False, allow_unicode=True),
                    encoding="utf-8",
                )
                try:
                    t_pdf = render_cv_pdf(t_yaml, tmp_path, output_name="test.pdf", enforce_single_page=False)
                    m = verify_cv_layout(t_pdf)
                    if m["page_count"] == 1 and m["last_y1_pt"] <= MAX_BOTTOM_Y1_PT:
                        if p == 0 and m["last_y1_pt"] < 755.0:
                            cand_exp = apply_typography_preset_to_yaml_dict(yaml_dict, preset_level=-1)
                            t_yaml.write_text(
                                yaml.safe_dump(cand_exp, sort_keys=False, allow_unicode=True),
                                encoding="utf-8",
                            )
                            try:
                                t_pdf_exp = render_cv_pdf(
                                    t_yaml, tmp_path, output_name="test_exp.pdf", enforce_single_page=False
                                )
                                m_exp = verify_cv_layout(t_pdf_exp)
                                if m_exp["page_count"] == 1 and m_exp["last_y1_pt"] <= MAX_BOTTOM_Y1_PT:
                                    best_doc = cand_exp
                                    break
                            except Exception:
                                pass
                        best_doc = candidate_doc
                        break
                except Exception:
                    continue
            else:
                from backend.app.cv.render import PageOverflowError
                raise PageOverflowError(
                    "CV content still overflows onto page 2 even at the tightest typography preset. Trim 1–2 bullets or skills."
                )

    target_path.write_text(
        yaml.safe_dump(best_doc, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    save_career_goals(profile.career_goals, profile_dir=base_dir)
    return target_path
