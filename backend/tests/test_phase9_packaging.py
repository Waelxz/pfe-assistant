"""Tests for Phase 9D: Single-server SPA fallback, data_dir resolution, and CLI."""

from pathlib import Path
from fastapi.testclient import TestClient

from backend.app.cli import main as cli_main
from backend.app.config import resolve_data_dir
from backend.app.main import app


def test_spa_fallback_and_api_404():
    client = TestClient(app)

    root_resp = client.get("/")
    assert root_resp.status_code == 200
    assert "text/html" in root_resp.headers["content-type"]

    spa_resp = client.get("/settings")
    assert spa_resp.status_code == 200
    assert "text/html" in spa_resp.headers["content-type"]

    api_missing = client.get("/api/does-not-exist-xyz")
    assert api_missing.status_code == 404


def test_resolve_data_dir(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("PFE_DATA_DIR", raising=False)
    repo_data = resolve_data_dir()
    assert repo_data.name == "data"

    monkeypatch.setenv("PFE_DATA_DIR", str(tmp_path / "custom_pfe"))
    assert resolve_data_dir() == (tmp_path / "custom_pfe").resolve()


def test_cli_help_flag(capsys):
    try:
        cli_main(["--help"])
    except SystemExit as exc:
        assert exc.code == 0
    captured = capsys.readouterr()
    assert "pfe-assistant" in captured.out
