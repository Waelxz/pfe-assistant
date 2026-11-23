"""Drafting engine: email subjects/bodies, cover letters, and document package assembly."""

from __future__ import annotations

import re
import urllib.parse
from pathlib import Path
from typing import Any
from pydantic import BaseModel, Field

from google.genai import types
from backend.app.config import get_settings
from backend.app.llm.client import generate_structured_content, DEFAULT_MODEL
from backend.app.llm.prompts.loader import load_job_prompt
from backend.app.llm.match import load_profile_yaml
from backend.app.storage import StorageAdapter, get_storage

def get_candidate_facts_for_lang(language: str = "fr") -> dict[str, str]:
    """Dynamically loads candidate facts from active CandidateProfile with neutral fallback."""
    lang_code = "fr" if str(language).lower().startswith("fr") else "en"
    try:
        from backend.app.cv.profile_schema import load_candidate_profile, get_candidate_facts
        profile = load_candidate_profile(lang_code)
        return get_candidate_facts(profile)
    except Exception:
        return {
            "name": "Candidate",
            "first_name": "",
            "last_name": "",
            "email": "",
            "phone": "",
            "location": "",
            "linkedin": "",
            "github": "",
            "institution": "",
            "degree": "Master / Cycle Ingénieur" if lang_code == "fr" else "Master's / Engineering Degree",
            "availability": "PFE 2027 (4-6 months)",
            "headline": "",
            "summary": "",
        }


class EmailDraft(BaseModel):
    subject: str = Field(..., description="High-converting, professional email subject line")
    body: str = Field(..., description="Full professional email body text")


class CoverLetterDraft(BaseModel):
    salutation: str = Field(..., description="e.g. 'Dear Hiring Team,' or 'Madame, Monsieur,'")
    opening: str = Field(..., description="Opening paragraph stating targeted subjects and background")
    body_paragraphs: list[str] = Field(..., description="2-3 paragraphs detailing relevant skills, projects, and fit")
    closing: str = Field(..., description="Closing paragraph with call to action")
    signoff: str = Field(..., description="Sign-off phrase like 'Sincerely,' or 'Cordialement,'")
    full_text: str = Field(..., description="Complete compiled cover letter markdown/text")


class DraftResponse(BaseModel):
    email_subject: str = Field(
        ...,
        description="Clear, professional email subject line referencing PFE 2027, subject reference, and candidate name.",
    )
    email_body: str = Field(
        ...,
        description="High-converting plain-text email body (120-170 words FR / 100-150 words EN) without markdown bolding or asterisks.",
    )
    cover_letter_text: str | None = Field(
        default=None,
        description="Full formal 1-page cover letter text following Vous-Moi-Nous structure if requested, otherwise null.",
    )


class ApplicationDraftResult(BaseModel):
    language: str
    delivery_mode: str
    email_to: str
    email_subject: str
    email_body: str
    cover_letter_text: str | None = None


def _strip_trailing_signature(body: str) -> str:
    """Stop email body at the closing salutation if the LLM still appended name/contact lines."""
    m = re.search(
        r"(?:^|\n)([ \t]*(?:Bien\s+cordialement|Cordialement|Best\s+regards|Kind\s+regards|Regards|Sincerely)[,.]?)[ \t]*\n([\s\S]+)$",
        body,
        flags=re.IGNORECASE,
    )
    if m and len(m.group(2).strip()) <= 250:
        return body[: m.start(1)] + m.group(1).strip()
    return body


def is_synthetic_ref(ref: str | None) -> bool:
    """Returns True if ref is an internally-synthesized reference like 'SUBJ-01' or 'SUBJ-42'."""
    if not ref:
        return False
    return bool(re.match(r"^SUBJ-\d+$", ref.strip(), re.IGNORECASE))


def is_bare_numeric_ref(ref: str | None) -> bool:
    """Returns True if ref is purely a number, e.g. '1', '18', '01'."""
    if not ref:
        return False
    return bool(re.match(r"^\d+$", ref.strip()))


