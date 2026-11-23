#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -x ".venv/bin/python" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
  echo "Installing Python dependencies..."
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements.txt
fi

if [ ! -f "frontend/dist/index.html" ] && command -v npm >/dev/null 2>&1; then
  echo "Building frontend bundle..."
  (cd frontend && npm ci && npm run build)
fi

echo "Launching PFE Assistant..."
exec .venv/bin/python -m backend.app.cli "$@"
