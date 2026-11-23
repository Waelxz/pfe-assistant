"""RenderCV Python wrapper with PyMuPDF 1-page & layout invariant enforcement."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any
import pymupdf
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
PROFILE_DIR = REPO_ROOT / "profile"
BASELINE_DIR = REPO_ROOT / "data" / "baseline"
THEME_DIR = Path(__file__).resolve().parent / "themes" / "pfeclassic"
MAX_BOTTOM_Y1_PT = 825.0  # A4 height 841.89pt minus ~0.6cm (17pt) bottom margin


def get_baseline_filenames(lang: str) -> tuple[str, str]:
    """Return canonical baseline (pdf_filename, png_filename) for a language."""
    lang_upper = lang.lower().upper()
    return f"baseline_CV_{lang_upper}.pdf", f"baseline_CV_{lang_upper}.png"


def render_baseline_cv(
    lang: str,
    output_dir: Path | None = None,
    profile_dir: Path | None = None,
) -> dict[str, Any]:
    """Renders baseline CV for given language ('en' or 'fr') and ensures PNG preview exists."""
    from backend.app.cv.profiles import get_active_profile_dir, get_active_baseline_dir

    pdir = profile_dir or get_active_profile_dir()
    dest_dir = output_dir or get_active_baseline_dir()
    dest_dir.mkdir(parents=True, exist_ok=True)
    lang_code = "fr" if lang.lower().startswith("fr") else "en"
    yaml_file = pdir / f"master.{lang_code}.yaml"
    if not yaml_file.exists():
        other = "en" if lang_code == "fr" else "fr"
        alt_yaml = pdir / f"master.{other}.yaml"
        if alt_yaml.exists():
            yaml_file = alt_yaml
    pdf_name, png_name = get_baseline_filenames(lang_code)

    pdf_path = render_cv_pdf(yaml_file, dest_dir, output_name=pdf_name)
    metrics = verify_cv_layout(pdf_path)
    png_path = render_pdf_to_png(pdf_path, dest_dir / png_name)

    return {
        "pdf_path": pdf_path,
        "png_path": png_path,
        "page_count": metrics["page_count"],
        "last_y1_pt": metrics["last_y1_pt"],
    }


def apply_typography_preset_to_yaml_dict(doc: dict[str, Any], preset_level: int = 0) -> dict[str, Any]:
    """Applies whitespace and typography presets to a RenderCV YAML dictionary.

    preset_level -1: Gentle vertical expansion when page has bottom deadspace (last_y1_pt < 755pt)
    preset_level 0:  Default locked pfeclassic template values
    preset_level 1:  Gentle whitespace compaction (~2 lines reclaimed)
    preset_level 2:  Medium whitespace compaction (~4 lines reclaimed)
    preset_level 3:  Micro-font fit (~7 lines reclaimed, 9.2pt body font)
    """
    import copy
    doc = copy.deepcopy(doc)
    design = doc.setdefault("design", {})
    page = design.setdefault("page", {})
    typography = design.setdefault("typography", {})
    font_size = typography.setdefault("font_size", {})
    section_titles = design.setdefault("section_titles", {})
    sections = design.setdefault("sections", {})
    entries = design.setdefault("entries", {})
    highlights = entries.setdefault("highlights", {})
    header = design.setdefault("header", {})

    if preset_level == -1:
        typography["line_spacing"] = "0.66em"
        page["top_margin"] = "0.95cm"
        page["bottom_margin"] = "0.95cm"
        section_titles["space_above"] = "0.32cm"
        section_titles["space_below"] = "0.16cm"
        sections["space_between_regular_entries"] = "0.22cm"
        sections["space_between_text_based_entries"] = "0.25cm"
        highlights["space_above"] = "0.08cm"
        highlights["space_between_items"] = "0.08cm"
        return doc

    if preset_level >= 1:
        page["top_margin"] = "0.82cm"
        page["bottom_margin"] = "0.82cm"
        typography["line_spacing"] = "0.58em"
        section_titles["space_above"] = "0.24cm"
        section_titles["space_below"] = "0.12cm"
        sections["space_between_regular_entries"] = "0.15cm"
        sections["space_between_text_based_entries"] = "0.18cm"
        highlights["space_above"] = "0.05cm"
        highlights["space_between_items"] = "0.05cm"

    if preset_level >= 2:
        page["top_margin"] = "0.75cm"
        page["bottom_margin"] = "0.75cm"
        page["left_margin"] = "0.95cm"
        page["right_margin"] = "0.95cm"
        typography["line_spacing"] = "0.55em"
        section_titles["space_above"] = "0.20cm"
        section_titles["space_below"] = "0.10cm"
        sections["space_between_regular_entries"] = "0.13cm"
        sections["space_between_text_based_entries"] = "0.15cm"
        highlights["space_above"] = "0.04cm"
        highlights["space_between_items"] = "0.04cm"
        header["space_below_connections"] = "0.12cm"

    if preset_level >= 3:
        font_size["body"] = "9.2pt"
        font_size["connections"] = "9.1pt"
        typography["line_spacing"] = "0.52em"
        page["top_margin"] = "0.68cm"
        page["bottom_margin"] = "0.68cm"
        page["left_margin"] = "0.9cm"
        page["right_margin"] = "0.9cm"
        section_titles["space_above"] = "0.17cm"
        section_titles["space_below"] = "0.09cm"

    return doc


class PageOverflowError(Exception):
    """Raised when a compiled CV PDF exceeds the 1-page or layout budget."""

    def __init__(self, page_count: int, pdf_path: Path, detail: str = ""):
        msg = f"Rendered CV exceeded 1-page layout lock ({page_count} page(s)) in {pdf_path}"
        if detail:
            msg = f"{msg}: {detail}"
        super().__init__(msg)
        self.page_count = page_count
        self.pdf_path = pdf_path
        self.detail = detail


def verify_cv_layout(pdf_path: Path) -> dict[str, float | int]:
    """Verifies 1-page lock and bottom margin headroom on a rendered CV PDF."""
    doc = pymupdf.open(pdf_path)
    try:
        page_count = len(doc)
        if page_count != 1:
            raise PageOverflowError(page_count, pdf_path, f"spilled onto {page_count} pages")

        blocks = doc[0].get_text("blocks")
        last_y1 = max((b[3] for b in blocks), default=0.0)
        if last_y1 > MAX_BOTTOM_Y1_PT:
            raise PageOverflowError(
                page_count,
                pdf_path,
                f"bottom text y1={last_y1:.2f}pt exceeds margin limit {MAX_BOTTOM_Y1_PT:.2f}pt",
            )
        return {"page_count": page_count, "last_y1_pt": round(last_y1, 2)}
    finally:
        doc.close()


def render_cv_pdf(
    yaml_path: str | Path,
    output_dir: str | Path,
    output_name: str | None = None,
    enforce_single_page: bool = True,
) -> Path:
    """Renders a RenderCV YAML file to PDF using bundled pfeclassic theme and verifies layout."""
    yaml_path = Path(yaml_path).resolve()
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not yaml_path.exists():
        raise FileNotFoundError(f"YAML file not found: {yaml_path}")

    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        # Bundle pfeclassic theme alongside staged YAML so any directory can compile cleanly
        if THEME_DIR.exists():
            shutil.copytree(THEME_DIR, tmp_path / "pfeclassic")

        # Normalize legacy theme name 'waelclassic' -> 'pfeclassic' in staged copy
        raw_text = yaml_path.read_text(encoding="utf-8")
        try:
            doc = yaml.safe_load(raw_text) or {}
            if isinstance(doc, dict):
                design = doc.get("design")
                if isinstance(design, dict) and design.get("theme") in (None, "waelclassic"):
                    design["theme"] = "pfeclassic"
                    raw_text = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True)
        except Exception:
            pass

        compile_yaml = tmp_path / yaml_path.name
        compile_yaml.write_text(raw_text, encoding="utf-8")

        result = subprocess.run(
            [sys.executable, "-m", "rendercv", "render", str(compile_yaml)],
            cwd=str(tmp_path),
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            check=False,
        )

        if result.returncode != 0:
            raise RuntimeError(f"RenderCV compilation failed:\n{result.stderr or result.stdout}")

        rendercv_output_dir = tmp_path / "rendercv_output"
        generated_pdfs = list(rendercv_output_dir.glob("*.pdf"))
        if not generated_pdfs:
            raise FileNotFoundError(f"No PDF generated by RenderCV in {rendercv_output_dir}")

        src_pdf = generated_pdfs[0]
        final_name = output_name if output_name else src_pdf.name
        dest_pdf = output_dir / final_name

        # Verify layout on source PDF BEFORE overwriting destination if destination already exists
        if enforce_single_page:
            verify_cv_layout(src_pdf)

        shutil.copy2(src_pdf, dest_pdf)
        return dest_pdf


def render_pdf_to_png(pdf_path: str | Path, output_png_path: str | Path, dpi: int = 150) -> Path:
    """Renders page 1 of a PDF to PNG for UI preview."""
    pdf_path = Path(pdf_path).resolve()
    output_png_path = Path(output_png_path).resolve()
    output_png_path.parent.mkdir(parents=True, exist_ok=True)

    doc = pymupdf.open(pdf_path)
    page = doc[0]
    pix = page.get_pixmap(dpi=dpi)
    pix.save(str(output_png_path))
    doc.close()

    return output_png_path


if __name__ == "__main__":
    for lang_code in ("en", "fr"):
        print(f"Compiling baseline {lang_code.upper()} CV...")
        res = render_baseline_cv(lang_code)
        print(f"OK {lang_code.upper()} PDF: {res['pdf_path']} (y1={res['last_y1_pt']}pt), PNG: {res['png_path']}")
