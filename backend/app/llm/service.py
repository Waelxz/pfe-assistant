"""Orchestration service for extracting and matching listings with SQLite caching."""

from pathlib import Path
from sqlalchemy.orm import Session
from backend.app.config import get_settings
from backend.app.models import Listing, Extraction, SubjectMatch
from backend.app.database import get_current_user_id
from backend.app.llm.schemas import ListingExtraction, SubjectItem, SubjectMatchResult
from backend.app.llm.extract import extract_listing_from_pdf
from backend.app.llm.match import match_listing_subjects, get_profile_hash
from backend.app.llm.client import DEFAULT_MODEL, get_last_model_used


def build_subject_match_row(
    mr: SubjectMatchResult,
    listing_id: int,
    user_id: str,
    profile_hash: str,
) -> SubjectMatch:
    """Build a SubjectMatch ORM row including score_breakdown."""
    has_breakdown = (
        mr.fit_domain + mr.fit_stack + mr.fit_academic + mr.fit_deliverable > 0
        or mr.richness_career + mr.richness_thesis + mr.richness_market > 0
    )
    breakdown = (
        {
            "fit": {
                "domain": mr.fit_domain,
                "stack": mr.fit_stack,
                "academic": mr.fit_academic,
                "deliverable": mr.fit_deliverable,
            },
            "richness": {
                "career": mr.richness_career,
                "thesis": mr.richness_thesis,
                "market": mr.richness_market,
            },
        }
        if has_breakdown
        else None
    )
    return SubjectMatch(
        user_id=user_id,
        listing_id=listing_id,
        subject_ref=mr.subject_ref,
        profile_hash=profile_hash,
        score=mr.score,
        compatibility_tier=mr.compatibility_tier,
        why_match=mr.why_match,
        interest_score=mr.interest_score,
        interest_tier=mr.interest_tier,
        why_interesting=mr.why_interesting,
        matched_skills=mr.matched_skills,
        missing_gaps=mr.missing_gaps,
        score_breakdown=breakdown,
    )


def process_listing(
    db: Session,
    listing: Listing,
    force_extract: bool = False,
    force_match: bool = False,
    user_id: str | None = None,
) -> tuple[Extraction, list[SubjectMatch]]:
    """Extract listing details and compute subject matches, utilizing DB cache."""
    uid = user_id or get_current_user_id()
    settings = get_settings()

    if not listing.pdf_storage_key:
        raise ValueError(f"Listing {listing.slug} has no downloaded PDF.")

    # PDF path on disk
    pdf_rel = listing.pdf_storage_key.removeprefix("pdfs/")
    pdf_path = settings.pdf_dir / pdf_rel
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found on disk: {pdf_path}")

    # 1. Extraction (cached by pdf_sha256)
    active_extraction = (
        db.query(Extraction)
        .filter(
            Extraction.listing_id == listing.id,
            Extraction.pdf_sha256 == listing.pdf_sha256,
        )
        .order_by(Extraction.id.desc())
        .first()
    )

    fresh_extracted = False
    if active_extraction and not force_extract:
        structured_data = ListingExtraction(**active_extraction.structured_data)
        if listing.sync_status != "extracted":
            listing.sync_status = "extracted"
            db.commit()
    else:
        extract_model = settings.get_model_for_job("extract")
        structured_data = extract_listing_from_pdf(
            pdf_path=pdf_path,
            description_html=listing.description_html or "",
            company_hint=listing.company_name,
            pdf_sha256=listing.pdf_sha256,
            model=extract_model,
        )

        active_extraction = Extraction(
            listing_id=listing.id,
            pdf_sha256=listing.pdf_sha256 or "",
            model_used=get_last_model_used() or extract_model,
            structured_data=structured_data.model_dump(),
        )
        db.add(active_extraction)
        listing.sync_status = "extracted"
        if structured_data.location and not listing.location:
            listing.location = structured_data.location
        hints = dict(listing.html_hints or {})
        if (
            listing.wp_post_id < 0
            and hints.get("auto_company_name")
            and structured_data.company_name
        ):
            listing.company_name = structured_data.company_name
            hints["auto_company_name"] = False
            listing.html_hints = hints
        db.commit()
        db.refresh(active_extraction)
        fresh_extracted = True

    # 2. Profile Matching (cached by sha256 of master.en.yaml + master.fr.yaml)
    current_profile_hash = get_profile_hash()

    existing_matches = (
        db.query(SubjectMatch)
        .filter(
            SubjectMatch.listing_id == listing.id,
            SubjectMatch.user_id == uid,
            SubjectMatch.profile_hash == current_profile_hash,
        )
        .all()
    )

    subjects = structured_data.subjects
    subject_refs = {s.ref for s in subjects}
    existing_refs = {m.subject_ref for m in existing_matches}

    if (
        existing_matches
        and not force_match
        and not force_extract
        and subject_refs == existing_refs
    ):
        return active_extraction, existing_matches

    # Re-calculate matches
    import time
    if fresh_extracted:
        time.sleep(4.5)  # Pace between PDF extraction and profile matching to stay under 15 RPM

    match_results = match_listing_subjects(
        subjects=subjects,
        language=structured_data.primary_language,
        model=settings.get_model_for_job("match"),
    )

    # Clean old matches for this listing/user
    db.query(SubjectMatch).filter(
        SubjectMatch.listing_id == listing.id,
        SubjectMatch.user_id == uid,
    ).delete()

    saved_matches: list[SubjectMatch] = []
    for mr in match_results:
        sm = build_subject_match_row(mr, listing.id, uid, current_profile_hash)
        db.add(sm)
        saved_matches.append(sm)

    db.commit()
    for sm in saved_matches:
        db.refresh(sm)

    return active_extraction, saved_matches
