"""Pydantic structured contracts for LLM extraction and profile matching."""

from typing import Literal
from pydantic import BaseModel, Field


class SubjectItem(BaseModel):
    ref: str = Field(
        description="Exact subject code printed in the PDF (e.g. 'PFE-01', 'Sujet 04', 'DATA-02'). If the PDF has no code, synthesize sequentially as 'SUBJ-01', 'SUBJ-02'."
    )
    title: str = Field(
        description="Exact internship project title in the document's original language."
    )
    summary: str = Field(
        description="Factual summary of the project objective, deliverables, and scope."
    )
    technologies: list[str] = Field(
        default_factory=list,
        description="Normalized list of specific languages, frameworks, databases, and tools explicitly listed for this subject.",
    )
    target_profile: str = Field(
        description="Requested academic degree or specialty (e.g. 'Master Data Science / Ingénieur Informatique'). Use 'Unspecified' if omitted."
    )
    duration: str | None = Field(
        default=None,
        description="Internship duration if explicitly stated (e.g. '4 à 6 mois').",
    )
    location: str | None = Field(
        default=None,
        description="Internship work location or 'Télétravail' / 'Hybride' if stated.",
    )
    interns_needed: int | None = Field(
        default=None,
        description="Number of interns requested for this subject, or null if unspecified.",
    )
    page_in_pdf: int = Field(
        default=1,
        ge=1,
        description="1-indexed PDF page number where this subject starts.",
    )
    work_mode: Literal["solo", "binome", "both"] | None = Field(
        default=None,
        description="'solo', 'binome' (pair), or 'both' if specified.",
    )
    apply_url: str | None = Field(
        default=None,
        description="Direct external application link for this specific subject if provided.",
    )


class ApplicationRules(BaseModel):
    method: Literal["email", "form", "portal_link", "unknown"] = Field(
        description="Primary application submission method: 'email', 'form', 'portal_link', or 'unknown'."
    )
    recipient_email: str | None = Field(
        default=None,
        description="Primary email address designated for receiving applications.",
    )
    cc_emails: list[str] = Field(
        default_factory=list,
        description="Secondary email addresses specifically requested to be CC'd.",
    )
    external_url: str | None = Field(
        default=None,
        description="Online form URL (Google/Microsoft Forms) or application portal link.",
    )
    subject_line_template: str | None = Field(
        default=None,
        description="Email subject template specified by the company, with placeholders normalized to {REF}, {NOM}, {PRENOM}.",
    )
    max_subjects_allowed: int | None = Field(
        default=None,
        description="Maximum number of subjects a candidate is allowed to apply for (e.g. 1 if 'un seul sujet').",
    )
    one_email_per_subject: bool | None = Field(
        default=None,
        description="True if company requires a separate email per applied subject.",
    )
    cover_letter_requested: bool = Field(
        default=False,
        description="True if company explicitly asks for a cover letter / lettre de motivation.",
    )
    required_documents: list[
        Literal[
            "cv",
            "cover_letter",
            "transcripts",
            "recommendation_letter",
            "portfolio",
            "cin_id",
            "other",
        ]
    ] = Field(
        default_factory=list,
        description="Normalized list of required documents.",
    )
    required_documents_raw: list[str] = Field(
        default_factory=list,
        description="Exact phrasing of required documents copied from the document.",
    )
    file_naming_rule: str | None = Field(
        default=None,
        description="Prescribed file naming convention if mentioned (e.g. 'CV_Nom_Prenom.pdf').",
    )
    deadline_iso: str | None = Field(
        default=None,
        description="Application deadline in YYYY-MM-DD format if date is fully known, otherwise null.",
    )
    deadline_raw: str | None = Field(
        default=None,
        description="Verbatim deadline text as printed in the document.",
    )


class ListingExtraction(BaseModel):
    company_name: str = Field(description="Official name of the recruiting company.")
    primary_language: Literal["fr", "en"] = Field(
        default="fr",
        description="Primary language ('fr' or 'en') of the majority of subject descriptions.",
    )
    company_overview: str = Field(
        default="",
        description="Brief summary of company sector and core business activities.",
    )
    location: str | None = Field(
        default=None,
        description="Company headquarters or primary internship city/country.",
    )
    application_rules: ApplicationRules = Field(
        description="Parsed application procedures, contacts, deadlines, and requirements."
    )
    subjects: list[SubjectItem] = Field(
        default_factory=list,
        description="List of distinct PFE internship subjects extracted from the catalog.",
    )
    conflicts_with_description: list[str] = Field(
        default_factory=list,
        description="Discrepancies noted where secondary HTML contradicts the authoritative PDF.",
    )


