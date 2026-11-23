"""Tests for Phase 9B: BYOK settings store, key masking, hot reload, and 429/503 fallback."""

from unittest.mock import MagicMock, patch
from pydantic import BaseModel
from fastapi.testclient import TestClient

from backend.app.config import get_settings, reload_settings
from backend.app.main import app
from backend.app.settings_store import mask_api_key, save_stored_settings


class _DummySchema(BaseModel):
    ok: bool


def test_settings_masking_and_hot_reload(tmp_path, monkeypatch):
    monkeypatch.setenv("PFE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("LLM_API_KEY", "")
    reload_settings()

    client = TestClient(app)

    # Save initial key & preset via PUT /api/settings
    resp = client.put(
        "/api/settings",
        json={
            "llm_provider_preset": "gemini",
            "llm_provider": "gemini",
            "llm_api_key": "test-gemini-api-key-1234567890",
            "llm_model": "gemini-2.5-flash",
            "llm_fallback_model": "gemini-2.5-flash-lite",
            "enable_pfebooks_sync": False,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["api_key_configured"] is True
    assert "TestSecretKey" not in data["api_key_masked"]
    assert data["api_key_masked"] == mask_api_key("test-gemini-api-key-1234567890")
    assert data["enable_pfebooks_sync"] is False
    assert get_settings().llm_api_key == "test-gemini-api-key-1234567890"

    # Re-save sending back masked placeholder -> must NOT clobber real key
    resp2 = client.put(
        "/api/settings",
        json={
            "llm_api_key": data["api_key_masked"],
            "llm_model": "gemini-2.5-pro",
        },
    )
    assert resp2.status_code == 200
    assert get_settings().llm_api_key == "test-gemini-api-key-1234567890"
    assert get_settings().llm_model == "gemini-2.5-pro"

    # Clean up env override
    monkeypatch.delenv("PFE_DATA_DIR", raising=False)
    reload_settings()


def test_gemini_multi_fallback_chain(tmp_path, monkeypatch):
    from google.genai.errors import ClientError, ServerError
    from backend.app.llm.client import generate_structured_content, get_last_model_used

    monkeypatch.setenv("PFE_DATA_DIR", str(tmp_path))
    save_stored_settings(
        tmp_path,
        {
            "llm_provider_preset": "gemini",
            "llm_provider": "gemini",
            "llm_api_key": "AIzaDummyKeyForMock",
            "llm_model": "primary-model",
            "llm_fallback_model": "fallback-1, fallback-2",
        },
    )
    reload_settings()

    calls = []

    def fake_generate_content(model, contents, config):
        calls.append(model)
        if model == "primary-model":
            raise ClientError(429, {"error": {"code": 429, "message": "Quota exceeded"}})
        if model == "fallback-1":
            raise ServerError(503, {"error": {"code": 503, "message": "Model overloaded"}})
        mock_resp = MagicMock()
        mock_resp.parsed = _DummySchema(ok=True)
        return mock_resp

    mock_client = MagicMock()
    mock_client.models.generate_content.side_effect = fake_generate_content

    with patch("backend.app.llm.client.get_genai_client", return_value=mock_client), patch(
        "backend.app.llm.client.time.sleep", return_value=None
    ):
        res = generate_structured_content("hello", _DummySchema, model="primary-model")

    assert res.ok is True
    assert calls == ["primary-model", "fallback-1", "fallback-1", "fallback-2"]
    assert get_last_model_used() == "fallback-2"

    monkeypatch.delenv("PFE_DATA_DIR", raising=False)
    reload_settings()
