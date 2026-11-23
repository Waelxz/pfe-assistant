"""Tests for Phase 4: Application Drafting, Cover Letter PDF, and Prepare-Send Flow."""

import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.database import init_db, SessionLocal
from backend.app.models import Listing, Extraction, Application, UserDocument
from backend.app.draft import (
    format_file_name,
    build_gmail_compose_url,
    render_cover_letter_pdf,
    prepare_application_package,
    ApplicationDraftResult,
)
from backend.app.storage import LocalStorageAdapter

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_database(tmp_path):
    init_db()
    db = SessionLocal()
    # Clean only test listings and test applications created by test runs
    test_listings = db.query(Listing).filter(Listing.slug.in_(["test-corp", "api-test-corp"])).all()
    test_listing_ids = [l.id for l in test_listings]
    if test_listing_ids:
        db.query(Application).filter(Application.listing_id.in_(test_listing_ids)).delete(synchronize_session=False)
        db.query(Listing).filter(Listing.id.in_(test_listing_ids)).delete(synchronize_session=False)
    db.query(UserDocument).filter(UserDocument.label.like("test-%")).delete(synchronize_session=False)
    db.commit()
    db.close()


def test_build_gmail_compose_url():
    url = build_gmail_compose_url(
        to="recrutement@company.tn",
        subject="Candidature PFE 2026 - PFE-01 - Alex Doe",
        body="Madame, Monsieur,\nVeuillez trouver ci-joint ma candidature.",
        cc=["lead@company.tn"],
    )
    assert "https://mail.google.com/mail/?view=cm" in url
    assert "to=recrutement%40company.tn" in url
    assert "cc=lead%40company.tn" in url
    assert "Alex%20Doe" in url


def test_format_file_name_standard_and_custom():
    # Standard CV naming
    assert format_file_name(None, "cv", "PCP", "PFE-01", candidate_name="Alex Doe") == "CV_Alex_Doe_PFE-01.pdf"
    assert format_file_name(None, "cv", "PCP", candidate_name="Alex Doe") == "CV_Alex_Doe_PCP.pdf"
    
    # Standard Cover Letter naming
    assert format_file_name(None, "cover_letter", "PCP", candidate_name="Alex Doe") == "Cover_Letter_Alex_Doe_PCP.pdf"
    
    # Custom template rule specified by company
    custom = "{NAME}_{COMPANY}_{SUBJECT}"
    assert format_file_name(custom, "cv", "Vermeg", "AI-02", candidate_name="Alex Doe") == "ALEX_DOE_VERMEG_AI-02.pdf"

    # Synthetic subject refs fallback to company name
    assert format_file_name(None, "cv", "Fayat Batiment", "SUBJ-42", candidate_name="Alex Doe") == "CV_Alex_Doe_Fayat_Batiment.pdf"
    assert format_file_name("{NAME}_{COMPANY}_{SUBJECT}", "cv", "Fayat Batiment", "SUBJ-42", candidate_name="Alex Doe") == "ALEX_DOE_FAYAT_BATIMENT_FAYAT_BATIMENT.pdf"


def test_render_cover_letter_pdf(tmp_path):
    out_pdf = tmp_path / "test_cl.pdf"
    body = (
        "Madame, Monsieur,\n\n"
        "Étudiant en 2ème année de Mastère Big Data Analytics & E-Commerce à l'IHEC Carthage, "
        "je vous soumets ma candidature avec un vif intérêt.\n\n"
        "Cordialement,\n"
        "Alex Doe"
    )
    render_cover_letter_pdf(
        body_text=body,
        company_name="Acme AI",
        output_path=out_pdf,
    )
    assert out_pdf.exists()
    assert out_pdf.stat().st_size > 5000

    import pymupdf
    doc = pymupdf.open(out_pdf)
    assert len(doc) == 1
    doc.close()


def test_prepare_application_package(tmp_path):
    db = SessionLocal()
    storage = LocalStorageAdapter(data_dir=tmp_path)

    # 1. Create a dummy listing and extraction
    listing = Listing(
        wp_post_id=99901,
        slug="test-corp",
        company_name="TestCorp",
        post_url="https://pfebooks.com/test-corp",
        catalogue_term="2026-2027",
    )
    db.add(listing)
    db.commit()
    db.refresh(listing)

    extraction = Extraction(
        listing_id=listing.id,
        pdf_sha256="dummyhash",
        model_used="gemini-3.5-flash",
        structured_data={
            "company": {"name": "TestCorp", "contact_email": "hr@testcorp.com"},
            "subjects": [{"ref": "PFE-01", "title": "RAG Assistant"}],
            "application_rules": {
                "file_naming_rule": "CV_{NAME}_{COMPANY}.pdf",
                "required_documents": ["Relevé de notes"],
            },
        },
    )
    db.add(extraction)

    # 2. Add a user document (transcript)
    doc_path = tmp_path / "user_docs_releve.pdf"
    doc_path.write_bytes(b"%PDF-1.4 dummy transcript")
    storage_key = storage.save_pdf("user_docs_releve.pdf", b"%PDF-1.4 dummy transcript")

    user_doc = UserDocument(
        user_id="local-default",
        doc_type="transcript",
        label="Relevé de notes M1",
        storage_key=storage_key,
        original_filename="releve.pdf",
    )
    db.add(user_doc)

    # 3. Create application record
    app_record = Application(
        user_id="local-default",
        listing_id=listing.id,
        selected_subject_refs=["PFE-01"],
        language="fr",
        delivery_mode="combined_email",
        status="new",
        email_to="hr@testcorp.com",
        email_subject="Candidature PFE - Alex Doe",
        email_body="Bonjour,\nVeuillez trouver ci-joint ma candidature.",
        include_cover_letter=True,
        cover_letter_text="Madame, Monsieur,\nJe postule pour PFE-01.\nCordialement.",
    )
    db.add(app_record)
    db.commit()
    db.refresh(app_record)

    # 4. Run prepare_application_package
    pkg = prepare_application_package(
        db=db,
        application_id=app_record.id,
        user_id="local-default",
        storage=storage,
    )

    assert pkg.application_id == app_record.id
    assert pkg.company_name == "TestCorp"
    assert len(pkg.generated_files) >= 2  # CV + Cover Letter
    assert any(f.filename.startswith("CV_") and f.filename.endswith("_TESTCORP.pdf") for f in pkg.generated_files)
    assert len(pkg.gmail_compose_urls) == 1
    assert "hr%40testcorp.com" in pkg.gmail_compose_urls[0]

    db.close()


