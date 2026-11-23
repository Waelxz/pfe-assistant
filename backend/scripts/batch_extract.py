"""Batch extraction and profile matching script for unextracted PFE listings.
Paced strictly to respect Gemini free tier limits (15 RPM max, 1500 RPD).
"""

import sys
import time
from pathlib import Path

# Add project root to sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from datetime import datetime, timezone
from backend.app.database import SessionLocal, init_db
from backend.app.models import Listing
from backend.app.llm.service import process_listing


def run_batch_extract():
    init_db()
    db = SessionLocal()

    listings = (
        db.query(Listing)
        .filter(Listing.pdf_storage_key.isnot(None))
        .order_by(Listing.published_at.desc())
        .all()
    )

    unextracted = [
        l
        for l in listings
        if not l.extractions
        or (
            len(l.extractions[0].structured_data.get("subjects", [])) > 0
            and not l.subject_matches
        )
    ]
    total = len(unextracted)

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Found {total} listings needing extraction out of {len(listings)} total.", flush=True)
    if total == 0:
        print("All listings already extracted and scored. Nothing to do.", flush=True)
        db.close()
        return

    succeeded = 0
    failed = []

    for idx, listing in enumerate(unextracted, start=1):
        start_t = time.time()
        print(f"\n[{idx}/{total}] [{datetime.now().strftime('%H:%M:%S')}] Processing: {listing.company_name} ({listing.slug})...", flush=True)

        try:
            extraction, matches = process_listing(db=db, listing=listing)
            subjects_count = len(extraction.structured_data.get("subjects", []))
            top_score = max([m.score for m in matches], default=0) if matches else 0
            high_count = sum(1 for m in matches if m.compatibility_tier == "high")
            elapsed = time.time() - start_t

            print(
                f"  -> SUCCESS ({elapsed:.1f}s): {subjects_count} subjects, {len(matches)} matches (Top: {top_score}%, High: {high_count})",
                flush=True,
            )
            succeeded += 1
        except Exception as exc:
            db.rollback()
            elapsed = time.time() - start_t
            err_msg = f"{listing.slug}: {exc}"
            print(f"  -> ERROR ({elapsed:.1f}s): {err_msg}", file=sys.stderr, flush=True)
            failed.append(err_msg)

        # Inter-listing pacing (4.5s) to guarantee <= 13.3 RPM
        if idx < total:
            time.sleep(4.5)

    print("\n" + "=" * 60, flush=True)
    print(f"[{datetime.now().strftime('%H:%M:%S')}] BATCH EXTRACTION COMPLETE", flush=True)
    print(f"Total processed: {total}", flush=True)
    print(f"Succeeded: {succeeded}", flush=True)
    print(f"Failed: {len(failed)}", flush=True)
    if failed:
        print("Failure list:", flush=True)
        for f in failed:
            print(f"  - {f}", flush=True)
    print("=" * 60, flush=True)

    db.close()


if __name__ == "__main__":
    run_batch_extract()
