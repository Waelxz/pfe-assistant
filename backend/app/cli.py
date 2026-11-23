"""CLI entrypoint for launching PFE Assistant as a single local server."""

from __future__ import annotations

import argparse
import os
import socket
import threading
import time
import webbrowser


def _find_available_port(host: str, preferred_port: int) -> int:
    for port in range(preferred_port, preferred_port + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    return preferred_port


def _open_browser_when_ready(url: str, host: str, port: int) -> None:
    deadline = time.time() + 15.0
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex((host, port)) == 0:
                webbrowser.open(url)
                return
        time.sleep(0.25)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="pfe-assistant",
        description="Launch PFE Assistant local web server (FastAPI + React UI).",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Preferred port (default: 8000)")
    parser.add_argument("--data-dir", default=None, help="Override user data directory (PFE_DATA_DIR)")
    parser.add_argument("--no-browser", action="store_true", help="Do not auto-open browser tab")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    args = parser.parse_args(argv)

    if args.data_dir:
        os.environ["PFE_DATA_DIR"] = args.data_dir

    port = args.port if args.reload else _find_available_port(args.host, args.port)
    url = f"http://{args.host}:{port}"

    print(f"Starting PFE Assistant on {url}")
    if not args.no_browser:
        threading.Thread(
            target=_open_browser_when_ready,
            args=(url, args.host, port),
            daemon=True,
        ).start()

    import uvicorn

    uvicorn.run(
        "backend.app.main:app",
        host=args.host,
        port=port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
