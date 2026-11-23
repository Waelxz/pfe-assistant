"""Orchestration service for fetching listings and downloading PFE Book PDFs."""

import asyncio
from collections.abc import Callable
from datetime import datetime, timezone
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.models import Listing
from backend.app.storage import StorageAdapter, get_storage
from backend.app.sync.fetcher import PfebooksFetcher, FetchedListing
from backend.app.sync.downloader import PdfDownloader, DownloadResult


class SyncProgressEvent(BaseModel):
    step: str  # fetch_posts | saving | download_pdf | extract | completed | error | done
    current: int = 0
    total: int = 0
    progress_pct: int = 0
    listing_slug: str | None = None
    message: str = ""


class SyncSummary(BaseModel):
    total_listings: int = 0
    new_listings: int = 0
    updated_listings: int = 0
    pdfs_downloaded: int = 0
    pdfs_skipped: int = 0
    extractions_completed: int = 0
    errors: list[str] = []


class SyncService:
    """Coordinates fetching from pfebooks.com, DB upsert, and rate-limited PDF downloads."""

    def __init__(
        self,
        fetcher: PfebooksFetcher | None = None,
        downloader: PdfDownloader | None = None,
        storage: StorageAdapter | None = None,
    ) -> None:
        self.storage = storage or get_storage()
        self.fetcher = fetcher or PfebooksFetcher()
        self.downloader = downloader or PdfDownloader(storage=self.storage)

    def purge_outdated_listings(
        self,
        db: Session,
        min_date_iso: str = "2026-10-01T00:00:00",
    ) -> int:
        """Purge listings older than min_date that have no active applications."""
        threshold = datetime.fromisoformat(min_date_iso)
        if threshold.tzinfo is None:
            threshold = threshold.replace(tzinfo=timezone.utc)

        old_listings = (
            db.query(Listing)
            .filter(Listing.published_at < threshold, Listing.wp_post_id > 0)
            .all()
        )

        deleted_count = 0
        for l in old_listings:
            has_active_app = any(
                a.status not in ["new", "archived"] for a in l.applications
            )
            if not has_active_app:
                if l.pdf_storage_key:
                    pdf_path = self.storage.get_pdf_path(l.pdf_storage_key)
                    if pdf_path and pdf_path.exists():
                        try:
                            pdf_path.unlink()
                        except Exception:
                            pass
                db.delete(l)
                deleted_count += 1

        db.commit()
        return deleted_count

    async def run_sync(
        self,
        db: Session,
        force_download: bool = False,
        extract_listings: bool = True,
        on_progress: Callable[[SyncProgressEvent], None] | None = None,
    ) -> SyncSummary:
        summary = SyncSummary()

        def emit(
            step: str,
            current: int = 0,
            total: int = 0,
            progress_pct: int = 0,
            slug: str | None = None,
            msg: str = "",
        ) -> None:
            if on_progress:
                evt = SyncProgressEvent(
                    step=step,
                    current=current,
                    total=total,
                    progress_pct=progress_pct,
                    listing_slug=slug,
                    message=msg,
                )
                on_progress(evt)

        # Step 1: Fetch posts
        emit("fetch_posts", 0, 0, 5, None, "Fetching eligible 2026-2027 posts from pfebooks.com...")
        try:
            fetched_items = await self.fetcher.fetch_eligible_listings()
        except Exception as exc:
            err_msg = f"Failed to fetch posts from pfebooks.com: {exc}"
            summary.errors.append(err_msg)
            emit("error", 0, 0, 0, None, err_msg)
            return summary

        summary.total_listings = len(fetched_items)
        emit(
            "saving",
            0,
            len(fetched_items),
            15,
            None,
            f"Found {len(fetched_items)} eligible listings. Upserting into database...",
        )

        # Step 2: Upsert into DB
        listings_to_download: list[Listing] = []

        for idx, item in enumerate(fetched_items, start=1):
            existing = (
                db.query(Listing)
                .filter(
                    (Listing.wp_post_id == item.wp_post_id)
                    | (Listing.slug == item.slug)
                )
                .first()
            )

            hints = {
                "deadline": item.deadline,
                "apply_method": item.apply_method,
                "email": item.email,
                "external_url": item.external_url,
                "subject_count": item.subject_count,
                "subjects_preview": item.subjects_preview,
            }
            cat_list = item.category_names if item.category_names else item.categories
            tag_list = item.tag_names if item.tag_names else item.tags

            if existing:
                existing.company_name = item.company_name
                existing.post_url = item.post_url
                existing.published_at = item.published_at
                existing.modified_at = item.modified_at
                existing.catalogue_term = item.catalogue_term
                existing.categories = cat_list
                existing.tags = tag_list
                existing.description_html = item.description_html
                existing.description_text = item.description_text
                existing.location = item.location
                existing.html_hints = hints
                if item.pdf_url:
                    existing.pdf_url = item.pdf_url
                summary.updated_listings += 1
                target_listing = existing
            else:
                target_listing = Listing(
                    wp_post_id=item.wp_post_id,
                    slug=item.slug,
                    company_name=item.company_name,
                    post_url=item.post_url,
                    published_at=item.published_at,
                    modified_at=item.modified_at,
                    catalogue_term=item.catalogue_term,
                    categories=cat_list,
                    tags=tag_list,
                    description_html=item.description_html,
                    description_text=item.description_text,
                    pdf_url=item.pdf_url,
                    location=item.location,
                    html_hints=hints,
                    sync_status="pending",
                )
                db.add(target_listing)
                summary.new_listings += 1

            db.commit()
            db.refresh(target_listing)

            if target_listing.pdf_url:
                listings_to_download.append(target_listing)

        # Step 3: Rate-limited PDF download
        total_pdfs = len(listings_to_download)
        emit(
            "download_pdf",
            0,
            total_pdfs,
            20,
            None,
            f"Starting download of {total_pdfs} PFE Book PDFs (1 req/s)...",
        )

        for idx, listing in enumerate(listings_to_download, start=1):
            # If already downloaded and file exists locally, skip without HTTP download unless forced
            if (
                not force_download
                and listing.pdf_storage_key
                and listing.sync_status in ("downloaded", "extracted")
            ):
                local_path = self.storage.get_pdf_path(listing.pdf_storage_key)
                if local_path and local_path.exists() and local_path.stat().st_size > 0:
                    summary.pdfs_skipped += 1
                    continue

            dl_pct = int(20 + (idx / total_pdfs) * 15) if total_pdfs else 35
            emit(
                "download_pdf",
                idx,
                total_pdfs,
                dl_pct,
                listing.slug,
                f"[{idx}/{total_pdfs}] Downloading PDF for {listing.company_name}...",
            )

            res: DownloadResult = await self.downloader.download_pdf(
                pdf_url=listing.pdf_url,
                slug=listing.slug,
                existing_sha256=listing.pdf_sha256,
            )

            if res.status in ("success", "skipped"):
                listing.pdf_storage_key = res.storage_key
                listing.pdf_sha256 = res.sha256
                if listing.extractions and listing.subject_matches:
                    listing.sync_status = "extracted"
                else:
                    listing.sync_status = "downloaded"
                if res.status == "success":
                    summary.pdfs_downloaded += 1
                else:
                    summary.pdfs_skipped += 1
            else:
                listing.sync_status = "error"
                err = f"Failed to download PDF for {listing.slug}: {res.error_message}"
                summary.errors.append(err)

            listing.updated_at = datetime.now(timezone.utc)
            db.commit()

        # Step 4: Batch PDF Extraction & Profile Matching (paced for 15 RPM rate limits)
        if extract_listings:
            from backend.app.llm.service import process_listing

            # Refresh eligible listings that have a PDF but lack extraction or subject matches
            unextracted = [
                l
                for l in db.query(Listing).filter(Listing.pdf_storage_key.isnot(None)).all()
                if not l.extractions
                or (
                    len(l.extractions[0].structured_data.get("subjects", [])) > 0
                    and not l.subject_matches
                )
            ]
            total_extract = len(unextracted)
            if total_extract > 0:
                emit(
                    "extract",
                    0,
                    total_extract,
                    35,
                    None,
                    f"Extracting & scoring {total_extract} PFE Book PDFs (paced for 15 RPM)...",
                )

                for idx, listing in enumerate(unextracted, start=1):
                    pct = int(35 + (idx / total_extract) * 60)
                    emit(
                        "extract",
                        idx,
                        total_extract,
                        pct,
                        listing.slug,
                        f"[{idx}/{total_extract}] Extracting & scoring {listing.company_name}...",
                    )

                    try:
                        await asyncio.to_thread(process_listing, db, listing, False, False)
                        summary.extractions_completed += 1
                    except Exception as exc:
                        db.rollback()
                        err = f"Failed to extract {listing.slug}: {exc}"
                        summary.errors.append(err)

                    # Pacing between consecutive listings (4.5s) to stay strictly under 15 RPM
                    if idx < total_extract:
                        await asyncio.sleep(4.5)

        emit(
            "done",
            total_pdfs,
            total_pdfs,
            100,
            None,
            f"Sync complete: {summary.pdfs_downloaded} downloaded, {summary.extractions_completed} extracted, {len(summary.errors)} errors.",
        )
        return summary
