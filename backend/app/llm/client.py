"""Multi-provider LLM client with structured schema validation and fallback orchestration."""

from __future__ import annotations

import base64
import json
import logging
import random
import time
from pathlib import Path
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError
from google import genai
from google.genai import types
from google.genai.errors import ServerError, ClientError

from backend.app.config import get_settings

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.5-flash"
FALLBACK_MODEL = "gemini-3.5-flash-lite"

_client: genai.Client | None = None
_uploaded_files_cache: dict[str, tuple[types.File, float]] = {}
_last_model_used: str = DEFAULT_MODEL
_last_fallback_info: str | None = None

T = TypeVar("T", bound=BaseModel)


def get_last_model_used() -> str:
    """Return the model identifier that successfully generated the last response."""
    global _last_model_used
    return _last_model_used


def get_last_fallback_info() -> str | None:
    """Return brief notice if the last LLM call fell back to the secondary model."""
    global _last_fallback_info
    return _last_fallback_info


def reset_genai_client() -> None:
    """Clear cached Gemini client and uploaded file handles after settings change."""
    global _client, _uploaded_files_cache
    _client = None
    _uploaded_files_cache.clear()


def get_genai_client() -> genai.Client:
    """Return configured Gemini API client singleton."""
    global _client
    if _client is None:
        settings = get_settings()
        api_key = settings.llm_api_key or settings.gemini_api_key
        if not api_key:
            raise ValueError("API key is not configured. Open Settings to add your Gemini or LLM API key.")
        _client = genai.Client(api_key=api_key)
    return _client


def upload_pdf_cached(pdf_path: Path, cache_key: str | None = None) -> types.File:
    """Upload a PDF file to Gemini File API or reuse cached upload within 40 hours."""
    key = cache_key or str(pdf_path.resolve())
    now = time.time()

    if key in _uploaded_files_cache:
        file_ref, uploaded_at = _uploaded_files_cache[key]
        if now - uploaded_at < 40 * 3600:
            return file_ref

    client = get_genai_client()
    uploaded = client.files.upload(
        file=str(pdf_path),
        config=types.UploadFileConfig(
            display_name=pdf_path.name,
            mime_type="application/pdf",
        ),
    )
    _uploaded_files_cache[key] = (uploaded, now)
    return uploaded


def prepare_pdf_input(pdf_path: Path, cache_key: str | None = None) -> Any:
    """Prepares PDF input for the active provider (Gemini File API or PyMuPDF page representation)."""
    settings = get_settings()
    if settings.llm_provider == "gemini":
        return upload_pdf_cached(pdf_path, cache_key=cache_key)

    # Non-Gemini / OpenAI-compatible fallback via PyMuPDF
    import pymupdf

    with pymupdf.open(pdf_path) as doc:
        page_texts: list[str] = []
        total_text_len = 0

        for page_idx in range(len(doc)):
            page = doc[page_idx]
            txt = page.get_text() or ""
            total_text_len += len(txt.strip())
            page_texts.append(f"=== PAGE {page_idx + 1} ===\n{txt}")

        # If document has adequate text, return page-delimited string (capped for smaller context windows)
        if total_text_len >= 100:
            joined = "\n\n".join(page_texts)
            if len(joined) > 200_000:
                joined = joined[:200_000] + "\n\n[Truncated after 200,000 characters]"
            return joined

        # Scanned brochure with low text: return base64 images (first 8 pages max)
        image_parts: list[dict[str, Any]] = []
        max_pages = min(len(doc), 8)
        for p_idx in range(max_pages):
            pix = doc[p_idx].get_pixmap(dpi=150)
            img_bytes = pix.tobytes("jpeg")
            b64_str = base64.b64encode(img_bytes).decode("utf-8")
            image_parts.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{b64_str}"},
                }
            )
        return image_parts


def _backoff_seconds(attempt: int) -> float:
    return min(8.0, (1.5 * (2 ** attempt)) + random.uniform(0.15, 0.75))


