// TypeScript contracts matching FastAPI backend schemas

export interface AppConfig {
  app_mode: 'local' | 'hosted'
  user_id: string
  gemini_configured: boolean
  llm_provider?: 'gemini' | 'openai_compatible'
  llm_provider_preset?: string
  llm_model?: string
  enable_pfebooks_sync?: boolean
  active_profile_id?: string
  available_languages?: string[]
  baseline_url_prefix?: string
  onboarding_completed?: boolean
  has_profile?: boolean
  data_dir: string
  profile_hash: string
  tailor_cv_enabled: boolean
  candidate_name?: string
  candidate_email?: string
  candidate_institution?: string
  candidate_headline?: string
}

export interface ProfileSlot {
  id: string
  name: string
  is_active: boolean
  languages: string[]
  created_at?: string | null
}

export interface ProviderPreset {
  label: string
  llm_provider: 'gemini' | 'openai_compatible'
  llm_base_url: string
  llm_model: string
  llm_fallback_model: string
  docs_url: string
}

export interface RuntimeSettings {
  llm_provider_preset: string
  llm_provider: 'gemini' | 'openai_compatible'
  api_key_masked: string
  api_key_configured: boolean
  llm_base_url: string
  llm_model: string
  llm_fallback_model: string
  llm_model_extract?: string | null
  llm_model_match?: string | null
  llm_model_draft?: string | null
  llm_model_tailor?: string | null
  enable_pfebooks_sync: boolean
  active_profile_id: string
  onboarding_completed: boolean
  presets: Record<string, ProviderPreset>
}

export interface TestLLMResponse {
  ok: boolean
  provider: string
  model: string
  reply: string
}

export interface ListingSummary {
  id: number
  wp_post_id: number
  slug: string
  company_name: string
  post_url: string
  published_at: string | null
  modified_at: string | null
  catalogue_term: string
  categories?: string[]
  tags?: string[]
  location?: string | null
  data_source?: 'pdf' | 'html_preview'
  pdf_url: string | null
  pdf_storage_key: string | null
  pdf_sha256: string | null
  sync_status: 'pending' | 'downloaded' | 'extracted' | 'error'
  best_match_score: number | null
  best_interest_score?: number | null
  subject_count: number
  application_id: number | null
  application_status: 'new' | 'drafted' | 'opened_gmail' | 'sent' | 'interview' | 'rejected' | 'archived' | null
  apply_method: 'email' | 'form' | 'portal_link' | 'unknown' | null
  deadline: string | null
  max_subjects_allowed: number | null
  html_hints?: {
    location?: string | null
    deadline?: string | null
    apply_method?: string | null
    email?: string | null
    external_url?: string | null
    subject_count?: number
    subjects_preview?: Array<{ title: string; apply_url?: string | null }>
  }
}

export interface SubjectItem {
  ref: string
  title: string
  summary: string
  technologies: string[]
  target_profile: string
  duration?: string | null
  location?: string | null
  interns_needed?: number | null
  page_in_pdf: number
  work_mode?: 'solo' | 'binome' | 'both' | null
  apply_url?: string | null
}

export interface ApplicationRules {
  method: 'email' | 'form' | 'portal_link' | 'unknown'
  recipient_email?: string | null
  cc_emails: string[]
  external_url?: string | null
  subject_line_template?: string | null
  portal_instructions?: string | null
  deadline_raw?: string | null
  deadline_iso?: string | null
  max_subjects_allowed?: number | null
  one_email_per_subject?: boolean | null
  cover_letter_requested?: boolean
  file_naming_rule?: string | null
  required_documents: string[]
  required_documents_raw?: string[]
}

export interface ListingExtraction {
  company_name: string
  primary_language?: 'fr' | 'en'
  company_overview?: string
  location?: string | null
  application_rules: ApplicationRules
  subjects: SubjectItem[]
  conflicts_with_description: string[]
}