class SubjectMatchResult(BaseModel):
    subject_ref: str = Field(
        description="Exact subject reference code matching the catalog subject."
    )
    fit_domain: int = Field(
        default=0,
        ge=0,
        le=45,
        description="Domain Alignment sub-score (0-45).",
    )
    fit_stack: int = Field(
        default=0,
        ge=0,
        le=30,
        description="Technology Stack Overlap sub-score (0-30).",
    )
    fit_academic: int = Field(
        default=0,
        ge=0,
        le=15,
        description="Academic & Specialty Fit sub-score (0-15).",
    )
    fit_deliverable: int = Field(
        default=0,
        ge=0,
        le=10,
        description="Deliverable & Complexity Fit sub-score (0-10).",
    )
    score: int = Field(
        ge=0,
        le=100,
        description="Total fit score (0-100) equal to fit_domain + fit_stack + fit_academic + fit_deliverable.",
    )
    compatibility_tier: Literal["high", "medium", "low"] = Field(
        description="'high' (score >= 70), 'medium' (score 40-69), or 'low' (score < 40)."
    )
    why_match: str = Field(
        description="One concise line formatted as '+ [strongest proof]; - [main deduction/gap]' with no filler praise."
    )
    richness_career: int = Field(
        default=0,
        ge=0,
        le=40,
        description="Future Career & Learning Alignment sub-score (0-40).",
    )
    richness_thesis: int = Field(
        default=0,
        ge=0,
        le=35,
        description="Technical Depth & Thesis Richness sub-score (0-35).",
    )
    richness_market: int = Field(
        default=0,
        ge=0,
        le=25,
        description="CV & 2027 Market Leverage sub-score (0-25).",
    )
    interest_score: int = Field(
        default=0,
        ge=0,
        le=100,
        description="Total richness score (0-100) equal to richness_career + richness_thesis + richness_market (subject to rubric caps).",
    )
    interest_tier: Literal["high", "medium", "low"] = Field(
        default="medium",
        description="'high' (interest_score >= 70), 'medium' (40-69), or 'low' (< 40).",
    )
    why_interesting: str = Field(
        default="",
        description="One concise line formatted as '+ [strongest richness/goal driver]; - [main deduction/risk]' with no filler praise.",
    )
    is_vague_brief: bool = Field(
        default=False,
        description="True if the subject description is short/vague or only lists generic tools (caps interest_score at 65).",
    )
    is_dealbreaker: bool = Field(
        default=False,
        description="True if the subject's core work falls under candidate dealbreakers like basic CRUD or manual reporting (caps interest_score at 35).",
    )
    matched_skills: list[str] = Field(
        default_factory=list,
        description="Candidate's verified skills and tools from profile that apply to this subject.",
    )
    missing_gaps: list[str] = Field(
        default_factory=list,
        description="Required tools or domain competencies required by project that candidate lacks in profile.",
    )


class BatchMatchResponse(BaseModel):
    matches: list[SubjectMatchResult] = Field(
        default_factory=list,
        description="List of match evaluation results for all evaluated subjects.",
    )


class TopicComparisonItem(BaseModel):
    subject_ref: str = Field(description="Exact subject reference code.")
    rank: int = Field(ge=1, description="1-based preference rank (1 = strongest recommendation).")
    richness_verdict: str = Field(description="Honest assessment of engineering depth, tech stack, and substance vs buzzwords.")
    thesis_potential: str = Field(description="Suitability for a Master's/Engineering PFE thesis (metrics, experiments, architecture).")
    career_growth: str = Field(description="Alignment with candidate's target roles and technologies to learn.")
    pros: list[str] = Field(default_factory=list, description="2-3 concrete strengths.")
    cons: list[str] = Field(default_factory=list, description="1-2 concrete weaknesses, risks, or shallow aspects.")


class TopicComparisonResponse(BaseModel):
    recommended_refs: list[str] = Field(
        default_factory=list,
        description="Ordered list of subject_refs from best pick to least recommended.",
    )
    overall_verdict: str = Field(
        description="2-3 sentence executive recommendation explaining which topic(s) to pick and why."
    )
    comparisons: list[TopicComparisonItem] = Field(
        default_factory=list,
        description="Detailed per-topic breakdown in ranked order.",
    )
