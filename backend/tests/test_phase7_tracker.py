"""Phase 7 verification tests: Application Tracker & Reusable Documents Library."""

import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.database import SessionLocal, get_db
from backend.app.models import Listing, Application, UserDocument


@pytest.fixture
def client():
    return TestClient(app)


def test_tracker_applications_list_and_status_update(client):
    """Verifies GET /api/applications and status + notes updates for the tracker pipeline."""
    db = SessionLocal()
    # Create or use a dummy listing
    listing = db.query(Listing).first()
    if not listing:
        listing = Listing(
            wp_post_id=999991,
            slug="tracker-test-corp",
            company_name="Tracker Test Corp",
            post_url="https://example.com/pfe",
        )
        db.add(listing)
        db.commit()
        db.refresh(listing)

    # Ensure application draft exists
    company_name = listing.company_name
    listing_id = listing.id

    app_record = (
        db.query(Application)
        .filter(Application.listing_id == listing_id, Application.user_id == "local-default")
        .first()
    )
    if not app_record:
        app_record = Application(
            user_id="local-default",
            listing_id=listing_id,
            selected_subject_refs=["PFE-01"],
            language="fr",
            status="drafted",
            email_to="hr@trackertest.com",
            email_subject="Candidature PFE",
        )
        db.add(app_record)
    else:
        app_record.status = "drafted"
        app_record.email_subject = "Candidature PFE"
    db.commit()
    db.refresh(app_record)

    app_id = app_record.id
    db.close()

    # 1. Fetch tracker list
    res = client.get("/api/applications")
    assert res.status_code == 200
    apps = res.json()
    assert isinstance(apps, list)
    target = next((a for a in apps if a["id"] == app_id), None)
    assert target is not None
    assert target["company_name"] == company_name
    assert target["status"] in ["drafted", "opened_gmail", "sent", "interview", "rejected"]

    # 2. Update status to sent with a note
    patch_res = client.patch(
        f"/api/applications/{app_id}/status",
        json={"status": "sent", "notes": "Sent via Gmail. Follow up in 7 days."},
    )
    assert patch_res.status_code == 200
    data = patch_res.json()
    assert data["new_status"] == "sent"
    assert "Follow up in 7 days" in data["notes"]

    # 3. Verify sent_at was stamped
    check_res = client.get(f"/api/applications/{app_id}")
    assert check_res.status_code == 200
    check_data = check_res.json()
    assert check_data["status"] == "sent"
    assert check_data["sent_at"] is not None
    assert check_data["notes"] == "Sent via Gmail. Follow up in 7 days."

    # 4. Advance to interview
    interview_res = client.patch(
        f"/api/applications/{app_id}/status",
        json={"status": "interview", "notes": "Interview scheduled on Friday 10:00 AM"},
    )
    assert interview_res.status_code == 200
    assert interview_res.json()["new_status"] == "interview"


def test_documents_library_preview_link(client):
    """Verifies that uploaded user documents have storage keys accessible via static data mount."""
    import io

    file_bytes = b"%PDF-1.4 Mock document content"
    upload_res = client.post(
        "/api/documents",
        data={"doc_type": "transcript", "label": "M1 Transcript Tracker Test"},
        files={"file": ("transcript_test.pdf", io.BytesIO(file_bytes), "application/pdf")},
    )
    assert upload_res.status_code == 200
    doc_id = upload_res.json()["document_id"]
    storage_key = upload_res.json()["storage_key"]

    # Verify static file mount can access the file
    file_res = client.get(f"/data/{storage_key}")
    assert file_res.status_code == 200
    assert file_res.content == file_bytes

    # Clean up
    del_res = client.delete(f"/api/documents/{doc_id}")
    assert del_res.status_code == 200


