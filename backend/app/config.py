"""Application configuration and settings."""

import os
from pathlib import Path
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Load .env file from project root
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT_DIR / ".env")


def resolve_data_dir() -> Path:
    """Resolve user data directory: PFE_DATA_DIR -> ./data (repo checkout) -> ~/.pfe-assistant/."""
    env_dir = os.getenv("PFE_DATA_DIR")
    if env_dir:
        return Path(env_dir).expanduser().resolve()
    if (ROOT_DIR / "backend").exists() and (ROOT_DIR / "frontend").exists():
        return ROOT_DIR / "data"
    return Path.home() / ".pfe-assistant"


class Settings(BaseModel):
    app_mode: str = Field(default_factory=lambda: os.getenv("APP_MODE", "local"))
    root_dir: Path = ROOT_DIR
    data_dir: Path = Field(default_factory=resolve_data_dir)
    database_url: str = Field(
        default_factory=lambda: os.getenv("DATABASE_URL") or f"sqlite:///{(resolve_data_dir() / 'app.db').as_posix()}"
    )
    gemini_api_key: str = Field(
        default_factory=lambda: os.getenv("GEMINI_API_KEY", "")
    )
    pfebooks_base_url: str = "https://pfebooks.com/wp-json/wp/v2"

    # Multi-provider & model settings
    llm_provider_preset: str = "gemini"
    llm_provider: str = Field(
        default_factory=lambda: os.getenv("LLM_PROVIDER", "gemini").lower()
    )
    llm_model: str = Field(
        default_factory=lambda: os.getenv("LLM_MODEL", "gemini-3.5-flash")
    )
    llm_fallback_model: str = Field(
        default_factory=lambda: os.getenv(
            "LLM_FALLBACK_MODEL", "gemini-3.5-flash-lite, gemini-3.8-flash"
        )
    )
    llm_model_extract: str | None = Field(
        default_factory=lambda: os.getenv("LLM_MODEL_EXTRACT")
    )
    llm_model_match: str | None = Field(
        default_factory=lambda: os.getenv("LLM_MODEL_MATCH")
    )
    llm_model_draft: str | None = Field(
        default_factory=lambda: os.getenv("LLM_MODEL_DRAFT")
    )
    llm_model_tailor: str | None = Field(
        default_factory=lambda: os.getenv("LLM_MODEL_TAILOR")
    )
    llm_api_key: str = Field(
        default_factory=lambda: os.getenv("LLM_API_KEY") or os.getenv("GEMINI_API_KEY", "")
    )
    llm_base_url: str = Field(
        default_factory=lambda: os.getenv("LLM_BASE_URL", "https://api.openai.com/v1")
    )
    enable_pfebooks_sync: bool = True
    active_profile_id: str = "local-default"
    onboarding_completed: bool = False

    pdf_dir: Path = Field(default_factory=lambda: resolve_data_dir() / "pdfs")
    applications_dir: Path = Field(default_factory=lambda: resolve_data_dir() / "applications")

    def apply_stored_overrides(self) -> None:
        """Overlay persisted settings.json values onto runtime Settings (if file exists)."""
        from backend.app.settings_store import load_stored_settings
        stored = load_stored_settings(self.data_dir)
        if not stored:
            return
        for field_name in (
            "llm_provider_preset",
            "llm_provider",
            "llm_base_url",
            "llm_model",
            "llm_fallback_model",
            "llm_model_extract",
            "llm_model_match",
            "llm_model_draft",
            "llm_model_tailor",
            "enable_pfebooks_sync",
            "active_profile_id",
            "onboarding_completed",
        ):
            if field_name in stored and stored[field_name] is not None:
                setattr(self, field_name, stored[field_name])

        stored_key = stored.get("llm_api_key")
        if stored_key:
            self.llm_api_key = stored_key
            if self.llm_provider == "gemini":
                self.gemini_api_key = stored_key

    def is_llm_configured(self) -> bool:
        """True if an API key is present or provider is local Ollama."""
        if self.llm_provider_preset == "ollama" or "localhost:11434" in (self.llm_base_url or ""):
            return True
        return bool((self.llm_api_key or self.gemini_api_key or "").strip())

    def get_model_for_job(self, job_name: str) -> str:
        """Return configured model for specific job, with fallback to default llm_model."""
        overrides = {
            "extract": self.llm_model_extract,
            "match": self.llm_model_match,
            "draft": self.llm_model_draft,
            "tailor": self.llm_model_tailor,
        }
        return overrides.get(job_name.lower()) or self.llm_model

    def get_fallback_models(self, primary_model: str | None = None) -> list[str]:
        """Parse comma-separated fallback model chain, preserving order and excluding primary."""
        raw = self.llm_fallback_model or ""
        seen: set[str] = {primary_model.strip()} if primary_model else set()
        chain: list[str] = []
        for part in raw.split(","):
            m = part.strip()
            if m and m not in seen:
                seen.add(m)
                chain.append(m)
        return chain

    def ensure_directories(self) -> None:
        """Create required local data directories."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.pdf_dir.mkdir(parents=True, exist_ok=True)
        self.applications_dir.mkdir(parents=True, exist_ok=True)


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
        _settings.apply_stored_overrides()
        _settings.ensure_directories()
    return _settings


def reload_settings() -> Settings:
    """Reload settings from env + settings.json and reset cached LLM clients."""
    global _settings
    _settings = Settings()
    _settings.apply_stored_overrides()
    _settings.ensure_directories()
    try:
        from backend.app.llm.client import reset_genai_client
        reset_genai_client()
    except Exception:
        pass
    return _settings