def test_api_draft_and_prepare_send_endpoints():
    db = SessionLocal()
    listing = Listing(
        wp_post_id=99902,
        slug="api-test-corp",
        company_name="ApiTestCorp",
        post_url="https://pfebooks.com/api-test-corp",
        catalogue_term="2026-2027",
    )
    db.add(listing)
    db.commit()
    db.refresh(listing)

    ext = Extraction(
        listing_id=listing.id,
        pdf_sha256="testsha",
        model_used="gemini-3.5-flash",
        structured_data={
            "company": {"name": "ApiTestCorp", "contact_email": "jobs@apitest.com"},
            "subjects": [{"ref": "DS-01", "title": "Fraud Detection"}],
        },
    )
    db.add(ext)
    db.commit()
    listing_id = listing.id
    db.close()

    # Mock Gemini call in generate_email_and_letter
    mock_draft = ApplicationDraftResult(
        language="fr",
        delivery_mode="combined_email",
        email_to="jobs@apitest.com",
        email_subject="[Candidature PFE 2026] DS-01 - Alex Doe",
        email_body="Madame, Monsieur,\nJe postule avec enthousiasme.",
        cover_letter_text="Madame, Monsieur,\nLettre de motivation.\nCordialement.",
    )

    with patch("backend.app.main.generate_email_and_letter", return_value=mock_draft):
        resp = client.post(
            "/api/applications/draft",
            json={
                "listing_id": listing_id,
                "selected_subject_refs": ["DS-01"],
                "language": "fr",
                "delivery_mode": "combined_email",
                "include_cover_letter": True,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        app_id = data["application_id"]
        assert data["email_to"] == "jobs@apitest.com"
        assert "DS-01" in data["email_subject"]

        # Test Status Update
        patch_resp = client.patch(
            f"/api/applications/{app_id}/status",
            json={"status": "sent"},
        )
        assert patch_resp.status_code == 200
        assert patch_resp.json()["new_status"] == "sent"

        # Test Prepare Send & Download Endpoints
        prep_resp = client.post(f"/api/applications/{app_id}/prepare-send")
        assert prep_resp.status_code == 200
        prep_data = prep_resp.json()
        assert prep_data["status"] == "success"
        assert len(prep_data["package"]["gmail_compose_urls"]) > 0

        zip_resp = client.get(f"/api/applications/{app_id}/download-zip")
        assert zip_resp.status_code == 200
        assert zip_resp.headers["content-type"] == "application/zip"

        first_file = prep_data["package"]["generated_files"][0]["filename"]
        file_resp = client.get(f"/api/applications/{app_id}/files/{first_file}")
        assert file_resp.status_code == 200
        assert file_resp.content.startswith(b"%PDF")


def test_api_documents_crud(tmp_path):
    # Upload document
    test_pdf_content = b"%PDF-1.4 dummy diploma"
    files = {"file": ("diploma.pdf", test_pdf_content, "application/pdf")}
    data = {"doc_type": "diploma", "label": "Licence BI Diploma"}

    resp = client.post("/api/documents", files=files, data=data)
    assert resp.status_code == 200
    doc_id = resp.json()["document_id"]
    assert resp.json()["label"] == "Licence BI Diploma"

    # List documents
    list_resp = client.get("/api/documents")
    assert list_resp.status_code == 200
    docs = list_resp.json()
    assert any(d["id"] == doc_id for d in docs)

    # Delete document
    del_resp = client.delete(f"/api/documents/{doc_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["deleted_id"] == doc_id


def test_strip_trailing_signature():
    from backend.app.draft import _strip_trailing_signature

    en = "Dear Team,\n\nI would love to join.\n\nBest regards,\nAlex Doe\n+216 12 345 678\nhttps://linkedin.com/in/wael"
    assert _strip_trailing_signature(en) == "Dear Team,\n\nI would love to join.\n\nBest regards,"

    fr = "Madame, Monsieur,\n\nJe postule.\n\nCordialement,\nAlex Doe"
    assert _strip_trailing_signature(fr) == "Madame, Monsieur,\n\nJe postule.\n\nCordialement,"

    already_clean = "Dear Team,\n\nI would love to join.\n\nBest regards,"
    assert _strip_trailing_signature(already_clean) == already_clean