def test_untracked_new_status_and_lifecycle(client):
    """Verifies:
    1. Applications with status='new' are excluded from GET /api/applications.
    2. PATCH /api/applications/{id} saves manual edits and promotes to 'drafted'.
    3. PUT /api/applications/{id}/cv-draft saves staged diff without rendering.
    4. DELETE /api/applications/{id} deletes application and resets.
    """
    db = SessionLocal()
    listing = Listing(
        wp_post_id=999992,
        slug="lifecycle-test-corp",
        company_name="Lifecycle Test Corp",
        post_url="https://example.com/lifecycle",
    )
    db.add(listing)
    db.commit()
    db.refresh(listing)
    listing_id = listing.id
    db.close()

    try:
        # 1. Access listing workspace -> creates status='new'
        get_res = client.get(f"/api/applications/by-listing/{listing_id}")
        assert get_res.status_code == 200
        app_data = get_res.json()
        app_id = app_data["id"]
        assert app_data["status"] == "new"

        # Verify not in tracker list
        tracker_res = client.get("/api/applications")
        assert tracker_res.status_code == 200
        tracker_apps = tracker_res.json()
        assert not any(a["id"] == app_id for a in tracker_apps)

        # 2. Save CV draft diff
        dummy_diff = {
            "language": "en",
            "headline_suggestion": {
                "original": "M2 Student",
                "proposed": "Junior Data Engineer",
                "reason": "Matches target role",
                "accepted": True,
            },
            "summary_suggestion": {
                "original": "Student in Big Data.",
                "proposed": "Big Data student passionate about pipelines.",
                "reason": "Highlights relevant focus",
                "accepted": True,
                "unverified_keywords": [],
            },
            "skill_category_diffs": [],
            "bullet_diffs": [],
            "has_unverified_keywords": False,
            "all_unverified_keywords": [],
            "target_keywords": ["python", "sql"],
            "available_bullets": [],
            "available_skills": [],
        }
        draft_res = client.put(f"/api/applications/{app_id}/cv-draft", json={"diff": dummy_diff})
        assert draft_res.status_code == 200
        assert draft_res.json()["status"] == "success"

        # Check that staged_cv_diff was persisted
        check_app = client.get(f"/api/applications/{app_id}").json()
        assert check_app["cv_staged_diff"] is not None
        assert check_app["cv_staged_diff"]["headline_suggestion"]["proposed"] == "Junior Data Engineer"

        # 3. Save manual edits (email_to, subject, body) -> promotes to 'drafted'
        patch_res = client.patch(
            f"/api/applications/{app_id}",
            json={
                "email_to": "contact@lifecycletest.com",
                "email_subject": "Application for PFE 2026",
                "email_body": "Dear Hiring Team,\n\nPlease find attached my CV.\n\nBest,\nAlex",
                "selected_subject_refs": ["SUBJ-01"],
            },
        )
        assert patch_res.status_code == 200
        patched_data = patch_res.json()
        assert patched_data["application_status"] == "drafted"
        
        # Verify fields in GET
        refreshed_app = client.get(f"/api/applications/{app_id}").json()
        assert refreshed_app["email_to"] == "contact@lifecycletest.com"

        # Verify now appears in tracker list
        tracker_res2 = client.get("/api/applications")
        assert tracker_res2.status_code == 200
        assert any(a["id"] == app_id for a in tracker_res2.json())

        # 4. DELETE /api/applications/{id} -> removes application
        del_app_res = client.delete(f"/api/applications/{app_id}")
        assert del_app_res.status_code == 200
        assert del_app_res.json()["status"] == "success"
        assert del_app_res.json()["deleted_id"] == app_id

        # Verify no longer exists or tracker list does not contain it
        tracker_res3 = client.get("/api/applications")
        assert not any(a["id"] == app_id for a in tracker_res3.json())

    finally:
        db = SessionLocal()
        del_app = db.query(Application).filter(Application.listing_id == listing_id).first()
        if del_app:
            db.delete(del_app)
        del_list = db.query(Listing).filter(Listing.id == listing_id).first()
        if del_list:
            db.delete(del_list)
        db.commit()
        db.close()

