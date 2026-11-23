"""Prompt specification loader with frontmatter parsing and in-memory caching."""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path
from pydantic import BaseModel
import yaml

PROMPTS_DIR = Path(__file__).resolve().parent


class JobPromptSpec(BaseModel):
    name: str
    version: int = 1
    temperature: float | None = None
    output_schema: str | None = None
    system_prompt: str


@lru_cache(maxsize=32)
def _load_job_prompt_cached(clean_name: str, mtime_ns: int) -> JobPromptSpec:
    """Parse markdown prompt specification with YAML frontmatter (cached by mtime)."""
    prompt_file = PROMPTS_DIR / f"{clean_name}.md"
    raw_text = prompt_file.read_text(encoding="utf-8")
    if raw_text.startswith("---"):
        parts = raw_text.split("---", 2)
        if len(parts) >= 3:
            frontmatter_raw = parts[1].strip()
            body = parts[2].strip()
            meta = yaml.safe_load(frontmatter_raw) or {}
            return JobPromptSpec(
                name=meta.get("name", clean_name),
                version=int(meta.get("version", 1)),
                temperature=meta.get("temperature"),
                output_schema=meta.get("output_schema"),
                system_prompt=body,
            )

    return JobPromptSpec(
        name=clean_name,
        version=1,
        temperature=None,
        output_schema=None,
        system_prompt=raw_text.strip(),
    )


def load_job_prompt(job_name: str) -> JobPromptSpec:
    """Load markdown prompt specification with automatic reload when the file changes."""
    clean_name = job_name.lower().removesuffix(".md")
    prompt_file = PROMPTS_DIR / f"{clean_name}.md"
    if not prompt_file.exists():
        raise FileNotFoundError(f"Prompt specification not found: {prompt_file}")
    return _load_job_prompt_cached(clean_name, prompt_file.stat().st_mtime_ns)


def get_prompt_hash(job_name: str) -> str:
    """Compute sha256 hash of prompt file content for cache invalidation."""
    clean_name = job_name.lower().removesuffix(".md")
    prompt_file = PROMPTS_DIR / f"{clean_name}.md"
    if not prompt_file.exists():
        return ""
    return hashlib.sha256(prompt_file.read_bytes()).hexdigest()