def _strip_json_fences(raw_text: str) -> str:
    """Strip markdown ```json ... ``` wrappers returned by OpenAI-compatible models."""
    cleaned = (raw_text or "").strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def _extract_http_error_detail(resp: httpx.Response | None) -> str:
    if resp is None:
        return "Network error contacting LLM provider."
    try:
        err_json = resp.json()
        if isinstance(err_json, dict):
            err = err_json.get("error")
            if isinstance(err, dict) and err.get("message"):
                return str(err["message"])
            if err_json.get("message"):
                return str(err_json["message"])
    except Exception:
        pass
    return (resp.text or f"HTTP {resp.status_code}")[:300]


def _generate_openai_compatible(
    contents: list[Any] | str,
    response_schema: type[T],
    model: str,
    temperature: float | None = None,
    system_instruction: str | None = None,
    max_retries: int = 3,
    fallback_models: list[str] | None = None,
) -> tuple[T, str]:
    """Calls an OpenAI-compatible API endpoint via httpx with structured schema decoding and fallback chain."""
    settings = get_settings()
    base_url = settings.llm_base_url.rstrip("/")
    is_local = settings.llm_provider_preset == "ollama" or "localhost" in base_url or "127.0.0.1" in base_url
    api_key = settings.llm_api_key or ("ollama" if is_local else "")
    if not api_key:
        raise ValueError("Missing API key for configured LLM provider.")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Normalize messages
    messages: list[dict[str, Any]] = []
    if system_instruction:
        messages.append({"role": "system", "content": system_instruction})

    # Assemble user content
    if isinstance(contents, str):
        messages.append({"role": "user", "content": contents})
    elif isinstance(contents, list):
        user_text_parts: list[str] = []
        user_media_parts: list[dict[str, Any]] = []
        for item in contents:
            if isinstance(item, str):
                user_text_parts.append(item)
            elif isinstance(item, list) and all(isinstance(x, dict) for x in item):
                user_media_parts.extend(item)
            elif isinstance(item, dict):
                user_media_parts.append(item)
            else:
                user_text_parts.append(str(item))

        if user_media_parts:
            combined = [{"type": "text", "text": "\n\n".join(user_text_parts)}] + user_media_parts
            messages.append({"role": "user", "content": combined})
        else:
            messages.append({"role": "user", "content": "\n\n".join(user_text_parts)})

    schema_dict = response_schema.model_json_schema()
    model_chain = [model] + [m for m in (fallback_models or []) if m != model]
    model_idx = 0
    current_model = model_chain[model_idx]

    payload: dict[str, Any] = {
        "model": current_model,
        "messages": messages,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": response_schema.__name__,
                "strict": False,
                "schema": schema_dict,
            },
        },
    }
    if temperature is not None:
        payload["temperature"] = temperature

    with httpx.Client(timeout=120.0) as client:
        current_payload = payload
        json_mode_fallback = False
        total_budget = max(max_retries, len(model_chain) * 2)
        last_raw = ""

        for attempt in range(total_budget):
            try:
                current_payload["model"] = current_model
                resp = client.post(f"{base_url}/chat/completions", headers=headers, json=current_payload)
                if resp.status_code == 400 and not json_mode_fallback:
                    err_detail = _extract_http_error_detail(resp).lower()
                    if "image" in err_detail or "vision" in err_detail or "multimodal" in err_detail:
                        raise RuntimeError(
                            "Scanned PDF requires a vision-capable model (e.g. Google Gemini) or a multimodal model."
                        )
                    # Provider might not support json_schema mode, try json_object fallback
                    logger.warning("Provider rejected json_schema; falling back to json_object format.")
                    json_mode_fallback = True
                    current_payload["response_format"] = {"type": "json_object"}
                    schema_hint = f"\nYou MUST output valid JSON strictly matching this JSON Schema:\n{json.dumps(schema_dict)}"
                    if current_payload["messages"] and current_payload["messages"][0]["role"] == "system":
                        current_payload["messages"][0]["content"] += schema_hint
                    else:
                        current_payload["messages"].insert(0, {"role": "system", "content": schema_hint})
                    continue

                resp.raise_for_status()
                res_data = resp.json()
                raw_content = res_data["choices"][0]["message"].get("content") or ""
                last_raw = raw_content
                parsed = response_schema.model_validate_json(_strip_json_fences(raw_content))
                return parsed, current_model

            except (ValidationError, ValueError) as val_err:
                if attempt < total_budget - 1:
                    logger.warning(f"Structured parse failed ({val_err}). Appending error and retrying...")
                    if last_raw:
                        current_payload["messages"].append({"role": "assistant", "content": last_raw[:2000]})
                    error_repair_msg = f"Your previous response failed validation: {val_err}. Output strictly valid JSON matching the schema without markdown fences."
                    current_payload["messages"].append({"role": "user", "content": error_repair_msg})
                    continue
                raise

            except httpx.HTTPError as http_err:
                resp_obj = getattr(http_err, "response", None)
                status = getattr(resp_obj, "status_code", None)
                is_transient = status in (404, 429, 500, 502, 503, 504)
                if is_transient and attempt < total_budget - 1:
                    if model_idx + 1 < len(model_chain):
                        model_idx += 1
                        next_model = model_chain[model_idx]
                        logger.warning(f"Provider HTTP {status} on {current_model}; switching to fallback {next_model}.")
                        current_model = next_model
                        time.sleep(0.4)
                        continue
                    if status != 404:
                        time.sleep(_backoff_seconds(attempt))
                        continue
                detail = _extract_http_error_detail(resp_obj)
                raise RuntimeError(f"LLM provider error ({status or 'connection'}): {detail}") from http_err

    raise RuntimeError(f"OpenAI-compatible request failed after {total_budget} attempts.")