def apply_subject_line_template(
    template: str | None,
    ref: str | None = None,
    nom: str | None = None,
    prenom: str | None = None,
    language: str = "fr",
    title: str | None = None,
    company: str | None = None,
    candidate_name: str | None = None,
    subjects: list[dict[str, Any]] | None = None,
) -> str:
    """Formats standardized email subject honoring company templates or localized defaults.

    Supports one or multiple selected subjects and ensures synthesized references
    like 'SUBJ-42' are never leaked to recruiters.
    """
    facts = get_candidate_facts_for_lang(language)
    c_nom = nom or facts.get("last_name") or ""
    c_prenom = prenom or facts.get("first_name") or ""
    full_name = candidate_name or facts.get("name") or f"{c_prenom} {c_nom}".strip() or "Candidate"

    items = subjects if subjects else [{"ref": ref or "", "title": title or ""}]
    is_en = language.lower().startswith("en")

    if template:
        ref_tokens: list[str] = []
        title_tokens: list[str] = []
        for item in items:
            r = (item.get("ref") or "").strip()
            t = (item.get("title") or "").strip()
            ref_tokens.append((t or "PFE 2027") if is_synthetic_ref(r) else (r or "PFE 2027"))
            if t:
                title_tokens.append(t)

        topic_str = ", ".join(ref_tokens) if ref_tokens else "PFE 2027"
        title_str = ", ".join(title_tokens)

        res = (
            template.replace("{REF}", topic_str)
            .replace("{ref}", topic_str)
            .replace("{SUJET}", topic_str)
            .replace("{NOM}", c_nom)
            .replace("{PRENOM}", c_prenom)
            .replace("{nom}", c_nom)
            .replace("{prenom}", c_prenom)
            .replace("{CANDIDATE_NAME}", full_name)
            .replace("{candidate_name}", full_name)
        )
        if title_str:
            res = res.replace("{TITLE}", title_str).replace("{title}", title_str)
        if company:
            res = res.replace("{COMPANY}", company).replace("{company}", company)
        return res

    prefix = "PFE Internship Application 2027" if is_en else "Candidature PFE 2027"
    labels: list[str] = []
    for item in items:
        r = (item.get("ref") or "").strip()
        t = (item.get("title") or "").strip()
        if is_synthetic_ref(r):
            labels.append(t or "PFE 2027")
        elif is_bare_numeric_ref(r) and t:
            labels.append(f"Subject {r}: {t}" if is_en else f"Sujet {r} : {t}")
        elif t and r and r.lower() not in t.lower():
            labels.append(f"{r} - {t}")
        else:
            labels.append(r or t or "PFE 2027")

    sep = " | " if len(labels) > 1 and any(" " in lbl for lbl in labels) else ", "
    joined = sep.join(labels) if labels else "PFE 2027"
    return f"{prefix} – {full_name} – {joined}"


def build_gmail_compose_url(
    to: str,
    subject: str,
    body: str,
    cc: list[str] | None = None,
    authuser: str | None = None,
) -> str:
    """Builds pre-filled Gmail web compose URL."""
    params: dict[str, str] = {
        "view": "cm",
        "to": to,
        "su": subject,
        "body": body,
    }
    if cc:
        params["cc"] = ",".join(cc)
    if authuser:
        params["authuser"] = authuser
    return f"https://mail.google.com/mail/?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}"


def build_gmail_inbox_url(authuser: str | None = None) -> str:
    """Builds standard full Gmail inbox URL with new compose window opened."""
    if authuser:
        return f"https://mail.google.com/mail/?authuser={urllib.parse.quote(authuser)}#inbox?compose=new"
    return "https://mail.google.com/mail/#inbox?compose=new"


def format_file_name(
    template: str | None,
    doc_type: str,
    company_name: str,
    subject_ref: str | None = None,
    language: str = "en",
    candidate_name: str | None = None,
) -> str:
    """Formats file names honoring company rules (e.g. CV_{NAME}_{SUBJECT}.pdf)."""
    clean_company = re.sub(r"[^\w\-]", "_", company_name).strip("_")
    # Disregard synthetic subject codes in filenames so CV isn't named CV_<Name>_SUBJ_42.pdf
    if is_synthetic_ref(subject_ref):
        subject_ref = None
    clean_subj = re.sub(r"[^\w\-]", "_", subject_ref or "").strip("_")
    facts = get_candidate_facts_for_lang(language)
    c_name = candidate_name or facts.get("name") or "Candidate"
    name_clean = re.sub(r"[^\w\-]", "_", c_name).strip("_") or "Candidate"

    if template:
        name = template
        name = name.replace("{name}", name_clean).replace("{NAME}", name_clean.upper())
        name = name.replace("{company}", clean_company).replace("{COMPANY}", clean_company.upper())
        subj_replacement = clean_subj if clean_subj else clean_company
        name = name.replace("{subject}", subj_replacement).replace("{SUBJECT}", subj_replacement.upper())
        name = name.replace("{doc_type}", doc_type).replace("{DOC_TYPE}", doc_type.upper())
        if not name.lower().endswith(".pdf"):
            name = f"{name}.pdf"
        return name

    # Standard naming
    if doc_type.lower() == "cv":
        suffix = clean_subj if clean_subj else clean_company
        return f"CV_{name_clean}_{suffix}.pdf"
    elif doc_type.lower() in ("cover_letter", "lettre_de_motivation"):
        return f"Cover_Letter_{name_clean}_{clean_company}.pdf"
    else:
        clean_type = re.sub(r"[^\w\-]", "_", doc_type).strip("_")
        return f"{clean_type}_{name_clean}.pdf"


