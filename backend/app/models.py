"""SQLAlchemy database models for listings, extractions, matches, and applications."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Boolean,
    ForeignKey,
    JSON,
)
from sqlalchemy.orm import relationship
from backend.app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Listing(Base):
    __tablename__ = "listings"

    id = Column(Integer, primary_key=True, index=True)
    wp_post_id = Column(Integer, unique=True, index=True, nullable=False)
    slug = Column(String(255), unique=True, index=True, nullable=False)
    company_name = Column(String(255), nullable=False)
    post_url = Column(String(1024), nullable=False)
    published_at = Column(DateTime, nullable=True)
    modified_at = Column(DateTime, nullable=True)
    catalogue_term = Column(String(100), default="2026-2027")
    categories = Column(JSON, default=list)
    tags = Column(JSON, default=list)
    description_html = Column(Text, default="")
    description_text = Column(Text, default="")
    pdf_url = Column(String(1024), nullable=True)
    pdf_storage_key = Column(String(512), nullable=True)
    pdf_sha256 = Column(String(64), nullable=True, index=True)
    sync_status = Column(
        String(50), default="pending"
    )  # pending | downloaded | extracted | error
    location = Column(String(255), nullable=True)
    html_hints = Column(JSON, default=dict)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    extractions = relationship(
        "Extraction", back_populates="listing", cascade="all, delete-orphan"
    )
    subject_matches = relationship(
        "SubjectMatch", back_populates="listing", cascade="all, delete-orphan"
    )
    subject_comparisons = relationship(
        "SubjectComparison", back_populates="listing", cascade="all, delete-orphan"
    )
    applications = relationship(
        "Application", back_populates="listing", cascade="all, delete-orphan"
    )

    @property
    def extraction(self) -> Extraction | None:
        """Convenience property returning the latest extraction for this listing."""
        return self.extractions[-1] if self.extractions else None


class Extraction(Base):
    __tablename__ = "extractions"

    id = Column(Integer, primary_key=True, index=True)
    listing_id = Column(
        Integer, ForeignKey("listings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pdf_sha256 = Column(String(64), nullable=False)
    model_used = Column(String(100), nullable=False)
    structured_data = Column(JSON, nullable=False)  # ListingExtraction JSON
    extracted_at = Column(DateTime, default=utc_now)

    listing = relationship("Listing", back_populates="extractions")


class SubjectMatch(Base):
    __tablename__ = "subject_matches"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(100), index=True, nullable=False, default="local-default")
    listing_id = Column(
        Integer, ForeignKey("listings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    subject_ref = Column(String(100), nullable=False)
    profile_hash = Column(String(64), nullable=False)
    score = Column(Integer, default=0)
    compatibility_tier = Column(String(20), default="low")  # high | medium | low
    why_match = Column(Text, default="")
    interest_score = Column(Integer, default=0)
    interest_tier = Column(String(20), default="medium")  # high | medium | low
    why_interesting = Column(Text, default="")
    matched_skills = Column(JSON, default=list)
    missing_gaps = Column(JSON, default=list)
    score_breakdown = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=utc_now)

    listing = relationship("Listing", back_populates="subject_matches")


class SubjectComparison(Base):
    __tablename__ = "subject_comparisons"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(100), index=True, nullable=False, default="local-default")
    listing_id = Column(
        Integer, ForeignKey("listings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    subject_refs_key = Column(String(512), nullable=False, index=True)
    subject_refs = Column(JSON, default=list)
    profile_hash = Column(String(64), nullable=False)
    result = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=utc_now)

    listing = relationship("Listing", back_populates="subject_comparisons")


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(100), index=True, nullable=False, default="local-default")
    listing_id = Column(
        Integer, ForeignKey("listings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    selected_subject_refs = Column(JSON, default=list)
    language = Column(String(10), default="fr")  # fr | en
    delivery_mode = Column(
        String(50), default="combined_email"
    )  # combined_email | split_emails | external_form
    status = Column(
        String(50), default="new"
    )  # new | drafted | opened_gmail | sent | interview | rejected | archived
    email_to = Column(String(255), nullable=True)
    email_subject = Column(String(512), nullable=True)
    email_body = Column(Text, nullable=True)
    include_cover_letter = Column(Boolean, default=False)
    cover_letter_text = Column(Text, nullable=True)
    tailor_cv_enabled = Column(Boolean, default=False)
    cv_staged_diff = Column(JSON, nullable=True)
    cv_diff_confirmed = Column(Boolean, default=False)
    output_dir_key = Column(String(512), nullable=True)
    notes = Column(Text, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    listing = relationship("Listing", back_populates="applications")


class UserDocument(Base):
    __tablename__ = "user_documents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(100), index=True, nullable=False, default="local-default")
    doc_type = Column(
        String(50), nullable=False
    )  # transcript | diploma | recommendation | portfolio | other
    label = Column(String(255), nullable=False)
    storage_key = Column(String(512), nullable=False)
    original_filename = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=utc_now)