def generate_structured_content(
    contents: list[Any] | str,
    response_schema: type[T],
    model: str | None = None,
    temperature: float | None = 0.1,
    system_instruction: str | None = None,
    max_retries: int = 3,
) -> T:
    """Call LLM with structured schema, supporting Gemini SDK or OpenAI-compatible endpoint with fallback chain."""
    global _last_model_used, _last_fallback_info
    settings = get_settings()

    active_model = model or settings.llm_model or DEFAULT_MODEL
    fallback_chain = settings.get_fallback_models(active_model)
    if (
        settings.llm_provider == "gemini"
        and not fallback_chain
        and FALLBACK_MODEL != active_model
        and not (settings.llm_fallback_model or "").strip()
    ):
        fallback_chain = [FALLBACK_MODEL]
    model_chain = [active_model] + fallback_chain
    _last_fallback_info = None

    # Route to OpenAI-compatible provider if configured
    if settings.llm_provider != "gemini":
        result, used_model = _generate_openai_compatible(
            contents=contents,
            response_schema=response_schema,
            model=active_model,
            temperature=temperature,
            system_instruction=system_instruction,
            max_retries=max_retries,
            fallback_models=fallback_chain,
        )
        _last_model_used = used_model
        if used_model != active_model:
            _last_fallback_info = f"Fell back from {active_model} to {used_model}"
        return result

    # Default Google Gemini SDK path with ordered multi-model fallback chain
    client = get_genai_client()
    model_idx = 0
    current_model = model_chain[model_idx]
    retries_on_current = 0
    total_budget = max(max_retries, len(model_chain) * 2)

    for attempt in range(total_budget):
        try:
            config_kwargs: dict[str, Any] = {
                "response_mime_type": "application/json",
                "response_schema": response_schema,
            }
            if temperature is not None:
                config_kwargs["temperature"] = temperature
            if system_instruction:
                config_kwargs["system_instruction"] = system_instruction

            resp = client.models.generate_content(
                model=current_model,
                contents=contents,
                config=types.GenerateContentConfig(**config_kwargs),
            )

            if resp.parsed:
                _last_model_used = current_model
                if current_model != active_model:
                    _last_fallback_info = f"Fell back from {active_model} to {current_model}"
                return resp.parsed
            elif resp.text:
                parsed = response_schema.model_validate_json(resp.text)
                _last_model_used = current_model
                if current_model != active_model:
                    _last_fallback_info = f"Fell back from {active_model} to {current_model}"
                return parsed

            raise ValueError(f"Empty structured response received from {current_model}")

        except (ValidationError, ValueError) as parse_err:
            if attempt < total_budget - 1:
                logger.warning(
                    f"Structured validation error from {current_model} ({parse_err}), retrying (attempt {attempt + 1}/{total_budget})..."
                )
                time.sleep(0.75)
                continue
            raise

        except (ServerError, ClientError) as e:
            status_code = getattr(e, "code", getattr(e, "status_code", None))
            msg_str = str(e)
            is_transient = status_code in (503, 429, 500, 504, 404) or "UNAVAILABLE" in msg_str

            if is_transient and attempt < total_budget - 1:
                has_next_model = model_idx + 1 < len(model_chain)
                # Immediately pivot to next fallback on 429/404, or after 1 transient retry on 503/500
                if has_next_model and (status_code in (429, 404) or retries_on_current >= 1):
                    model_idx += 1
                    next_model = model_chain[model_idx]
                    logger.warning(
                        f"Gemini API {status_code} on {current_model}; switching to fallback model {next_model}."
                    )
                    current_model = next_model
                    retries_on_current = 0
                    time.sleep(0.4)
                    continue

                retries_on_current += 1
                sleep_sec = _backoff_seconds(attempt)
                logger.warning(
                    f"Gemini API transient error ({status_code}) on {current_model}, retrying in {sleep_sec:.1f}s..."
                )
                time.sleep(sleep_sec)
                continue
            raise

    raise RuntimeError(f"Failed to generate structured content after {total_budget} attempts.")