def compile_cover_letter_typst(
    candidate_name: str,
    candidate_email: str,
    candidate_phone: str,
    company_name: str,
    date_str: str,
    body_text: str,
    language: str = "fr",
    candidate_degree: str | None = None,
    candidate_institution: str | None = None,
    candidate_location: str | None = None,
) -> str:
    """Generates clean Typst markup for a 1-page cover letter matching CV styling."""
    facts = get_candidate_facts_for_lang(language)
    safe_email_label = candidate_email.replace("@", "\\@")
    # Escape Typst syntax characters inside user/LLM body text
    safe_body = (
        body_text.replace("@", "\\@")
        .replace("#", "\\#")
        .replace("$", "\\$")
    )
    is_fr = language.lower() == "fr"

    degree_text = candidate_degree if candidate_degree is not None else facts.get("degree", "")
    institution_text = candidate_institution if candidate_institution is not None else facts.get("institution", "")
    loc_raw = candidate_location if candidate_location is not None else facts.get("location", "")
    city = loc_raw.split(",")[0].strip() if loc_raw else ""

    date_line = (
        f"{city}, le {date_str}" if (is_fr and city)
        else (f"Le {date_str}" if is_fr else (f"{city}, {date_str}" if city else date_str))
    )
    recipient_header = (
        f"*À l'attention de l'équipe de recrutement* \\\\\n    *{company_name}* \\\\\n    #v(0.5em)\n    {date_line}"
        if is_fr
        else f"*To the Attention of the Hiring Team* \\\\\n    *{company_name}* \\\\\n    #v(0.5em)\n    {date_line}"
    )

    left_lines = [f"* {candidate_name} *"]
    if degree_text:
        left_lines.append(degree_text)
    if institution_text:
        left_lines.append(institution_text)
    if candidate_email:
        left_lines.append(f'#link("mailto:{candidate_email}")[{safe_email_label}]')
    if candidate_phone:
        left_lines.append(candidate_phone)
    left_block = " \\\n    ".join(left_lines)

    typst_code = f"""
#set page(
  paper: "a4",
  margin: (x: 2cm, y: 2.2cm),
)
#set text(
  font: "Liberation Sans",
  size: 10.5pt,
  lang: "{"fr" if is_fr else "en"}",
)
#set par(
  justify: true,
  leading: 0.65em,
)

// Header
#grid(
  columns: (1fr, 1fr),
  align(left)[
    {left_block}
  ],
  align(right)[
    {recipient_header}
  ]
)

#v(1.5em)
#line(length: 100%, stroke: 0.5pt + luma(180))
#v(1.5em)

// Content
{safe_body}

#v(1.5em)
#align(right)[
  *{candidate_name}*
]
"""
    return typst_code


def render_cover_letter_pdf(
    body_text: str,
    company_name: str,
    output_path: Path,
    candidate_name: str | None = None,
    candidate_email: str | None = None,
    candidate_phone: str | None = None,
    date_str: str | None = None,
    language: str = "fr",
) -> Path:
    """Renders cover letter text into a clean PDF using Typst compiler."""
    import tempfile
    import typst
    from datetime import date

    facts = get_candidate_facts_for_lang(language)
    c_name = candidate_name or facts.get("name") or "Candidate"
    c_email = candidate_email if candidate_email is not None else facts.get("email", "")
    c_phone = candidate_phone if candidate_phone is not None else facts.get("phone", "")

    d_str = date_str or date.today().strftime("%d/%m/%Y")
    markup = compile_cover_letter_typst(
        candidate_name=c_name,
        candidate_email=c_email,
        candidate_phone=c_phone,
        company_name=company_name,
        date_str=d_str,
        body_text=body_text,
        language=language,
        candidate_degree=facts.get("degree", ""),
        candidate_institution=facts.get("institution", ""),
        candidate_location=facts.get("location", ""),
    )
    output_path = output_path.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.NamedTemporaryFile("w", suffix=".typ", encoding="utf-8", delete=False) as f:
        f.write(markup)
        temp_typ_path = Path(f.name)

    try:
        typst.compile(str(temp_typ_path.resolve()), output=str(output_path))
    finally:
        if temp_typ_path.exists():
            temp_typ_path.unlink()

    return output_path


