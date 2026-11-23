"""Extraction module for PFE Book PDFs and listing metadata using structured LLM prompts."""

from __future__ import annotations

from pathlib import Path
from backend.app.config import get_settings
from backend.app.llm.client import (
    prepare_pdf_input,
    generate_structured_content,
    DEFAULT_MODEL,
)
from backend.app.llm.prompts.loader import load_job_prompt
from backend.app.llm.schemas import ListingExtraction


def extract_listing_from_pdf(
    pdf_path: Path,
    description_html: str = "",
    company_hint: str = "",
    pdf_sha256: str | None = None,
    model: str | None = None,
) -> ListingExtraction:
    """Extract structured listing and subjects from a PFE Book PDF using structured prompts."""
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF file does not exist: {pdf_path}")

    settings = get_settings()
    active_model = model or settings.get_model_for_job("extract") or DEFAULT_MODEL
    spec = load_job_prompt("extract")

    pdf_input = prepare_pdf_input(pdf_path, cache_key=pdf_sha256)

    user_prompt = f"""<company_hint>
{company_hint or pdf_path.stem}
</company_hint>

<html_description>
{description_html or "None provided"}
</html_description>

<task>
Analyze the attached PDF and secondary HTML description, then extract structured data according to the schema.
Primary Invariant: The PDF is the authoritative primary source. Always extract facts (emails, deadlines, subjects, tech stacks) from the PDF.
Log discrepancies in conflicts_with_description.
</task>
"""

    return generate_structured_content(
        contents=[pdf_input, user_prompt] if not isinstance(pdf_input, str) else [f"{pdf_input}\n\n{user_prompt}"],
        response_schema=ListingExtraction,
        model=active_model,
        temperature=spec.temperature if spec.temperature is not None else 0.1,
        system_instruction=spec.system_prompt,
    )
