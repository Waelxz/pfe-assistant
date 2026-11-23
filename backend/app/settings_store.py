"""Local runtime settings persistence (BYOK API keys, provider presets, UI preferences)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal
from pydantic import BaseModel, Field


PROVIDER_PRESETS: dict[str, dict[str, str]] = {
    "gemini": {
        "label": "Google Gemini (Recommended — Free Tier & Native PDF)",
        "llm_provider": "gemini",
        "llm_base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "llm_model": "gemini-3.5-flash",
        "llm_fallback_model": "gemini-3.5-flash-lite, gemini-3.8-flash",
        "docs_url": "https://aistudio.google.com/apikey",
    },
    "openrouter": {
        "label": "OpenRouter (Multi-Model Gateway)",
        "llm_provider": "openai_compatible",
        "llm_base_url": "https://openrouter.ai/api/v1",
        "llm_model": "google/gemini-3.5-flash",
        "llm_fallback_model": "google/gemini-3.5-flash-lite",
        "docs_url": "https://openrouter.ai/keys",
    },
    "openai": {
        "label": "OpenAI",
        "llm_provider": "openai_compatible",
        "llm_base_url": "https://api.openai.com/v1",
        "llm_model": "gpt-4o-mini",
        "llm_fallback_model": "gpt-4o-mini",
        "docs_url": "https://platform.openai.com/api-keys",
    },
    "groq": {
        "label": "Groq (Fast Open-Weight Inference)",
        "llm_provider": "openai_compatible",
        "llm_base_url": "https://api.groq.com/openai/v1",
        "llm_model": "llama-3.3-70b-versatile",
        "llm_fallback_model": "llama-3.1-8b-instant",
        "docs_url": "https://console.groq.com/keys",
    },
    "ollama": {
        "label": "Ollama (Local & Free, No API Key Required)",
        "llm_provider": "openai_compatible",
        "llm_base_url": "http://localhost:11434/v1",
        "llm_model": "llama3.1",
        "llm_fallback_model": "llama3.1",
        "docs_url": "https://ollama.com/download",
    },
    "custom": {
        "label": "Custom OpenAI-Compatible Endpoint",
        "llm_provider": "openai_compatible",
        "llm_base_url": "https://api.openai.com/v1",
        "llm_model": "gpt-4o-mini",
        "llm_fallback_model": "gpt-4o-mini",
        "docs_url": "",
    },
}


class StoredSettings(BaseModel):
    llm_provider_preset: str = "gemini"
    llm_provider: Literal["gemini", "openai_compatible"] = "gemini"
    llm_api_key: str = ""
    llm_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    llm_model: str = "gemini-3.5-flash"
    llm_fallback_model: str = "gemini-3.5-flash-lite, gemini-3.8-flash"
    llm_model_extract: str | None = None
    llm_model_match: str | None = None
    llm_model_draft: str | None = None
    llm_model_tailor: str | None = None
    enable_pfebooks_sync: bool = True
    active_profile_id: str = "local-default"
    onboarding_completed: bool = False


class SettingsUpdateRequest(BaseModel):
    llm_provider_preset: str | None = None
    llm_provider: Literal["gemini", "openai_compatible"] | None = None
    llm_api_key: str | None = None
    llm_base_url: str | None = None
    llm_model: str | None = None
    llm_fallback_model: str | None = None
    llm_model_extract: str | None = None
    llm_model_match: str | None = None
    llm_model_draft: str | None = None
    llm_model_tailor: str | None = None
    enable_pfebooks_sync: bool | None = None
    active_profile_id: str | None = None
    onboarding_completed: bool | None = None


def mask_api_key(key: str) -> str:
    """Return a masked representation of an API key safe to send to the frontend."""
    k = (key or "").strip()
    if not k:
        return ""
    if len(k) <= 8:
        return "•" * len(k)
    return f"{k[:4]}{'•' * 6}{k[-4:]}"


def is_masked_placeholder(value: str) -> bool:
    """True when the frontend sent back the unmodified masked key."""
    return "•" in value


def get_settings_file_path(data_dir: Path) -> Path:
    return data_dir / "settings.json"


def load_stored_settings(data_dir: Path) -> dict[str, Any]:
    """Read persisted settings.json if present; returns raw dict."""
    path = get_settings_file_path(data_dir)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_stored_settings(data_dir: Path, payload: dict[str, Any]) -> StoredSettings:
    """Validate and persist settings.json atomically."""
    data_dir.mkdir(parents=True, exist_ok=True)
    current = load_stored_settings(data_dir)
    merged = {**current, **payload}
    validated = StoredSettings(**merged)
    path = get_settings_file_path(data_dir)
    path.write_text(
        json.dumps(validated.model_dump(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return validated