def generate_email_and_letter(
    company_name: str,
    language: str,
    subjects: list[dict[str, Any]],
    contact_email: str,
    delivery_mode: str = "combined_email",
    include_cover_letter: bool = False,
    user_instruction: str | None = None,
    company_overview: str = "",
    subject_line_template: str | None = None,
    model: str | None = None,
) -> ApplicationDraftResult:
    """Prompts LLM to craft a targeted, high-impact application email and cover letter."""
    is_fr = language.lower() == "fr"
    settings = get_settings()
    active_model = model or settings.get_model_for_job("draft") or DEFAULT_MODEL
    spec = load_job_prompt("draft")

    profile_yaml = load_profile_yaml(language)

    subjects_summary = "\n".join(
        [
            (
                f"- Ref: None (Unnumbered in catalog. Reference strictly by Title: \"{s.get('title', '')}\"; NEVER invent or mention any 'SUBJ-' code) | Title: {s.get('title', '')} | Tech: {', '.join(s.get('technologies', []))} | Description: {s.get('summary', s.get('description', ''))}"
                if is_synthetic_ref(s.get("ref"))
                else f"- Ref: {s.get('ref', 'N/A')} | Title: {s.get('title', '')} | Tech: {', '.join(s.get('technologies', []))} | Description: {s.get('summary', s.get('description', ''))}"
            )
            for s in subjects
        ]
    )

    instruction_clause = (
        f"User Specific Instruction: {user_instruction}\n" if user_instruction else ""
    )

    first_ref = subjects[0].get("ref", "") if subjects else ""
    first_title = subjects[0].get("title", "") if subjects else ""
    candidate_facts = get_candidate_facts_for_lang(language)
    c_nom = candidate_facts.get("last_name") or ""
    c_prenom = candidate_facts.get("first_name") or ""
    c_full_name = candidate_facts.get("name") or f"{c_prenom} {c_nom}".strip() or "Candidate"

    deterministic_subject = None
    if subject_line_template or any(is_synthetic_ref(s.get("ref")) for s in subjects):
        deterministic_subject = apply_subject_line_template(
            template=subject_line_template,
            ref=first_ref,
            title=first_title,
            company=company_name,
            nom=c_nom,
            prenom=c_prenom,
            candidate_name=c_full_name,
            language=language,
            subjects=subjects,
        )

    user_prompt = f"""<candidate_profile language="{language.upper()}">
{profile_yaml}
</candidate_profile>

<candidate_facts>
Name: {candidate_facts['name']}
Email: {candidate_facts['email']}
Phone: {candidate_facts['phone']}
LinkedIn: {candidate_facts['linkedin']}
Current University: {candidate_facts['institution']}
Degree: {candidate_facts['degree']}
Availability: {candidate_facts['availability']}
</candidate_facts>

<company>
Name: {company_name}
Overview: {company_overview or "Not provided"}
</company>

<subjects>
{subjects_summary}
</subjects>

<settings>
Language: {"French" if is_fr else "English"}
Delivery Mode: {delivery_mode}
Include Standalone Cover Letter: {include_cover_letter}
Subject Line Template: {subject_line_template or "None"}
{instruction_clause}
</settings>

<task>
Write a natural, direct application email (and optional cover letter) in the candidate's own voice.
Include a brief overview of the candidate, a concrete reason for choosing this specific project, and 1-2 relevant past projects grounded in <candidate_profile>. Avoid AI cliches and marketing fluff.
</task>
"""

    result = generate_structured_content(
        contents=user_prompt,
        response_schema=DraftResponse,
        model=active_model,
        temperature=spec.temperature if spec.temperature is not None else 0.35,
        system_instruction=spec.system_prompt,
    )

    final_subject = deterministic_subject if deterministic_subject else result.email_subject
    if any(is_synthetic_ref(s.get("ref")) for s in subjects) and "SUBJ-" in final_subject.upper():
        final_subject = apply_subject_line_template(
            template=subject_line_template,
            ref=first_ref,
            title=first_title,
            company=company_name,
            nom=c_nom,
            prenom=c_prenom,
            candidate_name=c_full_name,
            language=language,
            subjects=subjects,
        )

    # Sanitize any synthetic ref leak from email body
    clean_body = re.sub(r"\bSUBJ-\d+\b", "", result.email_body, flags=re.IGNORECASE)
    clean_body = re.sub(r"(?:référence|réf\.|ref\.|reference)\s*[\(\[]?\s*[\)\]]?", "", clean_body, flags=re.IGNORECASE)
    clean_body = re.sub(r"[ \t]{2,}", " ", clean_body).strip()
    clean_body = _strip_trailing_signature(clean_body)

    clean_letter = None
    if include_cover_letter and result.cover_letter_text:
        clean_letter = re.sub(r"\bSUBJ-\d+\b", "", result.cover_letter_text, flags=re.IGNORECASE)
        clean_letter = re.sub(r"(?:référence|réf\.|ref\.|reference)\s*[\(\[]?\s*[\)\]]?", "", clean_letter, flags=re.IGNORECASE)
        clean_letter = re.sub(r"[ \t]{2,}", " ", clean_letter).strip()

    return ApplicationDraftResult(
        language=language,
        delivery_mode=delivery_mode,
        email_to=contact_email,
        email_subject=final_subject,
        email_body=clean_body,
        cover_letter_text=clean_letter,
    )


