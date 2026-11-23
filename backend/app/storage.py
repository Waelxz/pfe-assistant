"""Storage adapters for local and hosted storage seams."""

from abc import ABC, abstractmethod
from pathlib import Path
from backend.app.config import get_settings


class StorageAdapter(ABC):
    """Abstract interface for storing PDFs, application packages, and document assets."""

    @abstractmethod
    def save_pdf(self, filename: str, content: bytes) -> str:
        """Store a downloaded PDF and return its storage key."""
        pass

    @abstractmethod
    def get_pdf_path(self, storage_key: str) -> Path | None:
        """Return local Path to the PDF file if available, or None."""
        pass

    @abstractmethod
    def save_application_file(
        self, folder_slug: str, filename: str, content: bytes
    ) -> str:
        """Save a generated application artifact (CV, cover letter, etc.) into application folder."""
        pass

    @abstractmethod
    def get_application_dir(self, folder_slug: str) -> Path:
        """Return the directory containing application package."""
        pass


class LocalStorageAdapter(StorageAdapter):
    """Stores files locally on disk under data/."""

    def __init__(self, data_dir: Path | None = None) -> None:
        settings = get_settings()
        self.data_dir = data_dir or settings.data_dir
        self.pdf_dir = self.data_dir / "pdfs"
        self.applications_dir = self.data_dir / "applications"
        self.documents_dir = self.data_dir / "documents"
        self.pdf_dir.mkdir(parents=True, exist_ok=True)
        self.applications_dir.mkdir(parents=True, exist_ok=True)
        self.documents_dir.mkdir(parents=True, exist_ok=True)

    def save_pdf(self, filename: str, content: bytes) -> str:
        safe_name = Path(filename).name
        target = self.pdf_dir / safe_name
        target.write_bytes(content)
        return str(target.relative_to(self.data_dir).as_posix())

    def save_document(self, filename: str, content: bytes) -> str:
        """Stores a user-uploaded document in data/documents/."""
        safe_name = Path(filename).name
        target = self.documents_dir / safe_name
        target.write_bytes(content)
        return str(target.relative_to(self.data_dir).as_posix())

    def get_pdf_path(self, storage_key: str) -> Path | None:
        target = self.data_dir / storage_key
        return target if target.exists() else None

    def save_application_file(
        self, folder_slug: str, filename: str, content: bytes
    ) -> str:
        folder = self.applications_dir / folder_slug
        folder.mkdir(parents=True, exist_ok=True)
        safe_name = Path(filename).name
        target = folder / safe_name
        target.write_bytes(content)
        return str(target.relative_to(self.data_dir).as_posix())

    def get_application_dir(self, folder_slug: str) -> Path:
        folder = self.applications_dir / folder_slug
        folder.mkdir(parents=True, exist_ok=True)
        return folder


class HostedStorageAdapter(StorageAdapter):
    """Stub implementation for future S3 / Cloud Storage backend."""

    def save_pdf(self, filename: str, content: bytes) -> str:
        raise NotImplementedError("Hosted storage adapter is not enabled.")

    def get_pdf_path(self, storage_key: str) -> Path | None:
        return None

    def save_application_file(
        self, folder_slug: str, filename: str, content: bytes
    ) -> str:
        raise NotImplementedError("Hosted storage adapter is not enabled.")

    def get_application_dir(self, folder_slug: str) -> Path:
        raise NotImplementedError("Hosted storage adapter is not enabled.")


def get_storage() -> StorageAdapter:
    """Return active storage adapter based on app configuration."""
    settings = get_settings()
    if settings.app_mode == "hosted":
        return HostedStorageAdapter()
    return LocalStorageAdapter()