export interface SubjectMatch {
  subject_ref: string
  score: number
  compatibility_tier: 'high' | 'medium' | 'low'
  why_match: string
  interest_score?: number
  interest_tier?: 'high' | 'medium' | 'low'
  why_interesting?: string
  matched_skills: string[]
  missing_gaps: string[]
  score_breakdown?: {
    fit?: { domain: number; stack: number; academic: number; deliverable: number }
    richness?: { career: number; thesis: number; market: number }
  } | null
}

export interface TopicComparisonItem {
  subject_ref: string
  rank: number
  richness_verdict: string
  thesis_potential: string
  career_growth: string
  pros: string[]
  cons: string[]
}

export interface TopicComparisonResponse {
  recommended_refs: string[]
  overall_verdict: string
  comparisons: TopicComparisonItem[]
  subject_refs?: string[]
  cached?: boolean
}

export interface ExtractionResponse {
  listing_id: number
  company_name?: string
  extracted: boolean
  extraction?: ListingExtraction | null
  matches: SubjectMatch[]
  latest_comparison?: TopicComparisonResponse | null
}

export interface HeadlineSuggestion {
  original: string
  proposed: string
  reason: string
  accepted: boolean
  user_modified?: boolean
}

export interface SummarySuggestion {
  original: string
  proposed: string
  reason: string
  accepted: boolean
  user_modified?: boolean
  unverified_keywords: string[]
}

export interface SkillCategoryDiff {
  category: string
  original_details: string
  proposed_details: string
  reason: string
  accepted: boolean
  priority?: 'high' | 'medium' | 'low'
  user_modified?: boolean
  unverified_keywords: string[]
}

export interface BulletDiff {
  section: string
  entry_title: string
  bullet_index: number
  original_text: string
  proposed_text: string
  reason: string
  accepted: boolean
  priority?: 'high' | 'medium' | 'low'
  user_modified?: boolean
  unverified_keywords: string[]
}

export interface TopicKeywords {
  subject_ref: string
  subject_title: string
  keywords: string[]
}

export interface StagedCVDiff {
  language: 'en' | 'fr'
  headline_suggestion?: HeadlineSuggestion | null
  summary_suggestion?: SummarySuggestion | null
  skill_category_diffs: SkillCategoryDiff[]
  bullet_diffs: BulletDiff[]
  has_unverified_keywords: boolean
  all_unverified_keywords: string[]
  target_keywords?: string[]
  topic_keywords?: TopicKeywords[]
  available_bullets?: BulletDiff[]
  available_skills?: SkillCategoryDiff[]
}

export function isSyntheticRef(ref: string | null | undefined): boolean {
  if (!ref) return false
  return /^SUBJ-\d+$/i.test(ref.trim())
}

export interface ApplicationRecord {
  id: number
  listing_id: number
  selected_subject_refs: string[]
  selected_subject_titles?: string[]
  language: 'fr' | 'en'
  delivery_mode: 'combined_email' | 'split_emails' | 'external_form'
  status: 'new' | 'drafted' | 'opened_gmail' | 'sent' | 'interview' | 'rejected' | 'archived'
  email_to?: string | null
  email_subject?: string | null
  email_body?: string | null
  include_cover_letter: boolean
  cover_letter_text?: string | null
  tailor_cv_enabled: boolean
  cv_staged_diff?: StagedCVDiff | null
  cv_diff_confirmed: boolean
  output_dir_key?: string | null
  notes?: string | null
  sent_at?: string | null
  updated_at?: string | null
}