class PackageItem(BaseModel):
    doc_type: str
    filename: str
    path: str
    exists: bool


class ApplicationPackageResult(BaseModel):
    application_id: int
    company_name: str
    target_folder: str
    generated_files: list[PackageItem]
    missing_user_documents: list[str]
    gmail_compose_urls: list[str]
    gmail_inbox_url: str | None = None
    external_url: str | None = None


def prepare_application_package(
    db: Any,
    application_id: int,
    user_id: str = "local-default",
    sender_email: str | None = None,
    storage: StorageAdapter | None = None,
) -> ApplicationPackageResult:
    """Renders final PDFs into data/applications/<company>_<date>/, copies docs, and returns Gmail URLs."""
    import shutil
    from datetime import date
    from backend.app.models import Application, Listing, UserDocument
    from backend.app.cv.render import render_baseline_cv, get_baseline_filenames
    from backend.app.cv.profiles import get_active_baseline_dir
    baseline_dir = get_active_baseline_dir()

    storage_adapter = storage or get_storage()
    app: Application | None = db.query(Application).filter(Application.id == application_id).first()
    if not app:
        raise ValueError(f"Application {application_id} not found")

    listing: Listing | None = db.query(Listing).filter(Listing.id == app.listing_id).first()
    if not listing:
        raise ValueError(f"Listing for Application {application_id} not found")

    today_str = date.today().strftime("%Y-%m-%d")
    clean_company = re.sub(r"[^\w\-]", "_", listing.company_name).strip("_")
    folder_slug = f"{clean_company}_{today_str}"
    target_dir = storage_adapter.get_application_dir(folder_slug)

    # 1. Determine subject ref
    subject_refs = app.selected_subject_refs or []
    first_subject = subject_refs[0] if subject_refs else None

    # Check extraction naming rule and contact details
    naming_rule: str | None = None
    required_docs_declared: list[str] = []
    cc_emails: list[str] = []
    external_url: str | None = None

    if listing.extraction and listing.extraction.structured_data:
        app_rules = listing.extraction.structured_data.get("application_rules", {})
        naming_rule = app_rules.get("file_naming_rule")
        required_docs_declared = app_rules.get("required_documents", [])
        cc_emails = app_rules.get("cc_emails") or []
        external_url = app_rules.get("external_url")

    generated_items: list[PackageItem] = []

    # 2. Render / Copy CV PDF
    cv_filename = format_file_name(
        template=naming_rule,
        doc_type="cv",
        company_name=listing.company_name,
        subject_ref=first_subject,
        language=app.language or "fr",
    )
    cv_dest = target_dir / cv_filename

    lang = (app.language or "fr").lower()
    baseline_pdf_name, _ = get_baseline_filenames(lang)
    if app.tailor_cv_enabled and app.cv_diff_confirmed and app.cv_staged_diff:
        from backend.app.cv.tailor import StagedCVDiff, apply_staged_cv_diff
        try:
            diff_obj = StagedCVDiff.model_validate(app.cv_staged_diff)
            apply_staged_cv_diff(
                diff=diff_obj,
                output_dir=target_dir,
                output_pdf_name=cv_filename,
                enforce_single_page=True,
                auto_fit=True,
            )
        except Exception:
            baseline_pdf = baseline_dir / baseline_pdf_name
            if not baseline_pdf.exists():
                render_baseline_cv(lang, baseline_dir)
            shutil.copy2(baseline_pdf, cv_dest)
    else:
        baseline_pdf = baseline_dir / baseline_pdf_name
        if not baseline_pdf.exists():
            render_baseline_cv(lang, baseline_dir)
        shutil.copy2(baseline_pdf, cv_dest)

    generated_items.append(
        PackageItem(
            doc_type="cv",
            filename=cv_filename,
            path=str(cv_dest.resolve()),
            exists=cv_dest.exists(),
        )
    )

    # 3. Render Cover Letter PDF if enabled and has text
    if app.include_cover_letter and app.cover_letter_text:
        cl_filename = format_file_name(
            template=naming_rule,
            doc_type="cover_letter",
            company_name=listing.company_name,
            subject_ref=first_subject,
            language=app.language or "fr",
        )
        cl_dest = target_dir / cl_filename
        render_cover_letter_pdf(
            body_text=app.cover_letter_text,
            company_name=listing.company_name,
            output_path=cl_dest,
            language=app.language or "fr",
        )
        generated_items.append(
            PackageItem(
                doc_type="cover_letter",
                filename=cl_filename,
                path=str(cl_dest.resolve()),
                exists=cl_dest.exists(),
            )
        )

    # 4. Copy matching UserDocuments (e.g. transcript, diploma)
    user_docs: list[UserDocument] = (
        db.query(UserDocument).filter(UserDocument.user_id == user_id).all()
    )
    user_docs_by_type = {doc.doc_type.lower(): doc for doc in user_docs}
    missing_docs: list[str] = []

    for req_doc in required_docs_declared:
        req_norm = req_doc.lower().strip()
        matched_udoc: UserDocument | None = None
        for dtype, udoc in user_docs_by_type.items():
            if dtype in req_norm or req_norm in dtype:
                matched_udoc = udoc
                break

        if matched_udoc and matched_udoc.storage_key:
            src_path = storage_adapter.get_pdf_path(matched_udoc.storage_key)
            if src_path and src_path.exists():
                doc_fn = format_file_name(
                    template=naming_rule,
                    doc_type=matched_udoc.doc_type,
                    company_name=listing.company_name,
                    subject_ref=first_subject,
                    language=app.language or "fr",
                )
                dest = target_dir / doc_fn
                shutil.copy2(src_path, dest)
                generated_items.append(
                    PackageItem(
                        doc_type=matched_udoc.doc_type,
                        filename=doc_fn,
                        path=str(dest.resolve()),
                        exists=dest.exists(),
                    )
                )
                continue
        missing_docs.append(req_doc)

    # 5. Build Gmail compose URLs
    facts = get_candidate_facts_for_lang(lang)
    authuser_param = sender_email or facts.get("email") or None
    fallback_cand_name = facts.get("name") or "Candidate"
    gmail_urls: list[str] = []

    if app.delivery_mode == "split_emails" and len(subject_refs) > 1:
        for ref in subject_refs:
            subj_title = f"[{ref}] - {app.email_subject or 'Candidature PFE 2027'}"
            url = build_gmail_compose_url(
                to=app.email_to or "",
                subject=subj_title,
                body=app.email_body or "",
                cc=cc_emails,
                authuser=authuser_param,
            )
            gmail_urls.append(url)
    else:
        url = build_gmail_compose_url(
            to=app.email_to or "",
            subject=app.email_subject or f"Candidature PFE 2027 - {fallback_cand_name}",
            body=app.email_body or "",
            cc=cc_emails,
            authuser=authuser_param,
        )
        gmail_urls.append(url)

    inbox_url = build_gmail_inbox_url(authuser=authuser_param)

    # 6. Update Application state in DB
    from backend.app.storage import LocalStorageAdapter
    if isinstance(storage_adapter, LocalStorageAdapter):
        app.output_dir_key = str(target_dir.relative_to(storage_adapter.data_dir).as_posix())
    else:
        app.output_dir_key = folder_slug

    if app.status == "new":
        app.status = "drafted"
    db.commit()

    return ApplicationPackageResult(
        application_id=app.id,
        company_name=listing.company_name,
        target_folder=str(target_dir.resolve()),
        generated_files=generated_items,
        missing_user_documents=missing_docs,
        gmail_compose_urls=gmail_urls,
        gmail_inbox_url=inbox_url,
        external_url=external_url,
    )
