#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -x ".venv/bin/python" ]; then
  if ! python3 -c "import sys; assert sys.version_info >= (3, 12)" >/dev/null 2>&1; then
    echo "Error: Python 3.12+ is required."
    exit 1
  fi
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
  echo "Installing Python dependencies..."
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements.txt
fi

if [ ! -f "frontend/dist/index.html" ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "Building frontend bundle..."
    (cd frontend && npm ci && npm run build)
  else
    echo "Warning: npm not found and frontend/dist missing. Install Node.js 20+ to build the UI."
  fi
fi

echo "Launching PFE Assistant..."
exec .venv/bin/python -m backend.app.cli "$@"
