"""Build helper: builds frontend/dist and copies it into backend/app/static before wheel packaging."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT / "frontend"
DIST_DIR = FRONTEND_DIR / "dist"
STATIC_DIR = ROOT / "backend" / "app" / "static"


def main() -> None:
    if not (DIST_DIR / "index.html").exists():
        print("Building frontend production bundle...")
        npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
        subprocess.run([npm_cmd, "ci"], cwd=str(FRONTEND_DIR), check=True)
        subprocess.run([npm_cmd, "run", "build"], cwd=str(FRONTEND_DIR), check=True)

    if STATIC_DIR.exists():
        shutil.rmtree(STATIC_DIR)
    shutil.copytree(DIST_DIR, STATIC_DIR)
    print(f"Copied {DIST_DIR} -> {STATIC_DIR}")


if __name__ == "__main__":
    main()