def test_llm_connection(
    provider: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """Run a tiny live connectivity check against the supplied or active LLM config."""
    settings = get_settings()
    eff_provider = (provider or settings.llm_provider or "gemini").lower()
    eff_url = (base_url or settings.llm_base_url or "https://api.openai.com/v1").rstrip("/")
    if eff_provider == "gemini":
        eff_key = api_key if api_key is not None else (settings.llm_api_key or settings.gemini_api_key)
    else:
        eff_key = api_key if api_key is not None else settings.llm_api_key
    eff_model = model or settings.llm_model or DEFAULT_MODEL

    if eff_provider == "gemini":
        if not eff_key:
            raise ValueError("Missing Gemini API key.")
        test_client = genai.Client(api_key=eff_key)
        resp = test_client.models.generate_content(
            model=eff_model,
            contents="Reply with OK",
            config=types.GenerateContentConfig(max_output_tokens=8, temperature=0.0),
        )
        return {
            "ok": True,
            "provider": "gemini",
            "model": eff_model,
            "reply": (resp.text or "OK").strip()[:40],
        }

    is_local = "localhost" in eff_url or "127.0.0.1" in eff_url
    if not eff_key and not is_local:
        raise ValueError("Missing API key for configured LLM provider.")

    headers = {
        "Authorization": f"Bearer {eff_key or 'ollama'}",
        "Content-Type": "application/json",
    }
    try:
        resp = httpx.post(
            f"{eff_url}/chat/completions",
            headers=headers,
            json={
                "model": eff_model,
                "messages": [{"role": "user", "content": "Reply with OK"}],
                "max_tokens": 8,
                "temperature": 0.0,
            },
            timeout=25.0,
        )
        resp.raise_for_status()
    except httpx.HTTPError as http_err:
        detail = _extract_http_error_detail(getattr(http_err, "response", None))
        raise RuntimeError(f"Connection test failed: {detail}") from http_err
    data = resp.json()
    reply = data["choices"][0]["message"]["content"]
    return {
        "ok": True,
        "provider": "openai_compatible",
        "model": eff_model,
        "reply": (reply or "OK").strip()[:40],
    }
