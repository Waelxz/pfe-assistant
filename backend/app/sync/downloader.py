"""Rate-limited PDF downloader with SHA256 checksum verification and deduplication."""

import asyncio
import hashlib
import time
from pathlib import Path
import httpx
from pydantic import BaseModel
from backend.app.storage import StorageAdapter, get_storage


class DownloadResult(BaseModel):
    storage_key: str
    sha256: str
    size_bytes: int
    already_exists: bool
    status: str = "success"  # success | skipped | error
    error_message: str | None = None


class PdfDownloader:
    """Downloads PFE Book PDFs with rate limiting (1 req/sec) and SHA256 deduplication."""

    def __init__(
        self,
        storage: StorageAdapter | None = None,
        rate_limit_delay_s: float = 1.0,
        timeout: float = 60.0,
    ) -> None:
        self.storage = storage or get_storage()
        self.rate_limit_delay_s = rate_limit_delay_s
        self.timeout = timeout
        self._last_request_time: float = 0.0

    async def _throttle(self) -> None:
        """Enforce rate limit between outbound requests."""
        now = time.monotonic()
        elapsed = now - self._last_request_time
        if elapsed < self.rate_limit_delay_s:
            await asyncio.sleep(self.rate_limit_delay_s - elapsed)
        self._last_request_time = time.monotonic()

    async def download_pdf(
        self,
        pdf_url: str,
        slug: str,
        existing_sha256: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> DownloadResult:
        """Download PDF from URL, verify PDF header, compute SHA256, and persist via storage adapter."""
        await self._throttle()

        own_client = client is None
        http = client or httpx.AsyncClient(
            timeout=self.timeout, follow_redirects=True
        )

        try:
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                )
            }
            resp = await http.get(pdf_url, headers=headers)
            resp.raise_for_status()
            content = resp.content

            if not content.startswith(b"%PDF-"):
                return DownloadResult(
                    storage_key="",
                    sha256="",
                    size_bytes=len(content),
                    already_exists=False,
                    status="error",
                    error_message=f"Downloaded file does not start with %PDF- magic bytes (url: {pdf_url})",
                )

            computed_sha = hashlib.sha256(content).hexdigest()
            filename = f"{slug}_{computed_sha[:8]}.pdf"

            if existing_sha256 and existing_sha256 == computed_sha:
                # Content identical to existing record
                existing_path = self.storage.get_pdf_path(f"pdfs/{filename}")
                if existing_path and existing_path.exists():
                    return DownloadResult(
                        storage_key=f"pdfs/{filename}",
                        sha256=computed_sha,
                        size_bytes=len(content),
                        already_exists=True,
                        status="skipped",
                    )

            storage_key = self.storage.save_pdf(filename, content)

            return DownloadResult(
                storage_key=storage_key,
                sha256=computed_sha,
                size_bytes=len(content),
                already_exists=False,
                status="success",
            )

        except Exception as exc:
            return DownloadResult(
                storage_key="",
                sha256="",
                size_bytes=0,
                already_exists=False,
                status="error",
                error_message=str(exc),
            )
        finally:
            if own_client:
                await http.aclose()
