"""FastAPI application entry point."""

import asyncio
import io
import json
import math
import zipfile
import yaml
from pathlib import Path
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Literal
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.app.config import get_settings
from backend.app.database import get_db, init_db, get_current_user_id
from backend.app.models import Listing, Extraction, SubjectMatch, SubjectComparison, Application, UserDocument
from backend.app.sync.service import SyncService, SyncSummary, SyncProgressEvent
from backend.app.llm.service import process_listing, build_subject_match_row
from backend.app.draft import (
    generate_email_and_letter,
    prepare_application_package,
    apply_subject_line_template,
    ApplicationDraftResult,
    ApplicationPackageResult,
)
from backend.app.cv.tailor import (
    generate_staged_cv_diff,
    apply_staged_cv_diff,
    StagedCVDiff,
    PageOverflowError,
)
from backend.app.cv.profile_schema import CandidateProfile

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure database tables exist on startup
    init_db()
    settings.ensure_directories()
    yield


app = FastAPI(
    title="PFE Assistant API",
    version="0.2.0",
    lifespan=lifespan,
)

# Restrict CORS to local browser origins so third-party tabs cannot probe localhost
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve only non-sensitive asset subdirectories (never expose settings.json or app.db)
settings.ensure_directories()
for _subdir in ("pdfs", "profiles", "applications", "documents"):
    _mount_path = settings.data_dir / _subdir
    _mount_path.mkdir(parents=True, exist_ok=True)
    app.mount(f"/data/{_subdir}", StaticFiles(directory=str(_mount_path)), name=f"data_{_subdir}")

# Global event queue for SSE sync progress
_sync_queues: list[asyncio.Queue] = []
_sync_lock = asyncio.Lock()


@app.get("/api/config")
def get_app_config(user_id: str = Depends(get_current_user_id)):
    """Return runtime application configuration."""
    from backend.app.llm.match import get_profile_hash
    from backend.app.cv.profile_schema import load_candidate_profile
    from backend.app.cv.profiles import (
        get_active_profile_dir,
        get_active_profile_id,
        get_available_languages,
        get_baseline_url_prefix,
    )

    cfg = get_settings()
    pdir = get_active_profile_dir()
    active_pid = get_active_profile_id()
    avail_langs = get_available_languages(pdir)
    profile_hash = get_profile_hash()
    candidate_name = ""
    candidate_email = ""
    candidate_institution = ""
    candidate_headline = ""
    has_profile = len(avail_langs) > 0
    if has_profile:
        try:
            cand_prof = load_candidate_profile("en" if "en" in avail_langs else avail_langs[0], profile_dir=pdir)
            candidate_name = cand_prof.basics.name
            candidate_email = cand_prof.basics.email
            candidate_institution = cand_prof.basics.institution or (
                cand_prof.education[0].institution if cand_prof.education else ""
            )
            candidate_headline = cand_prof.headline or ""
            has_profile = bool(candidate_name.strip())
        except Exception:
            has_profile = False

    return {
        "app_mode": cfg.app_mode,
        "user_id": user_id,
        "gemini_configured": cfg.is_llm_configured(),
        "llm_provider": cfg.llm_provider,
        "llm_provider_preset": cfg.llm_provider_preset,
        "llm_model": cfg.llm_model,
        "enable_pfebooks_sync": cfg.enable_pfebooks_sync,
        "active_profile_id": active_pid,
        "available_languages": avail_langs,
        "baseline_url_prefix": get_baseline_url_prefix(active_pid),
        "onboarding_completed": cfg.onboarding_completed,
        "has_profile": has_profile,
        "data_dir": str(cfg.data_dir),
        "profile_hash": profile_hash,
        "tailor_cv_enabled": False,
        "candidate_name": candidate_name,
        "candidate_email": candidate_email,
        "candidate_institution": candidate_institution,
        "candidate_headline": candidate_headline,
    }


@app.get("/api/settings")
def get_runtime_settings():
    """Return current BYOK LLM settings (with API key masked) and provider presets."""
    from backend.app.settings_store import PROVIDER_PRESETS, mask_api_key

    cfg = get_settings()
    raw_key = cfg.llm_api_key or cfg.gemini_api_key or ""
    return {
        "llm_provider_preset": cfg.llm_provider_preset,
        "llm_provider": cfg.llm_provider,
        "api_key_masked": mask_api_key(raw_key),
        "api_key_configured": cfg.is_llm_configured(),
        "llm_base_url": cfg.llm_base_url,
        "llm_model": cfg.llm_model,
        "llm_fallback_model": cfg.llm_fallback_model,
        "llm_model_extract": cfg.llm_model_extract,
        "llm_model_match": cfg.llm_model_match,
        "llm_model_draft": cfg.llm_model_draft,
        "llm_model_tailor": cfg.llm_model_tailor,
        "enable_pfebooks_sync": cfg.enable_pfebooks_sync,
        "active_profile_id": cfg.active_profile_id,
        "onboarding_completed": cfg.onboarding_completed,
        "presets": PROVIDER_PRESETS,
    }


@app.put("/api/settings")
def update_runtime_settings(payload: dict):
    """Persist BYOK settings into <data_dir>/settings.json and hot-reload LLM client."""
    from backend.app.config import reload_settings
    from backend.app.settings_store import (
        SettingsUpdateRequest,
        is_masked_placeholder,
        save_stored_settings,
    )

    req = SettingsUpdateRequest(**payload)
    cfg = get_settings()

    updates: dict = {}
    for field_name in (
        "llm_provider_preset",
        "llm_provider",
        "llm_base_url",
        "llm_model",
        "llm_fallback_model",
        "enable_pfebooks_sync",
        "active_profile_id",
        "onboarding_completed",
    ):
        val = getattr(req, field_name)
        if val is not None:
            updates[field_name] = val

    # Allow clearing per-job overrides when explicitly passed as "" or null in payload
    for job_field in ("llm_model_extract", "llm_model_match", "llm_model_draft", "llm_model_tailor"):
        if job_field in payload:
            raw = payload[job_field]
            updates[job_field] = raw.strip() if isinstance(raw, str) and raw.strip() else None

    if "llm_api_key" in payload and req.llm_api_key is not None:
        if not is_masked_placeholder(req.llm_api_key):
            updates["llm_api_key"] = req.llm_api_key.strip()

    # Ensure existing env key isn't lost if settings.json didn't exist yet and key wasn't modified
    if "llm_api_key" not in updates and (cfg.llm_api_key or cfg.gemini_api_key):
        updates.setdefault("llm_api_key", cfg.llm_api_key or cfg.gemini_api_key)

    save_stored_settings(cfg.data_dir, updates)
    reload_settings()
    return get_runtime_settings()


