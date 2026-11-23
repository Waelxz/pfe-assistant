"""Verification tests for Phase 2: Core Backend, DB & pfebooks.com Sync."""

import asyncio
from pathlib import Path
import pytest
import pymupdf
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from backend.app.config import get_settings
from backend.app.database import init_db, SessionLocal
from backend.app.models import Listing
from backend.app.sync.fetcher import PfebooksFetcher
from backend.app.sync.downloader import PdfDownloader
from backend.app.sync.service import SyncService
from backend.app.main import app


@pytest.fixture(scope="module")
def db_session():
    init_db()
    session = SessionLocal()
    yield session
    session.close()


def test_api_config():
    """Verify /api/config returns valid configuration."""
    client = TestClient(app)
    resp = client.get("/api/config")
    assert resp.status_code == 200
    data = resp.json()
    assert "app_mode" in data
    assert data["app_mode"] == "local"
    assert data["user_id"] == "local-default"


@pytest.mark.asyncio
async def test_fetch_eligible_listings():
    """Verify PfebooksFetcher retrieves all 16+ eligible 2026-2027 listings."""
    fetcher = PfebooksFetcher()
    listings = await fetcher.fetch_eligible_listings()
    assert len(listings) >= 16, f"Expected at least 16 listings, got {len(listings)}"

    # Check key listings exist
    slugs = {item.slug for item in listings}
    assert "pcp" in slugs
    assert "designet" in slugs
    assert "aquadeep" in slugs

    # Verify each listing has a valid PDF URL
    with_pdf = [item for item in listings if item.pdf_url]
    assert len(with_pdf) >= 16


@pytest.mark.asyncio
async def test_full_sync_and_pdf_download(db_session: Session):
    """Run full sync service: upsert listings into DB and download PDFs."""
    sync_service = SyncService()
    events = []

    def on_progress(evt):
        events.append(evt)

    summary = await sync_service.run_sync(
        db_session, on_progress=on_progress, extract_listings=False
    )

    assert summary.total_listings >= 16
    assert summary.pdfs_downloaded + summary.pdfs_skipped >= 16
    assert len(summary.errors) == 0, f"Sync encountered errors: {summary.errors}"

    # Verify database state
    db_listings = db_session.query(Listing).filter(Listing.wp_post_id > 0).all()
    assert len(db_listings) >= 16

    settings = get_settings()
    for item in db_listings:
        assert item.sync_status in ("downloaded", "extracted")
        assert item.pdf_storage_key is not None
        assert item.pdf_sha256 is not None
        pdf_file = settings.data_dir / item.pdf_storage_key
        assert pdf_file.exists(), f"PDF file not found on disk: {pdf_file}"
        assert pdf_file.stat().st_size > 1000, f"PDF file suspiciously small: {pdf_file}"


@pytest.mark.asyncio
async def test_sync_idempotency_skip_existing(db_session: Session):
    """Second sync with force_download=False should skip all existing PDFs immediately."""
    sync_service = SyncService()
    summary = await sync_service.run_sync(
        db_session, force_download=False, extract_listings=False
    )
    assert summary.pdfs_downloaded == 0
    assert summary.pdfs_skipped >= 16
    assert len(summary.errors) == 0