export interface ApplicationListItem {
  id: number
  listing_id: number
  company_name: string
  slug: string
  apply_method: 'email' | 'form' | 'portal_link' | 'unknown'
  deadline?: string | null
  selected_subject_refs: string[]
  selected_subject_titles?: string[]
  language: 'fr' | 'en'
  delivery_mode: 'combined_email' | 'split_emails' | 'external_form'
  status: 'new' | 'drafted' | 'opened_gmail' | 'sent' | 'interview' | 'rejected' | 'archived'
  email_to?: string | null
  email_subject?: string | null
  include_cover_letter: boolean
  tailor_cv_enabled: boolean
  cv_diff_confirmed: boolean
  output_dir_key?: string | null
  notes?: string | null
  sent_at?: string | null
  updated_at?: string | null
}

export interface UserDocumentItem {
  id: number
  doc_type: string
  label: string
  storage_key: string
  original_filename: string
  created_at: string | null
}

export interface PackageItem {
  doc_type: string
  filename: string
  path: string
  exists: boolean
}

export interface PreparePackageResponse {
  status: string
  package: {
    application_id: number
    company_name?: string
    target_folder: string
    package_dir?: string
    generated_files: PackageItem[]
    copied_files?: string[]
    missing_user_documents: string[]
    gmail_compose_urls: string[]
    gmail_inbox_url?: string | null
    external_url?: string | null
  }
}

export interface CVConfirmResponse {
  status: string
  application_id: number
  cv_diff_confirmed: boolean
  metrics: any
  pdf_url?: string
  png_url?: string
  layout_preset_applied?: number
  auto_compressed?: boolean
  fitted_diff?: StagedCVDiff
}

export interface SyncProgressEvent {
  step: 'start' | 'fetch_posts' | 'download_pdf' | 'extract' | 'match' | 'idle' | 'done'
  listing_slug?: string | null
  current_item?: number
  total_items?: number
  message?: string | null
  progress_pct: number
}

export interface ProfileBasics {
  name: string
  first_name?: string | null
  last_name?: string | null
  email: string
  phone: string
  location: string
  linkedin?: string | null
  github?: string | null
  website?: string | null
  institution?: string | null
  degree?: string | null
  availability?: string | null
}

export interface ExperienceItem {
  company: string
  position: string
  start_date: string
  end_date: string
  location: string
  highlights: string[]
}

export interface ProjectItem {
  name: string
  date?: string | null
  url?: string | null
  highlights: string[]
}

export interface EducationItem {
  institution: string
  degree: string
  area: string
  start_date: string
  end_date: string
  location: string
  highlights?: string[]
}

export interface SkillCategoryItem {
  label: string
  details: string
}

export interface CertificationItem {
  name: string
  issuer?: string | null
  date?: string | null
  details?: string | null
}

export interface ExtracurricularItem {
  organization: string
  role: string
  start_date?: string | null
  end_date?: string | null
  highlights: string[]
}

export interface CareerGoals {
  target_roles: string
  tech_to_learn: string
  dealbreakers: string
  pfe_priorities: string
}

export interface CandidateProfile {
  language: 'en' | 'fr'
  basics: ProfileBasics
  career_goals?: CareerGoals
  headline: string
  summary: string
  work_experience: ExperienceItem[]
  projects: ProjectItem[]
  education: EducationItem[]
  skills: SkillCategoryItem[]
  certifications?: CertificationItem[]
  extracurricular?: ExtracurricularItem[]
}

export interface ProfileMetrics {
  page_count: number
  last_y1_pt: number
  max_y1_pt: number
  pdf_url?: string
  png_url?: string
  valid?: boolean
  error?: string
}

export interface FullProfileResponse {
  en: CandidateProfile | null
  fr: CandidateProfile | null
  available_languages?: string[]
  active_profile_id?: string
  baseline_url_prefix?: string
  metrics: {
    en?: ProfileMetrics
    fr?: ProfileMetrics
  }
  profile_hash: string
  outdated_listings_count: number
}

export interface ProfileDraftPreviewResponse {
  status: 'success' | 'error'
  page_count?: number
  last_y1_pt?: number
  max_y1_pt?: number
  valid_1_page: boolean
  pdf_url?: string
  png_url?: string
  message?: string
}