@app.post("/api/settings/test-llm")
def test_llm_settings(payload: dict | None = None):
    """Test LLM API key & model connectivity using supplied inputs or active settings."""
    from backend.app.llm.client import test_llm_connection
    from backend.app.settings_store import is_masked_placeholder

    body = payload or {}
    cfg = get_settings()
    raw_key = body.get("llm_api_key")
    if raw_key is None or (isinstance(raw_key, str) and is_masked_placeholder(raw_key)):
        effective_key = cfg.llm_api_key or cfg.gemini_api_key
    else:
        effective_key = raw_key.strip()

    try:
        res = test_llm_connection(
            provider=body.get("llm_provider") or cfg.llm_provider,
            api_key=effective_key,
            base_url=body.get("llm_base_url") or cfg.llm_base_url,
            model=body.get("llm_model") or cfg.llm_model,
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection test failed: {str(e)}")


def _serialize_listing_summary(item: Listing, user_id: str) -> dict:
    """Serialize a Listing into the summary dictionary returned by catalogue endpoints."""
    user_matches = [m for m in item.subject_matches if m.user_id == user_id]
    best_subject = max(
        user_matches,
        key=lambda m: (
            math.sqrt(m.score * m.interest_score)
            if (getattr(m, "interest_score", None) or 0) > 0
            else float(m.score)
        ),
        default=None,
    )
    best_score = best_subject.score if best_subject else None
    best_interest_score = (
        best_subject.interest_score
        if best_subject and (getattr(best_subject, "interest_score", None) or 0) > 0
        else None
    )

    app_record = next((a for a in item.applications if a.user_id == user_id), None)

    rules = {}
    has_pdf_extraction = bool(item.extraction and item.extraction.structured_data)
    if has_pdf_extraction:
        rules = item.extraction.structured_data.get("application_rules", {})
        data_source = "pdf"
        apply_method = rules.get("method")
        if (not apply_method or apply_method == "unknown") and item.html_hints:
            apply_method = item.html_hints.get("apply_method") or apply_method
        deadline = rules.get("deadline_iso") or rules.get("deadline_raw")
        location = item.extraction.structured_data.get("location") or item.location
        subject_count = len(user_matches) or len(item.extraction.structured_data.get("subjects", []))
    else:
        hints = item.html_hints or {}
        data_source = "pdf" if item.wp_post_id < 0 else "html_preview"
        apply_method = hints.get("apply_method")
        deadline = hints.get("deadline")
        location = item.location
        subject_count = hints.get("subject_count", 0)

    return {
        "id": item.id,
        "wp_post_id": item.wp_post_id,
        "slug": item.slug,
        "company_name": item.company_name,
        "post_url": item.post_url,
        "published_at": item.published_at.isoformat() if item.published_at else None,
        "modified_at": item.modified_at.isoformat() if item.modified_at else None,
        "catalogue_term": item.catalogue_term,
        "categories": item.categories or [],
        "tags": item.tags or [],
        "location": location,
        "data_source": data_source,
        "pdf_url": item.pdf_url,
        "pdf_storage_key": item.pdf_storage_key,
        "pdf_sha256": item.pdf_sha256,
        "sync_status": item.sync_status,
        "best_match_score": best_score,
        "best_interest_score": best_interest_score,
        "subject_count": subject_count,
        "application_id": app_record.id if app_record else None,
        "application_status": app_record.status if app_record else None,
        "apply_method": apply_method,
        "deadline": deadline,
        "max_subjects_allowed": rules.get("max_subjects_allowed"),
        "html_hints": item.html_hints or {},
    }


@app.get("/api/listings")
def list_listings(
    db: Session = Depends(get_db),
    catalogue: str = "2026-2027",
    user_id: str = Depends(get_current_user_id),
):
    """Return all listings in the target catalogue with match summary."""
    query = db.query(Listing)
    if catalogue:
        query = query.filter(Listing.catalogue_term == catalogue)
    listings = query.order_by(Listing.published_at.desc()).all()
    return [_serialize_listing_summary(item, user_id) for item in listings]


@app.post("/api/listings/upload")
async def upload_custom_pfe_book(
    file: UploadFile = File(...),
    company_name: str = Form(""),
    location: str = Form(""),
    post_url: str = Form(""),
    extract_now: bool = Form(True),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Upload a user-supplied PFE Book PDF, create a catalogue listing, and optionally extract & score it."""
    import hashlib
    import re
    from datetime import datetime, timezone
    from pathlib import Path
    import pymupdf
    from sqlalchemy import func
    from backend.app.storage import get_storage

    # Support both query and multipart form fields
    content = await file.read()
    if not content or not content.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=400,
            detail="Uploaded file is not a valid PDF (missing %PDF- header).",
        )

    try:
        doc = pymupdf.open(stream=content, filetype="pdf")
        page_count = len(doc)
        doc.close()
        if page_count < 1:
            raise ValueError("PDF has 0 pages.")
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read PDF file: {exc}",
        )

    computed_sha = hashlib.sha256(content).hexdigest()
    storage = get_storage()

    # Check if a listing with this exact PDF SHA256 already exists
    existing = db.query(Listing).filter(Listing.pdf_sha256 == computed_sha).first()
    raw_company = company_name.strip()
    auto_company = not bool(raw_company)

    if not raw_company:
        stem = Path(file.filename or "PFE Book").stem
        cleaned = re.sub(r"[_\-]+", " ", stem)
        cleaned = re.sub(r"(?i)\b(pfe|book|catalogue|stage|stages|2025|2026|2027)\b", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        raw_company = cleaned.title() if cleaned else stem

    if existing:
        if company_name.strip():
            existing.company_name = company_name.strip()
        if location.strip():
            existing.location = location.strip()
        if post_url.strip():
            existing.post_url = post_url.strip()
        existing.modified_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(existing)
        target_listing = existing
    else:
        base_slug = re.sub(r"[^a-z0-9]+", "-", raw_company.lower()).strip("-") or "custom-pfe"
        slug = base_slug
        if db.query(Listing).filter(Listing.slug == slug).first():
            slug = f"{base_slug}-{computed_sha[:6]}"

        pdf_filename = f"{slug}_{computed_sha[:8]}.pdf"
        storage_key = storage.save_pdf(pdf_filename, content)

        min_wp_id = db.query(func.min(Listing.wp_post_id)).scalar() or 0
        next_wp_id = min(0, int(min_wp_id)) - 1
        now = datetime.now(timezone.utc)

        target_listing = Listing(
            wp_post_id=next_wp_id,
            slug=slug,
            company_name=raw_company,
            post_url=post_url.strip(),
            published_at=now,
            modified_at=now,
            catalogue_term="2026-2027",
            categories=["User Uploaded"],
            tags=[],
            description_html="",
            description_text="",
            pdf_url=None,
            pdf_storage_key=storage_key,
            pdf_sha256=computed_sha,
            sync_status="downloaded",
            location=location.strip() or None,
            html_hints={
                "source": "user_upload",
                "auto_company_name": auto_company,
                "original_filename": file.filename or pdf_filename,
                "page_count": page_count,
            },
        )
        db.add(target_listing)
        db.commit()
        db.refresh(target_listing)

    extraction_error: str | None = None
    if extract_now:
        try:
            await asyncio.to_thread(
                process_listing,
                db=db,
                listing=target_listing,
                force_extract=False,
                force_match=False,
                user_id=user_id,
            )
            db.refresh(target_listing)
        except Exception as exc:
            extraction_error = str(exc)

    return {
        "status": "success",
        "already_existed": existing is not None,
        "extracted": target_listing.sync_status == "extracted",
        "extraction_error": extraction_error,
        "listing": _serialize_listing_summary(target_listing, user_id),
    }


@app.delete("/api/listings/{listing_id}")
def delete_listing(
    listing_id: int,
    db: Session = Depends(get_db),
):
    """Delete a user-uploaded listing and its local PDF if unused."""
    from backend.app.storage import get_storage

    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    storage = get_storage()
    if listing.wp_post_id < 0 and listing.pdf_storage_key:
        pdf_path = storage.get_pdf_path(listing.pdf_storage_key)
        if pdf_path and pdf_path.exists():
            try:
                pdf_path.unlink()
            except Exception:
                pass

    db.delete(listing)
    db.commit()
    return {"status": "success", "deleted_id": listing_id}


@app.get("/api/listings/{listing_id}")
def get_listing(listing_id: int, db: Session = Depends(get_db)):
    """Return detailed information for a single listing."""
    item = db.query(Listing).filter(Listing.id == listing_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Listing not found")

    return {
        "id": item.id,
        "wp_post_id": item.wp_post_id,
        "slug": item.slug,
        "company_name": item.company_name,
        "post_url": item.post_url,
        "published_at": item.published_at.isoformat() if item.published_at else None,
        "modified_at": item.modified_at.isoformat() if item.modified_at else None,
        "catalogue_term": item.catalogue_term,
        "categories": item.categories,
        "tags": item.tags,
        "description_html": item.description_html,
        "description_text": item.description_text,
        "location": item.location,
        "html_hints": item.html_hints or {},
        "pdf_url": item.pdf_url,
        "pdf_storage_key": item.pdf_storage_key,
        "pdf_sha256": item.pdf_sha256,
        "sync_status": item.sync_status,
    }


@app.post("/api/listings/{listing_id}/archive")
def toggle_archive_listing(
    listing_id: int,
    archived: bool = True,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Shelve / archive a company listing to hide it from the catalogue."""
    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    app_record = (
        db.query(Application)
        .filter(Application.listing_id == listing_id, Application.user_id == user_id)
        .first()
    )

    if not app_record:
        app_record = Application(
            user_id=user_id,
            listing_id=listing_id,
            status="archived" if archived else "new",
        )
        db.add(app_record)
    else:
        app_record.status = "archived" if archived else "new"

    db.commit()
    db.refresh(app_record)
    return {
        "status": "success",
        "listing_id": listing_id,
        "application_id": app_record.id,
        "application_status": app_record.status,
    }


def _serialize_subject_match(m: SubjectMatch) -> dict:
    return {
        "subject_ref": m.subject_ref,
        "score": m.score,
        "compatibility_tier": m.compatibility_tier,
        "why_match": m.why_match,
        "interest_score": getattr(m, "interest_score", 0) or 0,
        "interest_tier": getattr(m, "interest_tier", "medium") or "medium",
        "why_interesting": getattr(m, "why_interesting", "") or "",
        "matched_skills": m.matched_skills,
        "missing_gaps": m.missing_gaps,
        "score_breakdown": getattr(m, "score_breakdown", None),
    }


@app.get("/api/listings/{listing_id}/extraction")
def get_listing_extraction(
    listing_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Return active extraction and subject matches for a listing."""
    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    extraction = (
        db.query(Extraction)
        .filter(Extraction.listing_id == listing_id)
        .order_by(Extraction.id.desc())
        .first()
    )

    matches = (
        db.query(SubjectMatch)
        .filter(
            SubjectMatch.listing_id == listing_id,
            SubjectMatch.user_id == user_id,
        )
        .order_by(SubjectMatch.score.desc())
        .all()
    )

    from backend.app.llm.match import get_profile_hash

    profile_hash = get_profile_hash()
    latest_comp = (
        db.query(SubjectComparison)
        .filter(
            SubjectComparison.listing_id == listing_id,
            SubjectComparison.user_id == user_id,
            SubjectComparison.profile_hash == profile_hash,
        )
        .order_by(SubjectComparison.id.desc())
        .first()
    )

    return {
        "listing_id": listing_id,
        "extracted": extraction is not None,
        "extraction": extraction.structured_data if extraction else None,
        "matches": [_serialize_subject_match(m) for m in matches],
        "latest_comparison": (
            {
                **latest_comp.result,
                "subject_refs": latest_comp.subject_refs,
                "cached": True,
            }
            if latest_comp and isinstance(latest_comp.result, dict)
            else None
        ),
    }


@app.post("/api/listings/{listing_id}/extract")
def extract_and_match(
    listing_id: int,
    force_extract: bool = False,
    force_match: bool = False,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Run extraction on listing PDF and score subjects against candidate profile."""
    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    if not listing.pdf_storage_key:
        raise HTTPException(
            status_code=400, detail="Listing has no downloaded PDF to extract"
        )

    try:
        extraction, matches = process_listing(
            db=db,
            listing=listing,
            force_extract=force_extract,
            force_match=force_match,
            user_id=user_id,
        )
        return {
            "status": "success",
            "listing_id": listing.id,
            "company_name": listing.company_name,
            "extraction": extraction.structured_data,
            "matches": [_serialize_subject_match(m) for m in matches],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {str(e)}")


@app.post("/api/listings/{listing_id}/rematch")
def rematch_listing_subjects(
    listing_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Re-score already-extracted subjects against current CV + Career Goals without re-extracting PDF."""
    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if not listing.extraction or not listing.extraction.structured_data:
        raise HTTPException(status_code=400, detail="Listing has no extracted subjects yet")

    try:
        extraction, matches = process_listing(
            db=db,
            listing=listing,
            force_extract=False,
            force_match=True,
            user_id=user_id,
        )
        return {
            "status": "success",
            "listing_id": listing.id,
            "extraction": extraction.structured_data,
            "matches": [_serialize_subject_match(m) for m in matches],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Re-scoring failed: {str(e)}")


class CompareSubjectsRequest(BaseModel):
    subject_refs: list[str] = Field(..., min_length=2)
    force: bool = False


@app.post("/api/listings/{listing_id}/compare-subjects")
def compare_listing_subjects_endpoint(
    listing_id: int,
    payload: CompareSubjectsRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Head-to-head AI comparison of 2+ selected subjects against CV + Career Goals (cached in SQLite)."""
    from backend.app.llm.schemas import SubjectItem
    from backend.app.llm.match import compare_listing_subjects, get_profile_hash

    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not listing or not listing.extraction or not listing.extraction.structured_data:
        raise HTTPException(status_code=404, detail="Extracted listing not found")

    raw_subjs = listing.extraction.structured_data.get("subjects", [])
    ref_set = set(payload.subject_refs)
    selected = [SubjectItem(**s) for s in raw_subjs if s.get("ref") in ref_set]
    if len(selected) < 2:
        raise HTTPException(status_code=400, detail="Select at least 2 valid subjects to compare")

    canonical_refs = sorted({s.ref for s in selected})
    refs_key = "|".join(canonical_refs)
    profile_hash = get_profile_hash()

    if not payload.force:
        cached = (
            db.query(SubjectComparison)
            .filter(
                SubjectComparison.listing_id == listing_id,
                SubjectComparison.user_id == user_id,
                SubjectComparison.subject_refs_key == refs_key,
                SubjectComparison.profile_hash == profile_hash,
            )
            .order_by(SubjectComparison.id.desc())
            .first()
        )
        if cached and isinstance(cached.result, dict):
            return {
                **cached.result,
                "subject_refs": cached.subject_refs or canonical_refs,
                "cached": True,
            }

    lang = listing.extraction.structured_data.get("primary_language", "fr")
    try:
        comparison = compare_listing_subjects(subjects=selected, language=lang)
        result_dict = comparison.model_dump()

        db.query(SubjectComparison).filter(
            SubjectComparison.listing_id == listing_id,
            SubjectComparison.user_id == user_id,
            SubjectComparison.subject_refs_key == refs_key,
        ).delete()
        db.add(
            SubjectComparison(
                user_id=user_id,
                listing_id=listing_id,
                subject_refs_key=refs_key,
                subject_refs=canonical_refs,
                profile_hash=profile_hash,
                result=result_dict,
            )
        )
        db.commit()

        return {
            **result_dict,
            "subject_refs": canonical_refs,
            "cached": False,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Comparison failed: {str(e)}")


async def _run_sync_task(extract_listings: bool = False):
    """Background sync worker broadcasting events to all SSE listener queues."""
    from backend.app.database import SessionLocal

    db = SessionLocal()
    sync_service = SyncService()

    def on_progress(event: SyncProgressEvent):
        data = event.model_dump()
        for q in list(_sync_queues):
            try:
                q.put_nowait(data)
            except Exception:
                pass

    try:
        await sync_service.run_sync(db, extract_listings=extract_listings, on_progress=on_progress)
    finally:
        db.close()
        # Send terminal signal
        for q in list(_sync_queues):
            try:
                q.put_nowait({"step": "done"})
            except Exception:
                pass


@app.post("/api/sync")
async def trigger_sync(background_tasks: BackgroundTasks, extract: bool = False):
    """Trigger background sync with pfebooks.com (extract=False avoids burning LLM quota upfront)."""
    if _sync_lock.locked():
        return {"status": "in_progress", "message": "Sync is already running."}

    async def locked_worker():
        async with _sync_lock:
            await _run_sync_task(extract_listings=extract)

    background_tasks.add_task(locked_worker)
    return {"status": "started", "message": "Background sync started."}


@app.get("/api/sync/stream")
async def sync_event_stream():
    """Server-Sent Events endpoint pushing real-time sync progress."""
    queue: asyncio.Queue = asyncio.Queue()
    _sync_queues.append(queue)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            while True:
                data = await queue.get()
                yield f"data: {json.dumps(data)}\n\n"
                if data.get("step") == "done":
                    break
        finally:
            if queue in _sync_queues:
                _sync_queues.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# -------------------------------------------------------------------------
# Phase 4: Application Drafting, Documents Library & Prepare-Send Endpoints
# -------------------------------------------------------------------------

from pydantic import BaseModel, Field
from typing import Literal
from fastapi import UploadFile, File, Form


class DraftRequest(BaseModel):
    listing_id: int
    selected_subject_refs: list[str]
    language: Literal["fr", "en"] = "fr"
    delivery_mode: Literal["combined_email", "split_emails", "external_form"] = "combined_email"
    include_cover_letter: bool = False
    user_instruction: str | None = None


class RegenerateRequest(BaseModel):
    user_instruction: str | None = None
    target: Literal["all", "email", "cover_letter"] = "all"


class StatusUpdateRequest(BaseModel):
    status: Literal["new", "drafted", "opened_gmail", "sent", "interview", "rejected", "archived"]
    notes: str | None = None


@app.post("/api/applications/draft")
def draft_application(
    payload: DraftRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Creates or updates an application draft with generated email and cover letter."""
    listing = db.query(Listing).filter(Listing.id == payload.listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    # Find relevant subjects from extraction
    matched_subjects: list[dict] = []
    contact_email = ""
    if listing.extraction and listing.extraction.structured_data:
        data = listing.extraction.structured_data
        rules = data.get("application_rules", {})
        contact_email = (
            rules.get("recipient_email")
            or data.get("company", {}).get("contact_email")
            or ""
        )
        all_subjs = data.get("subjects", [])
        for s in all_subjs:
            if s.get("ref") in payload.selected_subject_refs or not payload.selected_subject_refs:
                matched_subjects.append(s)

    if not matched_subjects and listing.extraction and listing.extraction.structured_data:
        matched_subjects = listing.extraction.structured_data.get("subjects", [])[:1]

    # Call LLM drafting
    company_overview = ""
    subject_line_tmpl = None
    if listing.extraction and listing.extraction.structured_data:
        data = listing.extraction.structured_data
        company_overview = data.get("company_overview", "")
        rules = data.get("application_rules", {})
        subject_line_tmpl = rules.get("subject_line_template")

    try:
        draft = generate_email_and_letter(
            company_name=listing.company_name,
            language=payload.language,
            subjects=matched_subjects,
            contact_email=contact_email,
            delivery_mode=payload.delivery_mode,
            include_cover_letter=payload.include_cover_letter,
            user_instruction=payload.user_instruction,
            company_overview=company_overview,
            subject_line_template=subject_line_tmpl,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM drafting failed: {str(e)}")

    # Check existing draft for this user and listing
    app_record = (
        db.query(Application)
        .filter(Application.user_id == user_id, Application.listing_id == payload.listing_id)
        .first()
    )

    if not app_record:
        app_record = Application(
            user_id=user_id,
            listing_id=payload.listing_id,
            selected_subject_refs=payload.selected_subject_refs,
            language=payload.language,
            delivery_mode=payload.delivery_mode,
            status="drafted",
            email_to=draft.email_to,
            email_subject=draft.email_subject,
            email_body=draft.email_body,
            include_cover_letter=payload.include_cover_letter,
            cover_letter_text=draft.cover_letter_text,
        )
        db.add(app_record)
    else:
        app_record.selected_subject_refs = payload.selected_subject_refs
        app_record.language = payload.language
        app_record.delivery_mode = payload.delivery_mode
        app_record.status = "drafted"
        app_record.email_to = draft.email_to
        app_record.email_subject = draft.email_subject
        app_record.email_body = draft.email_body
        app_record.include_cover_letter = payload.include_cover_letter
        app_record.cover_letter_text = draft.cover_letter_text

    db.commit()
    db.refresh(app_record)

    return {
        "status": "success",
        "application_id": app_record.id,
        "email_to": app_record.email_to,
        "email_subject": app_record.email_subject,
        "email_body": app_record.email_body,
        "include_cover_letter": app_record.include_cover_letter,
        "cover_letter_text": app_record.cover_letter_text,
        "delivery_mode": app_record.delivery_mode,
        "language": app_record.language,
    }


@app.get("/api/applications")
def list_applications(
    status: str | None = None,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Lists all applications with listing summary metadata for tracker view."""
    query = (
        db.query(Application)
        .filter(Application.user_id == user_id)
        .order_by(Application.updated_at.desc())
    )
    if status and status != "all":
        query = query.filter(Application.status == status)
    else:
        query = query.filter(~Application.status.in_(["new", "archived"]))

    apps = query.all()

    # Preload all listings
    listing_ids = [a.listing_id for a in apps]
    listings = {l.id: l for l in db.query(Listing).filter(Listing.id.in_(listing_ids)).all()} if listing_ids else {}

    results = []
    for a in apps:
        l = listings.get(a.listing_id)
        company_name = l.company_name if l else "Unknown Company"
        slug = l.slug if l else ""
        rules = (
            l.extraction.structured_data.get("application_rules", {})
            if (l and l.extraction and l.extraction.structured_data)
            else {}
        )
        apply_method = rules.get("method")
        if (not apply_method or apply_method == "unknown") and l and l.html_hints:
            apply_method = l.html_hints.get("apply_method") or apply_method
        apply_method = apply_method or "email"
        deadline = rules.get("deadline_iso") or rules.get("deadline_raw")

        all_subjs = (
            l.extraction.structured_data.get("subjects", [])
            if (l and l.extraction and l.extraction.structured_data)
            else []
        )
        title_by_ref = {s.get("ref"): s.get("title") for s in all_subjs if s.get("ref")}
        sel_refs = a.selected_subject_refs or []
        sel_titles = [title_by_ref.get(r, r) for r in sel_refs]

        results.append({
            "id": a.id,
            "listing_id": a.listing_id,
            "company_name": company_name,
            "slug": slug,
            "apply_method": apply_method,
            "deadline": deadline,
            "selected_subject_refs": sel_refs,
            "selected_subject_titles": sel_titles,
            "language": a.language,
            "delivery_mode": a.delivery_mode,
            "status": a.status,
            "email_to": a.email_to,
            "email_subject": a.email_subject,
            "include_cover_letter": a.include_cover_letter,
            "tailor_cv_enabled": a.tailor_cv_enabled,
            "cv_diff_confirmed": a.cv_diff_confirmed,
            "output_dir_key": a.output_dir_key,
            "notes": a.notes,
            "sent_at": a.sent_at.isoformat() if a.sent_at else None,
            "updated_at": a.updated_at.isoformat() if a.updated_at else None,
        })

    return results


@app.get("/api/applications/by-listing/{listing_id}")
def get_application_by_listing(
    listing_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Fetch existing application for a given listing, or create a placeholder draft if none exists."""
    app_record = (
        db.query(Application)
        .filter(Application.listing_id == listing_id, Application.user_id == user_id)
        .first()
    )
    if not app_record:
        # Create lightweight placeholder record so cv-diff and status tracking are immediately available
        listing = db.query(Listing).filter(Listing.id == listing_id).first()
        top_refs = []
        contact_email = ""
        subject_line = ""
        book_lang = "fr"
        if listing and listing.extraction and listing.extraction.structured_data:
            data = listing.extraction.structured_data
            if data.get("primary_language") in ("fr", "en"):
                book_lang = data.get("primary_language")
            rules = data.get("application_rules", {})
            contact_email = (
                rules.get("recipient_email")
                or data.get("company", {}).get("contact_email")
                or ""
            )
            subjs = data.get("subjects", [])
            best_match = (
                db.query(SubjectMatch)
                .filter(
                    SubjectMatch.listing_id == listing_id,
                    SubjectMatch.user_id == user_id,
                )
                .order_by(SubjectMatch.score.desc())
                .first()
            )
            if best_match:
                top_refs = [best_match.subject_ref]
            elif subjs:
                top_refs = [subjs[0].get("ref")]

            first_ref = top_refs[0] if top_refs else "PFE 2027"
            first_title = None
            selected_subjs = []
            subj_by_ref = {s.get("ref"): s for s in subjs if s.get("ref")}
            for r in top_refs:
                if r in subj_by_ref:
                    selected_subjs.append(subj_by_ref[r])
            if selected_subjs:
                first_title = selected_subjs[0].get("title")

            # Apply company template or default
            tmpl = rules.get("subject_line_template")
            subject_line = apply_subject_line_template(
                template=tmpl,
                ref=first_ref,
                title=first_title,
                company=listing.company_name if listing else None,
                language=book_lang,
                subjects=selected_subjs or None,
            )

        app_record = Application(
            user_id=user_id,
            listing_id=listing_id,
            selected_subject_refs=top_refs,
            language=book_lang,
            status="new",
            email_to=contact_email,
            email_subject=subject_line,
        )
        db.add(app_record)
        db.commit()
        db.refresh(app_record)
    else:
        # Backfill empty email_to, email_subject, or ungenerated language from listing extraction
        listing = db.query(Listing).filter(Listing.id == listing_id).first()
        if listing and listing.extraction and listing.extraction.structured_data:
            data = listing.extraction.structured_data
            book_lang = data.get("primary_language", "fr")
            if book_lang not in ("fr", "en"):
                book_lang = "fr"
            rules = data.get("application_rules", {})
            contact_email = (
                rules.get("recipient_email")
                or data.get("company", {}).get("contact_email")
                or ""
            )
            updated = False
            if not app_record.email_to and contact_email:
                app_record.email_to = contact_email
                updated = True
            if not app_record.email_body and app_record.language != book_lang:
                app_record.language = book_lang
                updated = True

            subjs = data.get("subjects", [])
            best_match = (
                db.query(SubjectMatch)
                .filter(
                    SubjectMatch.listing_id == listing_id,
                    SubjectMatch.user_id == user_id,
                )
                .order_by(SubjectMatch.score.desc())
                .first()
            )
            best_ref = (
                best_match.subject_ref
                if best_match
                else (subjs[0].get("ref") if subjs else None)
            )

            # If placeholder application has no topics or was never edited, ensure best match topic
            if not app_record.selected_subject_refs and best_ref:
                app_record.selected_subject_refs = [best_ref]
                updated = True

            if not app_record.email_subject or "SUBJ-" in (app_record.email_subject or "").upper():
                top_refs = app_record.selected_subject_refs or ([best_ref] if best_ref else [])
                topic_str = top_refs[0] if top_refs else "PFE 2027"
                subj_by_ref = {s.get("ref"): s for s in subjs if s.get("ref")}
                selected_subjs = [subj_by_ref[r] for r in top_refs if r in subj_by_ref]
                first_title = selected_subjs[0].get("title") if selected_subjs else None
                tmpl = rules.get("subject_line_template")
                app_record.email_subject = apply_subject_line_template(
                    template=tmpl,
                    ref=topic_str,
                    title=first_title,
                    company=listing.company_name if listing else None,
                    language=book_lang,
                    subjects=selected_subjs or None,
                )
                updated = True
            if updated:
                db.commit()
                db.refresh(app_record)

    # Resolve human-readable subject titles
    active_listing = listing or db.query(Listing).filter(Listing.id == listing_id).first()
    all_subjs = (
        active_listing.extraction.structured_data.get("subjects", [])
        if (active_listing and active_listing.extraction and active_listing.extraction.structured_data)
        else []
    )
    title_by_ref = {s.get("ref"): s.get("title") for s in all_subjs if s.get("ref")}
    sel_refs = app_record.selected_subject_refs or []
    sel_titles = [title_by_ref.get(r, r) for r in sel_refs]

    return {
        "id": app_record.id,
        "listing_id": app_record.listing_id,
        "selected_subject_refs": sel_refs,
        "selected_subject_titles": sel_titles,
        "language": app_record.language,
        "delivery_mode": app_record.delivery_mode,
        "status": app_record.status,
        "email_to": app_record.email_to,
        "email_subject": app_record.email_subject,
        "email_body": app_record.email_body,
        "include_cover_letter": app_record.include_cover_letter,
        "cover_letter_text": app_record.cover_letter_text,
        "tailor_cv_enabled": app_record.tailor_cv_enabled,
        "cv_staged_diff": app_record.cv_staged_diff,
        "cv_diff_confirmed": app_record.cv_diff_confirmed,
        "output_dir_key": app_record.output_dir_key,
        "notes": app_record.notes,
        "sent_at": app_record.sent_at.isoformat() if app_record.sent_at else None,
        "updated_at": app_record.updated_at.isoformat() if app_record.updated_at else None,
    }


@app.get("/api/applications/{application_id}")
def get_application(
    application_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Fetch an application by ID."""
    app_record = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user_id)
        .first()
    )
    if not app_record:
        raise HTTPException(status_code=404, detail="Application not found")
    listing = db.query(Listing).filter(Listing.id == app_record.listing_id).first()
    all_subjs = (
        listing.extraction.structured_data.get("subjects", [])
        if (listing and listing.extraction and listing.extraction.structured_data)
        else []
    )
    title_by_ref = {s.get("ref"): s.get("title") for s in all_subjs if s.get("ref")}
    sel_refs = app_record.selected_subject_refs or []
    sel_titles = [title_by_ref.get(r, r) for r in sel_refs]

    return {
        "id": app_record.id,
        "listing_id": app_record.listing_id,
        "selected_subject_refs": sel_refs,
        "selected_subject_titles": sel_titles,
        "language": app_record.language,
        "delivery_mode": app_record.delivery_mode,
        "status": app_record.status,
        "email_to": app_record.email_to,
        "email_subject": app_record.email_subject,
        "email_body": app_record.email_body,
        "include_cover_letter": app_record.include_cover_letter,
        "cover_letter_text": app_record.cover_letter_text,
        "tailor_cv_enabled": app_record.tailor_cv_enabled,
        "cv_staged_diff": app_record.cv_staged_diff,
        "cv_diff_confirmed": app_record.cv_diff_confirmed,
        "output_dir_key": app_record.output_dir_key,
        "notes": app_record.notes,
        "sent_at": app_record.sent_at.isoformat() if app_record.sent_at else None,
        "updated_at": app_record.updated_at.isoformat() if app_record.updated_at else None,
    }


@app.post("/api/applications/{application_id}/regenerate")
def regenerate_application(
    application_id: int,
    payload: RegenerateRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Regenerates application email or cover letter based on user instruction."""
    app_record = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user_id)
        .first()
    )
    if not app_record:
        raise HTTPException(status_code=404, detail="Application not found")

    listing = db.query(Listing).filter(Listing.id == app_record.listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    matched_subjects: list[dict] = []
    company_overview = ""
    subject_line_tmpl = None
    if listing.extraction and listing.extraction.structured_data:
        data = listing.extraction.structured_data
        company_overview = data.get("company_overview", "")
        rules = data.get("application_rules", {})
        subject_line_tmpl = rules.get("subject_line_template")
        all_subjs = data.get("subjects", [])
        for s in all_subjs:
            if s.get("ref") in (app_record.selected_subject_refs or []):
                matched_subjects.append(s)

    try:
        draft = generate_email_and_letter(
            company_name=listing.company_name,
            language=app_record.language or "fr",
            subjects=matched_subjects,
            contact_email=app_record.email_to or "",
            delivery_mode=app_record.delivery_mode or "combined_email",
            include_cover_letter=app_record.include_cover_letter,
            user_instruction=payload.user_instruction,
            company_overview=company_overview,
            subject_line_template=subject_line_tmpl,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM regeneration failed: {str(e)}")

    if payload.target in ("all", "email"):
        app_record.email_subject = draft.email_subject
        app_record.email_body = draft.email_body
    if payload.target in ("all", "cover_letter") and app_record.include_cover_letter:
        app_record.cover_letter_text = draft.cover_letter_text

    db.commit()
    db.refresh(app_record)

    return {
        "status": "success",
        "application_id": app_record.id,
        "email_subject": app_record.email_subject,
        "email_body": app_record.email_body,
        "cover_letter_text": app_record.cover_letter_text,
    }


class CVDegenerateDiffRequest(BaseModel):
    user_instruction: str | None = None


class CVConfirmRequest(BaseModel):
    diff: StagedCVDiff


@app.post("/api/applications/{application_id}/cv-diff")
def generate_cv_diff_endpoint(
    application_id: int,
    payload: CVDegenerateDiffRequest | None = None,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Generates a StagedCVDiff for the subjects selected in the application."""
    app_record = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user_id)
        .first()
    )
    if not app_record:
        raise HTTPException(status_code=404, detail="Application not found")

    listing = db.query(Listing).filter(Listing.id == app_record.listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    matched_subjects: list[dict] = []
    if listing.extraction and listing.extraction.structured_data:
        data = listing.extraction.structured_data
        all_subjs = data.get("subjects", [])
        for s in all_subjs:
            if s.get("ref") in (app_record.selected_subject_refs or []):
                matched_subjects.append(s)

    instruction = payload.user_instruction if payload else None
    try:
        staged_diff = generate_staged_cv_diff(
            subjects=matched_subjects,
            language=app_record.language or "fr",
            user_instruction=instruction,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CV tailoring failed: {str(e)}")

    app_record.cv_staged_diff = staged_diff.model_dump()
    app_record.tailor_cv_enabled = True
    app_record.cv_diff_confirmed = False
    db.commit()

    return {
        "status": "success",
        "application_id": app_record.id,
        "diff": staged_diff.model_dump(),
    }


class CVDraftSaveRequest(BaseModel):
    diff: StagedCVDiff


@app.put("/api/applications/{application_id}/cv-draft")
def save_cv_draft_endpoint(
    application_id: int,
    payload: CVDraftSaveRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Saves in-progress StagedCVDiff edits without compiling PDF yet."""
    app_record = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user_id)
        .first()
    )
    if not app_record:
        raise HTTPException(status_code=404, detail="Application not found")

    from backend.app.cv.tailor import recompute_unverified_keywords
    computed_diff = recompute_unverified_keywords(payload.diff)

    app_record.cv_staged_diff = computed_diff.model_dump()
    app_record.tailor_cv_enabled = True
    db.commit()

    return {
        "status": "success",
        "application_id": app_record.id,
        "diff": app_record.cv_staged_diff,
    }


@app.post("/api/applications/{application_id}/cv-preview")
def preview_cv_diff_endpoint(
    application_id: int,
    payload: CVConfirmRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Renders live 1-page PDF/PNG preview for current staged diff without locking/confirming application status."""
    from backend.app.storage import get_storage
    storage = get_storage()

    app_record = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user_id)
        .first()
    )
    if not app_record:
        raise HTTPException(status_code=404, detail="Application not found")

    from backend.app.cv.tailor import recompute_unverified_keywords
    computed_diff = recompute_unverified_keywords(payload.diff)

    preview_dir = storage.get_application_dir(f"previews/app_{app_record.id}")
    try:
        render_res = apply_staged_cv_diff(
            diff=computed_diff,
            output_dir=preview_dir,
            output_pdf_name="CV_Preview.pdf",
            enforce_single_page=True,
            auto_fit=True,
        )
    except PageOverflowError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Preview exceeded 1-page layout ({e.page_count} pages).",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview render failed: {str(e)}")

    return {
        "status": "success",
        "application_id": app_record.id,
        "metrics": render_res["metrics"],
        "layout_preset_applied": render_res.get("layout_preset_applied", 0),
        "auto_compressed": render_res.get("auto_compressed", False),
        "pdf_url": f"/data/applications/previews/app_{app_record.id}/CV_Preview.pdf",
        "png_url": f"/data/applications/previews/app_{app_record.id}/CV_Preview.png",
    }


@app.put("/api/applications/{application_id}/cv-confirm")
def confirm_cv_diff_endpoint(
    application_id: int,
    payload: CVConfirmRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Saves user-accepted/edited CV diff and renders 1-page PDF preview."""
    from backend.app.storage import get_storage
    storage = get_storage()

    app_record = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user_id)
        .first()
    )
    if not app_record:
        raise HTTPException(status_code=404, detail="Application not found")

    from backend.app.cv.tailor import recompute_unverified_keywords
    computed_diff = recompute_unverified_keywords(payload.diff)

    preview_dir = storage.get_application_dir(f"previews/app_{app_record.id}")
    try:
        render_res = apply_staged_cv_diff(
            diff=computed_diff,
            output_dir=preview_dir,
            output_pdf_name="CV_Preview.pdf",
            enforce_single_page=True,
            auto_fit=True,
        )
    except PageOverflowError as e:
        raise HTTPException(
            status_code=422,
            detail=f"CV exceeded 1-page layout lock ({e.page_count} pages). Please shorten or uncheck items.",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to render tailored CV: {str(e)}")

    final_diff = render_res.get("fitted_diff", computed_diff)
    app_record.cv_staged_diff = final_diff.model_dump()
    app_record.cv_diff_confirmed = True
    app_record.tailor_cv_enabled = True
    if app_record.status == "new":
        app_record.status = "drafted"
    db.commit()

    return {
        "status": "success",
        "application_id": app_record.id,
        "cv_diff_confirmed": True,
        "diff": app_record.cv_staged_diff,
        "metrics": render_res["metrics"],
        "layout_preset_applied": render_res.get("layout_preset_applied", 0),
        "auto_compressed": render_res.get("auto_compressed", False),
        "pdf_url": f"/data/applications/previews/app_{app_record.id}/CV_Preview.pdf",
        "png_url": f"/data/applications/previews/app_{app_record.id}/CV_Preview.png",
    }


@app.post("/api/applications/{application_id}/prepare-send")
def prepare_send_application(
    application_id: int,
    sender_email: str | None = None,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Compiles application package into data/applications/<company>_<date>/ and returns Gmail URLs."""
    try:
        pkg = prepare_application_package(
            db=db,
            application_id=application_id,
            user_id=user_id,
            sender_email=sender_email,
        )
        return {
            "status": "success",
            "package": pkg.model_dump(),
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Package preparation failed: {str(e)}")


def _resolve_application_output_dir(app_record: Application) -> Path:
    """Resolve and validate the compiled package directory for an application."""
    from backend.app.storage import get_storage, LocalStorageAdapter
    storage = get_storage()
    if not isinstance(storage, LocalStorageAdapter):
        raise HTTPException(status_code=501, detail="Download not supported in this storage mode")
    if not app_record.output_dir_key:
        raise HTTPException(status_code=404, detail="Package not compiled yet. Click Prepare Package first.")
    target_dir = (storage.data_dir / app_record.output_dir_key).resolve()
    apps_root = storage.applications_dir.resolve()
    if apps_root not in target_dir.parents or not target_dir.exists():
        raise HTTPException(status_code=404, detail="Compiled application package directory not found.")
    return target_dir


@app.get("/api/applications/{application_id}/download-zip")
def download_application_zip(
    application_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Packages all compiled application attachments into a single downloadable .zip archive."""
    import re
    app_record = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user_id)
        .first()
    )
    if not app_record:
        raise HTTPException(status_code=404, detail="Application not found")

    target_dir = _resolve_application_output_dir(app_record)
    files = [p for p in sorted(target_dir.iterdir()) if p.is_file()]
    if not files:
        raise HTTPException(status_code=404, detail="No compiled files found in application package.")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for fpath in files:
            zf.write(fpath, arcname=fpath.name)
    buf.seek(0)

    company = app_record.listing.company_name if app_record.listing else "Application"
    safe_company = re.sub(r"[^\w\-]", "_", company).strip("_") or "Application"
    zip_name = f"{safe_company}_PFE_Application.zip"

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@app.get("/api/applications/{application_id}/files/{filename}")
def download_application_file(
    application_id: int,
    filename: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Downloads an individual compiled PDF/attachment from the application package."""
    app_record = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user_id)
        .first()
    )
    if not app_record:
        raise HTTPException(status_code=404, detail="Application not found")

    target_dir = _resolve_application_output_dir(app_record)
    safe_name = Path(filename).name
    if safe_name != filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    file_path = (target_dir / safe_name).resolve()
    if file_path.parent != target_dir or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found in package")

    return FileResponse(
        path=str(file_path),
        filename=safe_name,
        media_type="application/pdf" if safe_name.lower().endswith(".pdf") else "application/octet-stream",
    )


class ApplicationEditRequest(BaseModel):
    email_to: str | None = None
    email_subject: str | None = None
    email_body: str | None = None
    cover_letter_text: str | None = None
    include_cover_letter: bool | None = None
    language: Literal["fr", "en"] | None = None
    delivery_mode: Literal["combined_email", "split_emails", "external_form"] | None = None
    selected_subject_refs: list[str] | None = None
    tailor_cv_enabled: bool | None = None


@app.patch("/api/applications/{application_id}")
def update_application_edits(
    application_id: int,
    payload: ApplicationEditRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Updates manual email/letter/config fields of an application draft."""
    app_record = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user_id)
        .first()
    )
    if not app_record:
        raise HTTPException(status_code=404, detail="Application not found")

    if payload.email_to is not None:
        app_record.email_to = payload.email_to
    if payload.email_subject is not None:
        app_record.email_subject = payload.email_subject
    if payload.email_body is not None:
        app_record.email_body = payload.email_body
    if payload.cover_letter_text is not None:
        app_record.cover_letter_text = payload.cover_letter_text
    if payload.include_cover_letter is not None:
        app_record.include_cover_letter = payload.include_cover_letter
    if payload.language is not None:
        app_record.language = payload.language
    if payload.delivery_mode is not None:
        app_record.delivery_mode = payload.delivery_mode
    if payload.selected_subject_refs is not None:
        app_record.selected_subject_refs = payload.selected_subject_refs
    if payload.tailor_cv_enabled is not None:
        app_record.tailor_cv_enabled = payload.tailor_cv_enabled

    # Promote to drafted if substantive content was provided
    if app_record.status == "new" and (
        (app_record.email_body and app_record.email_body.strip())
        or (app_record.cover_letter_text and app_record.cover_letter_text.strip())
        or app_record.cv_diff_confirmed
    ):
        app_record.status = "drafted"

    db.commit()
    db.refresh(app_record)

    return {
        "status": "success",
        "application_id": app_record.id,
        "application_status": app_record.status,
    }


@app.delete("/api/applications/{application_id}")
def delete_application(
    application_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Resets and deletes an application record, removing it from the tracker."""
    app_record = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user_id)
        .first()
    )
    if not app_record:
        raise HTTPException(status_code=404, detail="Application not found")

    db.delete(app_record)
    db.commit()
    return {"status": "success", "deleted_id": application_id}


@app.patch("/api/applications/{application_id}/status")
def update_application_status(
    application_id: int,
    payload: StatusUpdateRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Updates application pipeline status (e.g. sent, interview, rejected)."""
    import datetime

    app_record = (
        db.query(Application)
        .filter(Application.id == application_id, Application.user_id == user_id)
        .first()
    )
    if not app_record:
        raise HTTPException(status_code=404, detail="Application not found")

    app_record.status = payload.status
    if payload.notes is not None:
        app_record.notes = payload.notes.strip()
    if payload.status == "sent" and not app_record.sent_at:
        app_record.sent_at = datetime.datetime.now(datetime.timezone.utc)

    db.commit()
    return {
        "status": "success",
        "application_id": app_record.id,
        "new_status": app_record.status,
        "notes": app_record.notes,
    }


@app.get("/api/documents")
def list_user_documents(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Returns all reusable documents (transcripts, diploma, etc.) uploaded by user."""
    docs = db.query(UserDocument).filter(UserDocument.user_id == user_id).all()
    return [
        {
            "id": d.id,
            "doc_type": d.doc_type,
            "label": d.label,
            "storage_key": d.storage_key,
            "original_filename": d.original_filename,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in docs
    ]


@app.post("/api/documents")
async def upload_user_document(
    file: UploadFile = File(...),
    doc_type: str = Form(...),
    label: str = Form(...),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Uploads a reusable document file to local storage and saves record."""
    from backend.app.storage import get_storage

    storage = get_storage()
    content = await file.read()
    orig_name = file.filename or f"{doc_type}.pdf"
    storage_key = storage.save_document(f"{doc_type}_{orig_name}", content)

    doc = UserDocument(
        user_id=user_id,
        doc_type=doc_type.lower().strip(),
        label=label.strip(),
        storage_key=storage_key,
        original_filename=orig_name,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    return {
        "status": "success",
        "document_id": doc.id,
        "doc_type": doc.doc_type,
        "label": doc.label,
        "storage_key": doc.storage_key,
    }


@app.delete("/api/documents/{document_id}")
def delete_user_document(
    document_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Deletes a reusable document record."""
    doc = (
        db.query(UserDocument)
        .filter(UserDocument.id == document_id, UserDocument.user_id == user_id)
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    db.delete(doc)
    db.commit()
    return {"status": "success", "deleted_id": document_id}


class ProfileCreateRequest(BaseModel):
    name: str
    activate: bool = True


@app.get("/api/profiles")
def get_all_profiles():
    """List all local candidate profiles and active profile ID."""
    from backend.app.cv.profiles import list_profiles, get_active_profile_id
    return {
        "active_profile_id": get_active_profile_id(),
        "profiles": list_profiles(),
    }


@app.post("/api/profiles")
def create_new_profile(payload: ProfileCreateRequest):
    """Create a new candidate profile workspace."""
    from backend.app.cv.profiles import create_profile
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Profile name is required")
    prof = create_profile(name=payload.name.strip(), activate=payload.activate)
    return {"status": "success", "profile": prof}


@app.post("/api/profiles/{profile_id}/activate")
def switch_active_profile(profile_id: str):
    """Switch active candidate profile (isolates match scores, tracker, and documents)."""
    from backend.app.cv.profiles import activate_profile
    try:
        prof = activate_profile(profile_id)
        return {"status": "success", "profile": prof}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/profiles/{profile_id}")
def remove_profile(profile_id: str):
    """Delete a candidate profile directory."""
    from backend.app.cv.profiles import delete_profile
    try:
        delete_profile(profile_id)
        return {"status": "success", "deleted_id": profile_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/profile/load-sample")
def load_sample_candidate_profile(
    lang: Literal["en", "fr", "both"] = "both",
):
    """Populate active profile with a clean generic sample CV and render baseline PDF/PNG."""
    from backend.app.cv.profiles import get_sample_profile, get_active_profile_dir, get_active_baseline_dir
    from backend.app.cv.profile_schema import save_candidate_profile
    from backend.app.cv.render import render_baseline_cv

    pdir = get_active_profile_dir()
    bdir = get_active_baseline_dir()
    langs = ["en", "fr"] if lang == "both" else [lang]
    for code in langs:
        sample = CandidateProfile(**get_sample_profile(code))  # type: ignore[arg-type]
        save_candidate_profile(sample, code, profile_dir=pdir, auto_fit=True)
        render_baseline_cv(code, bdir, profile_dir=pdir)
    return {"status": "success", "languages": langs}


@app.get("/api/profile/preview")
def get_profile_preview(lang: Literal["en", "fr"] = "fr"):
    """Validates master YAML and returns 1-page baseline PDF verification status."""
    from backend.app.cv.render import render_baseline_cv
    from backend.app.cv.profiles import get_active_baseline_dir, get_active_profile_dir

    pdir = get_active_profile_dir()
    bdir = get_active_baseline_dir()
    res = render_baseline_cv(lang, bdir, profile_dir=pdir)
    return {
        "status": "success",
        "language": lang,
        "page_count": res["page_count"],
        "pdf_path": str(res["pdf_path"]),
        "png_path": str(res["png_path"]),
    }


@app.get("/api/profile")
def get_full_profile(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Returns candidate profiles for EN & FR (supporting single-language), layout metrics, and profile hash."""
    from backend.app.cv.profile_schema import load_candidate_profile
    from backend.app.cv.profiles import (
        get_active_baseline_dir,
        get_active_profile_dir,
        get_active_profile_id,
        get_available_languages,
        get_baseline_url_prefix,
    )
    from backend.app.cv.render import verify_cv_layout, get_baseline_filenames
    from backend.app.llm.match import get_profile_hash
    from backend.app.models import SubjectMatch

    pdir = get_active_profile_dir()
    bdir = get_active_baseline_dir()
    pid = get_active_profile_id()
    url_prefix = get_baseline_url_prefix(pid)
    avail_langs = get_available_languages(pdir)

    prof_en = load_candidate_profile("en", profile_dir=pdir) if "en" in avail_langs else None
    prof_fr = load_candidate_profile("fr", profile_dir=pdir) if "fr" in avail_langs else None
    curr_hash = get_profile_hash()

    metrics = {}
    for l_code in ("en", "fr"):
        pdf_name, png_name = get_baseline_filenames(l_code)
        pdf_path = bdir / pdf_name
        if l_code in avail_langs and pdf_path.exists():
            try:
                m = verify_cv_layout(pdf_path)
                metrics[l_code] = {
                    "page_count": m["page_count"],
                    "last_y1_pt": m["last_y1_pt"],
                    "max_y1_pt": 825.0,
                    "pdf_url": f"{url_prefix}/{pdf_name}",
                    "png_url": f"{url_prefix}/{png_name}",
                    "valid": m["page_count"] == 1 and m["last_y1_pt"] <= 825.0,
                }
            except Exception as e:
                metrics[l_code] = {"valid": False, "error": str(e)}
        else:
            metrics[l_code] = {
                "valid": False,
                "error": "Not created yet" if l_code not in avail_langs else "Baseline PDF not found",
            }

    outdated_count = db.query(SubjectMatch.listing_id).filter(
        SubjectMatch.user_id == user_id,
        SubjectMatch.profile_hash != curr_hash,
    ).distinct().count()

    return {
        "en": prof_en,
        "fr": prof_fr,
        "available_languages": avail_langs,
        "active_profile_id": pid,
        "baseline_url_prefix": url_prefix,
        "metrics": metrics,
        "profile_hash": curr_hash,
        "outdated_listings_count": outdated_count,
    }


@app.put("/api/profile/{lang}")
def update_profile(
    lang: Literal["en", "fr"],
    profile: CandidateProfile,
    auto_fit: bool = True,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Compiles profile to YAML, validates 1-page layout with progressive presets, renders baseline PDF+PNG, and saves."""
    from backend.app.cv.profile_schema import save_candidate_profile, load_candidate_profile
    from backend.app.cv.profiles import (
        get_active_baseline_dir,
        get_active_profile_dir,
        get_active_profile_id,
        get_baseline_url_prefix,
    )
    from backend.app.cv.render import render_baseline_cv, get_baseline_filenames, MAX_BOTTOM_Y1_PT
    from backend.app.llm.match import get_profile_hash

    lang_code = lang.lower()
    pdir = get_active_profile_dir()
    bdir = get_active_baseline_dir()
    pid = get_active_profile_id()
    url_prefix = get_baseline_url_prefix(pid)

    save_candidate_profile(profile, lang_code, profile_dir=pdir, auto_fit=auto_fit)
    baseline_res = render_baseline_cv(lang_code, bdir, profile_dir=pdir)

    pdf_name, png_name = get_baseline_filenames(lang_code)
    return {
        "status": "success",
        "language": lang_code,
        "profile": load_candidate_profile(lang_code, profile_dir=pdir),
        "metrics": {
            "page_count": baseline_res["page_count"],
            "last_y1_pt": baseline_res["last_y1_pt"],
            "max_y1_pt": MAX_BOTTOM_Y1_PT,
            "pdf_url": f"{url_prefix}/{pdf_name}",
            "png_url": f"{url_prefix}/{png_name}",
        },
        "profile_hash": get_profile_hash(),
    }


@app.post("/api/profile/preview-draft/{lang}")
def preview_profile_draft(
    lang: Literal["en", "fr"],
    profile: CandidateProfile,
    preset: int = 0,
):
    """Renders a draft profile to preview PDF & PNG without saving to master YAML."""
    import tempfile
    from backend.app.cv.profile_schema import compile_profile_to_yaml_dict
    from backend.app.cv.profiles import (
        get_active_baseline_dir,
        get_active_profile_id,
        get_baseline_url_prefix,
    )
    from backend.app.cv.render import (
        render_cv_pdf,
        verify_cv_layout,
        render_pdf_to_png,
        apply_typography_preset_to_yaml_dict,
        MAX_BOTTOM_Y1_PT,
    )

    lang_code = lang.lower()
    bdir = get_active_baseline_dir()
    url_prefix = get_baseline_url_prefix(get_active_profile_id())
    yaml_dict = compile_profile_to_yaml_dict(profile, lang_code)
    if preset != 0:
        yaml_dict = apply_typography_preset_to_yaml_dict(yaml_dict, preset_level=preset)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        t_yaml = tmp_path / f"draft_{lang_code}.yaml"
        t_yaml.write_text(yaml.safe_dump(yaml_dict, sort_keys=False, allow_unicode=True), encoding="utf-8")

        out_pdf_name = f"draft_preview_{lang_code}.pdf"
        out_png_name = f"draft_preview_{lang_code}.png"
        try:
            pdf_path = render_cv_pdf(t_yaml, bdir, output_name=out_pdf_name, enforce_single_page=False)
            metrics = verify_cv_layout(pdf_path)
            render_pdf_to_png(pdf_path, bdir / out_png_name)

            return {
                "status": "success",
                "page_count": metrics["page_count"],
                "last_y1_pt": metrics["last_y1_pt"],
                "max_y1_pt": MAX_BOTTOM_Y1_PT,
                "valid_1_page": metrics["page_count"] == 1 and metrics["last_y1_pt"] <= MAX_BOTTOM_Y1_PT,
                "pdf_url": f"{url_prefix}/{out_pdf_name}",
                "png_url": f"{url_prefix}/{out_png_name}",
            }
        except Exception as exc:
            return {
                "status": "error",
                "message": str(exc),
                "valid_1_page": False,
            }


@app.post("/api/profile/import-pdf")
async def import_profile_from_pdf(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """Parses an uploaded CV PDF into structured CandidateProfile using active LLM provider."""
    import tempfile
    from backend.app.cv.profile_schema import ProfileImportResponse, normalize_profile_for_ats
    from backend.app.llm.client import generate_structured_content, DEFAULT_MODEL, prepare_pdf_input
    from backend.app.llm.prompts.loader import load_job_prompt

    content = await file.read()
    if not content or not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid PDF.")

    spec = load_job_prompt("profile_import")
    cfg = get_settings()
    active_model = cfg.get_model_for_job("extract") or DEFAULT_MODEL

    with tempfile.NamedTemporaryFile("wb", suffix=".pdf", delete=False) as tmp:
        tmp.write(content)
        tmp_pdf_path = Path(tmp.name)

    try:
        pdf_input = prepare_pdf_input(tmp_pdf_path)
        contents_payload: list = []
        if isinstance(pdf_input, str):
            contents_payload.append(f"<resume_text>\n{pdf_input}\n</resume_text>\nExtract and ATS-optimize this resume into CandidateProfile.")
        elif isinstance(pdf_input, list):
            contents_payload.extend(pdf_input)
            contents_payload.append("Extract and ATS-optimize this candidate's resume/CV into structured CandidateProfile format.")
        else:
            contents_payload.append(pdf_input)
            contents_payload.append("Extract and ATS-optimize this candidate's resume/CV into structured CandidateProfile format.")

        response = generate_structured_content(
            contents=contents_payload,
            response_schema=ProfileImportResponse,
            model=active_model,
            temperature=spec.temperature or 0.15,
            system_instruction=spec.system_prompt,
        )

        normalized_profile = normalize_profile_for_ats(response.profile)
        return {
            "status": "success",
            "detected_language": response.detected_language,
            "profile": normalized_profile,
        }
    finally:
        if tmp_pdf_path.exists():
            tmp_pdf_path.unlink()


class ProfileOptimizePayload(BaseModel):
    lang: Literal["en", "fr"]
    profile: CandidateProfile


@app.post("/api/profile/optimize")
def optimize_profile_ats(
    payload: ProfileOptimizePayload,
    user_id: str = Depends(get_current_user_id),
):
    """Upgrades an existing CandidateProfile to 90+ Resume Worded / ATS standards without fabricating facts."""
    from backend.app.cv.profile_schema import ProfileOptimizeResponse, normalize_profile_for_ats
    from backend.app.llm.client import generate_structured_content, DEFAULT_MODEL
    from backend.app.llm.prompts.loader import load_job_prompt

    spec = load_job_prompt("profile_optimize")
    cfg = get_settings()
    active_model = cfg.get_model_for_job("tailor") or DEFAULT_MODEL

    user_prompt = f"""<candidate_profile language="{payload.lang.upper()}">
{payload.profile.model_dump_json(indent=2)}
</candidate_profile>

<task>
Upgrade this CV profile to 90+ Resume Worded / ATS standards in {payload.lang.upper()}.
Keep 100% of real facts, companies, dates, tools, and numbers verbatim — zero fabrication.
Return the optimized profile and a short list of concrete improvements applied.
</task>
"""

    res = generate_structured_content(
        contents=user_prompt,
        response_schema=ProfileOptimizeResponse,
        model=active_model,
        temperature=spec.temperature or 0.2,
        system_instruction=spec.system_prompt,
    )

    optimized_profile = normalize_profile_for_ats(res.profile)
    optimized_profile.language = payload.lang
    return {
        "status": "success",
        "language": payload.lang,
        "profile": optimized_profile,
        "improvements": res.improvements,
    }


class ProfileTranslatePayload(BaseModel):
    source_lang: Literal["en", "fr"]
    target_lang: Literal["en", "fr"]
    profile: CandidateProfile
    auto_save: bool = False


@app.post("/api/profile/translate")
def translate_profile(
    payload: ProfileTranslatePayload,
    user_id: str = Depends(get_current_user_id),
):
    """Translates a CandidateProfile between French and English while preserving metrics and 1-page length."""
    from backend.app.cv.profile_schema import ProfileTranslateResponse, save_candidate_profile, normalize_profile_for_ats
    from backend.app.cv.profiles import (
        get_active_baseline_dir,
        get_active_profile_dir,
        get_active_profile_id,
        get_baseline_url_prefix,
    )
    from backend.app.cv.render import render_baseline_cv, get_baseline_filenames
    from backend.app.llm.client import generate_structured_content, DEFAULT_MODEL
    from backend.app.llm.prompts.loader import load_job_prompt

    spec = load_job_prompt("profile_translate")
    cfg = get_settings()
    active_model = cfg.get_model_for_job("draft") or DEFAULT_MODEL

    user_prompt = f"""<source_profile source_language="{payload.source_lang.upper()}" target_language="{payload.target_lang.upper()}">
{payload.profile.model_dump_json(indent=2)}
</source_profile>

<task>
Translate this profile into idiomatic, high-impact {payload.target_lang.upper()} for technical recruitment.
Preserve 100% of numbers, metrics, dates, and tools.
Respect 1-page character length budget.
</task>
"""

    res = generate_structured_content(
        contents=user_prompt,
        response_schema=ProfileTranslateResponse,
        model=active_model,
        temperature=spec.temperature or 0.1,
        system_instruction=spec.system_prompt,
    )

    translated_profile = normalize_profile_for_ats(res.profile)
    translated_profile.language = payload.target_lang

    metrics = None
    if payload.auto_save:
        pdir = get_active_profile_dir()
        bdir = get_active_baseline_dir()
        url_prefix = get_baseline_url_prefix(get_active_profile_id())
        save_candidate_profile(translated_profile, payload.target_lang, profile_dir=pdir, auto_fit=True)
        base_res = render_baseline_cv(payload.target_lang, bdir, profile_dir=pdir)
        pdf_name, png_name = get_baseline_filenames(payload.target_lang)
        metrics = {
            "page_count": base_res["page_count"],
            "last_y1_pt": base_res["last_y1_pt"],
            "pdf_url": f"{url_prefix}/{pdf_name}",
            "png_url": f"{url_prefix}/{png_name}",
        }

    return {
        "status": "success",
        "target_language": payload.target_lang,
        "profile": translated_profile,
        "metrics": metrics,
    }


@app.post("/api/profile/rescore-all")
def rescore_all_listings(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Re-scores all extracted listings against the current profile hash."""
    from backend.app.llm.match import get_profile_hash, match_listing_subjects
    from backend.app.llm.schemas import SubjectItem

    curr_hash = get_profile_hash()
    listings = (
        db.query(Listing)
        .filter(Listing.extraction != None)
        .all()
    )

    updated_count = 0
    for l in listings:
        if not l.extraction or not l.extraction.structured_data:
            continue
        existing_matches = [m for m in l.subject_matches if m.user_id == user_id]
        if existing_matches and all(m.profile_hash == curr_hash for m in existing_matches):
            continue

        raw_subjs = l.extraction.structured_data.get("subjects", [])
        if not raw_subjs:
            continue
        subjects = [SubjectItem(**s) for s in raw_subjs]
        lang = l.extraction.structured_data.get("primary_language", "fr")
        try:
            scores = match_listing_subjects(subjects, language=lang)
            for m in existing_matches:
                db.delete(m)
            db.flush()
            for s_res in scores:
                db.add(build_subject_match_row(s_res, l.id, user_id, curr_hash))
            updated_count += 1
        except Exception:
            continue

    db.commit()
    return {
        "status": "success",
        "profile_hash": curr_hash,
        "rescored_listings": updated_count,
    }


def _resolve_frontend_dist() -> Path | None:
    """Locate pre-built React SPA static bundle (packaged static/ or repo frontend/dist/)."""
    candidates = [
        Path(__file__).resolve().parent / "static",
        settings.root_dir / "frontend" / "dist",
    ]
    for c in candidates:
        if (c / "index.html").is_file():
            return c
    return None


_FRONTEND_DIST = _resolve_frontend_dist()
if _FRONTEND_DIST is not None and (_FRONTEND_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=str(_FRONTEND_DIST / "assets")), name="frontend-assets")


@app.get("/{full_path:path}", include_in_schema=False)
def serve_spa_fallback(full_path: str):
    """Serve bundled frontend SPA for non-API routes (History API routing)."""
    if full_path.startswith(("api/", "data/", "api", "data")) and (
        full_path in ("api", "data") or full_path.startswith(("api/", "data/"))
    ):
        raise HTTPException(status_code=404, detail="Not found")

    dist_dir = _resolve_frontend_dist()
    if dist_dir is None:
        from fastapi.responses import HTMLResponse
        return HTMLResponse(
            "<h2>PFE Assistant Backend Running</h2>"
            "<p>Frontend bundle not built yet. Run <code>cd frontend && npm install && npm run build</code> "
            "or start Vite dev server with <code>npm run dev</code>.</p>",
            status_code=200,
        )

    if full_path:
        candidate = (dist_dir / full_path).resolve()
        if dist_dir.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(str(candidate))

    return FileResponse(str(dist_dir / "index.html"))

