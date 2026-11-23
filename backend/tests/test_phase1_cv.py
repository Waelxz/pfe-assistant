"""Regression test for Phase 1: 1-Page CV invariant on master EN and FR profiles."""

from pathlib import Path
from backend.app.cv.render import render_cv_pdf, verify_cv_layout

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
PROFILE_DIR = REPO_ROOT / "profile"
TMP_DIR = REPO_ROOT / "data" / "test_cv"


def test_master_en_cv_one_page():
    """Verify master.en.yaml compiles to exactly 1 page."""
    pdf = render_cv_pdf(
        PROFILE_DIR / "master.en.yaml",
        TMP_DIR,
        output_name="test_CV_EN.pdf",
        enforce_single_page=True,
    )
    assert pdf.exists()
    layout = verify_cv_layout(pdf)
    assert layout["page_count"] == 1
    assert layout["last_y1_pt"] <= 817.0


def test_master_fr_cv_one_page():
    """Verify master.fr.yaml compiles to exactly 1 page."""
    pdf = render_cv_pdf(
        PROFILE_DIR / "master.fr.yaml",
        TMP_DIR,
        output_name="test_CV_FR.pdf",
        enforce_single_page=True,
    )
    assert pdf.exists()
    layout = verify_cv_layout(pdf)
    assert layout["page_count"] == 1
    assert layout["last_y1_pt"] <= 817.0