def test_api_listings_endpoints(db_session: Session):
    """Verify /api/listings and /api/listings/{id} endpoints."""
    client = TestClient(app)
    resp = client.get("/api/listings")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 16
    first_item = data[0]
    listing_id = first_item["id"]

    # Detail endpoint
    detail_resp = client.get(f"/api/listings/{listing_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["id"] == listing_id
    assert detail["company_name"] == first_item["company_name"]
    assert detail["sync_status"] in ("downloaded", "extracted")

    # 404 endpoint
    notFound_resp = client.get("/api/listings/999999")
    assert notFound_resp.status_code == 404


def test_pymupdf_pdf_integrity():
    """Verify every downloaded PDF opens cleanly and has pages."""
    settings = get_settings()
    pdf_files = list(settings.pdf_dir.glob("*.pdf"))
    assert len(pdf_files) >= 16

    for pdf_path in pdf_files:
        doc = pymupdf.open(pdf_path)
        assert len(doc) > 0, f"PDF {pdf_path.name} has 0 pages"
        doc.close()


@pytest.mark.asyncio
async def test_downloader_rejects_corrupt_content():
    """Downloader should reject non-PDF response without saving to storage."""
    import httpx
    downloader = PdfDownloader()

    class MockTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            return httpx.Response(200, content=b"<html>Not a PDF</html>")

    mock_client = httpx.AsyncClient(transport=MockTransport())
    res = await downloader.download_pdf(
        "https://example.com/fake.pdf", "fake-slug", client=mock_client
    )
    assert res.status == "error"
    assert "does not start with %PDF-" in (res.error_message or "")


def test_html_sections_and_bonus_stripping():
    """Verify zero-cost HTML section parser, city detection, and bonus stripping."""
    from backend.app.sync.fetcher import (
        parse_html_sections,
        strip_bonus_section,
        parse_class_list_taxonomies,
        extract_pdf_url,
    )

    sample_html = """
    <h2>L'entreprise</h2>
    <p>Société basée à Mahdia spécialisée en IA.</p>
    <h2>Offres de stages</h2>
    <p>3 stages PFE de 6 mois à Mahdia :</p>
    <ul>
      <li>IA-01 : Agent LLM RAG - <a href="https://example.com/apply/1">Postuler</a></li>
      <li>IA-02 : Vision par ordinateur</li>
    </ul>
    <h2>Coordonnées et candidatures</h2>
    <p>Adresse : Route de la plage, Mahdia</p>
    <p>Site web : https://example.com/careers</p>
    <p>Adresse email : hr@example.com</p>
    <p>Date limite de candidature : 15/12/2026</p>
    <h2>Bonus</h2>
    <p>Consultez notre guide CV et lettre de motivation.</p>
    <div class="pfeb-viewer" data-src="https://pfebooks.com/admin-ajax.php?action=pdf"></div>
    """

    hints = parse_html_sections(sample_html)
    assert hints["location"] == "Route de la plage, Mahdia"
    assert hints["email"] == "hr@example.com"
    assert hints["deadline"] == "15/12/2026"
    assert hints["apply_method"] == "email"
    assert hints["subject_count"] == 2
    assert hints["subjects_preview"][0]["apply_url"] == "https://example.com/apply/1"

    # Test PDF URL fallback
    pdf_url = extract_pdf_url(sample_html)
    assert pdf_url == "https://pfebooks.com/admin-ajax.php?action=pdf"

    # Test Bonus stripping
    stripped = strip_bonus_section(sample_html)
    assert "Bonus" not in stripped
    assert "guide CV" not in stripped
    assert "Route de la plage" in stripped

    # Test class_list parsing
    class_list = ["post", "category-informatique-ia-data", "tag-python", "tag-ia", "tag-cloud-2"]
    cats, tags = parse_class_list_taxonomies(class_list)
    assert "Informatique, IA & Données" in cats
    assert "python" in tags
    assert "ia" in tags
    assert "cloud" in tags


def test_upload_custom_pfe_book():
    """Verify POST /api/listings/upload validates PDF, creates listing, deduplicates, and deletes cleanly."""
    client = TestClient(app)

    # 1. Reject non-PDF file
    bad_resp = client.post(
        "/api/listings/upload",
        files={"file": ("not_a_pdf.pdf", b"not a pdf content", "application/pdf")},
        data={"company_name": "Bad Corp", "extract_now": "false"},
    )
    assert bad_resp.status_code == 400

    # 2. Create valid 1-page PDF in memory with PyMuPDF
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Custom Company PFE Book 2026 - AI & Big Data Topic")
    pdf_bytes = doc.tobytes()
    doc.close()

    # Pre-clean if a prior failed test run left this test PDF in DB
    import hashlib
    test_sha = hashlib.sha256(pdf_bytes).hexdigest()
    s = SessionLocal()
    try:
        stale = s.query(Listing).filter(Listing.pdf_sha256 == test_sha).first()
        if stale:
            client.delete(f"/api/listings/{stale.id}")
    finally:
        s.close()

    listing_id = None
    try:
        resp = client.post(
            "/api/listings/upload",
            files={"file": ("PFE_Book_Acme_AI_2026.pdf", pdf_bytes, "application/pdf")},
            data={
                "company_name": "",
                "location": "Tunis, Lac 2",
                "post_url": "https://linkedin.com/company/acme-ai",
                "extract_now": "false",
            },
        )
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        assert payload["status"] == "success"
        assert payload["already_existed"] is False
        listing = payload["listing"]
        listing_id = listing["id"]
        assert listing["wp_post_id"] < 0
        assert listing["company_name"] == "Acme Ai"
        assert listing["location"] == "Tunis, Lac 2"
        assert listing["post_url"] == "https://linkedin.com/company/acme-ai"
        assert "User Uploaded" in listing["categories"]

        # 3. Re-uploading identical PDF deduplicates by SHA256 and updates company name if supplied
        dup_resp = client.post(
            "/api/listings/upload",
            files={"file": ("PFE_Book_Acme_AI_2026.pdf", pdf_bytes, "application/pdf")},
            data={
                "company_name": "ACME AI Tunisia",
                "extract_now": "false",
            },
        )
        assert dup_resp.status_code == 200
        dup_payload = dup_resp.json()
        assert dup_payload["already_existed"] is True
        assert dup_payload["listing"]["id"] == listing["id"]
        assert dup_payload["listing"]["company_name"] == "ACME AI Tunisia"
    finally:
        # 4. Clean up test uploaded listing always
        if listing_id:
            client.delete(f"/api/listings/{listing_id}")
