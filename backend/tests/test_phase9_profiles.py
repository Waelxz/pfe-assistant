"""Tests for Phase 9C: Multi-profile isolation, single-language support, and sample CV."""

from pathlib import Path
from fastapi.testclient import TestClient

from backend.app.config import reload_settings
from backend.app.database import get_current_user_id, init_db
from backend.app.main import app


def test_multi_profile_isolation_and_single_language(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("PFE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'test_profiles.db').as_posix()}")

    # Reload config + temporarily rebind DB engine on isolated temp sqlite
    reload_settings()
    import backend.app.database as dbmod
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    orig_engine = dbmod.engine
    orig_session_local = dbmod.SessionLocal
    temp_engine = create_engine(
        f"sqlite:///{(tmp_path / 'test_profiles.db').as_posix()}",
        connect_args={"check_same_thread": False},
    )
    dbmod.engine = temp_engine
    dbmod.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=temp_engine)
    init_db()

    try:
        client = TestClient(app)

        # 1. Create a fresh profile "Alice" and activate it
        res_create = client.post("/api/profiles", json={"name": "Alice Smith", "activate": True})
        assert res_create.status_code == 200
        alice_id = res_create.json()["profile"]["id"]
        assert alice_id == "alice-smith"
        assert get_current_user_id() == "alice-smith"

        # 2. Load sample CV in EN only -> tests single-language profile behavior
        res_sample = client.post("/api/profile/load-sample?lang=en")
        assert res_sample.status_code == 200
        assert res_sample.json()["languages"] == ["en"]

        res_prof = client.get("/api/profile")
        assert res_prof.status_code == 200
        prof_data = res_prof.json()
        assert prof_data["en"] is not None
        assert prof_data["fr"] is None
        assert prof_data["available_languages"] == ["en"]
        assert prof_data["metrics"]["en"]["valid"] is True

        # 3. Upload a document under Alice
        doc_resp = client.post(
            "/api/documents",
            files={"file": ("alice_transcript.pdf", b"%PDF-1.4 alice", "application/pdf")},
            data={"doc_type": "transcript", "label": "Alice Transcript"},
        )
        assert doc_resp.status_code == 200
        assert len(client.get("/api/documents").json()) == 1

        # 4. Create Bob profile & switch -> Bob has 0 documents (full isolation)
        res_bob = client.post("/api/profiles", json={"name": "Bob", "activate": True})
        assert res_bob.status_code == 200
        assert get_current_user_id() == "bob"
        assert client.get("/api/documents").json() == []

        # 5. Switch back to Alice -> Alice's document is still there
        res_act = client.post(f"/api/profiles/{alice_id}/activate")
        assert res_act.status_code == 200
        assert len(client.get("/api/documents").json()) == 1

        # 6. Delete Bob profile
        res_del = client.delete("/api/profiles/bob")
        assert res_del.status_code == 200
    finally:
        temp_engine.dispose()
        dbmod.engine = orig_engine
        dbmod.SessionLocal = orig_session_local
        monkeypatch.delenv("PFE_DATA_DIR", raising=False)
        monkeypatch.delenv("DATABASE_URL", raising=False)
        reload_settings()
