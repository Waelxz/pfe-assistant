import type {
  AppConfig,
  ListingSummary,
  ExtractionResponse,
  ApplicationRecord,
  ApplicationListItem,
  StagedCVDiff,
  PreparePackageResponse,
  UserDocumentItem,
  CVConfirmResponse,
  CandidateProfile,
  FullProfileResponse,
  ProfileDraftPreviewResponse,
  ProfileMetrics,
  TopicComparisonResponse,
  RuntimeSettings,
  TestLLMResponse,
  ProfileSlot,
} from './types'

const API_BASE = '/api'

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch(`${API_BASE}/config`)
  if (!res.ok) throw new Error('Failed to fetch config')
  return res.json()
}

export async function fetchSettings(): Promise<RuntimeSettings> {
  const res = await fetch(`${API_BASE}/settings`)
  if (!res.ok) throw new Error('Failed to fetch settings')
  return res.json()
}

export async function updateSettings(payload: Record<string, any>): Promise<RuntimeSettings> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to save settings')
  }
  return res.json()
}

export async function testLLMConnection(payload?: {
  llm_provider?: string
  llm_api_key?: string
  llm_base_url?: string
  llm_model?: string
}): Promise<TestLLMResponse> {
  const res = await fetch(`${API_BASE}/settings/test-llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Connection test failed')
  }
  return res.json()
}

export async function fetchListings(catalogue = '2026-2027'): Promise<ListingSummary[]> {
  const res = await fetch(`${API_BASE}/listings?catalogue=${encodeURIComponent(catalogue)}`)
  if (!res.ok) throw new Error('Failed to fetch listings')
  return res.json()
}

export async function fetchListingExtraction(listingId: number): Promise<ExtractionResponse> {
  const res = await fetch(`${API_BASE}/listings/${listingId}/extraction`)
  if (!res.ok) throw new Error('Failed to fetch extraction')
  return res.json()
}

export async function triggerExtraction(listingId: number, forceExtract = false): Promise<ExtractionResponse> {
  const res = await fetch(`${API_BASE}/listings/${listingId}/extract?force_extract=${forceExtract}`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Extraction failed')
  }
  return res.json()
}

export async function rematchListing(listingId: number): Promise<ExtractionResponse> {
  const res = await fetch(`${API_BASE}/listings/${listingId}/rematch`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Re-scoring failed')
  }
  return res.json()
}

export async function compareListingSubjects(
  listingId: number,
  subjectRefs: string[],
  force = false
): Promise<TopicComparisonResponse> {
  const res = await fetch(`${API_BASE}/listings/${listingId}/compare-subjects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject_refs: subjectRefs, force }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Comparison failed')
  }
  return res.json()
}

export async function archiveListing(listingId: number, archived = true): Promise<{
  status: string
  listing_id: number
  application_id: number
  application_status: string
}> {
  const res = await fetch(`${API_BASE}/listings/${listingId}/archive?archived=${archived}`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to archive listing')
  return res.json()
}

export async function triggerSync(): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/sync`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to trigger sync')
  return res.json()
}

export interface UploadPfeBookResponse {
  status: string
  already_existed: boolean
  extracted: boolean
  extraction_error?: string | null
  listing: ListingSummary
}

export async function uploadPfeBook(formData: FormData): Promise<UploadPfeBookResponse> {
  const res = await fetch(`${API_BASE}/listings/upload`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to upload PFE Book')
  }
  return res.json()
}

export async function deleteListing(listingId: number): Promise<{ status: string; deleted_id: number }> {
  const res = await fetch(`${API_BASE}/listings/${listingId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to delete listing')
  }
  return res.json()
}

export async function fetchApplicationByListing(listingId: number): Promise<ApplicationRecord | null> {
  const res = await fetch(`${API_BASE}/applications/by-listing/${listingId}`)
  if (!res.ok) throw new Error('Failed to fetch application')
  return res.json()
}

export async function draftApplication(payload: {
  listing_id: number
  selected_subject_refs: string[]
  language: 'fr' | 'en'
  delivery_mode: 'combined_email' | 'split_emails' | 'external_form'
  include_cover_letter: boolean
  user_instruction?: string
}): Promise<ApplicationRecord> {
  const res = await fetch(`${API_BASE}/applications/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Drafting failed')
  }
  return fetchApplicationByListing(payload.listing_id) as Promise<ApplicationRecord>
}

export async function regenerateApplication(
  applicationId: number,
  payload: { user_instruction?: string; target: 'all' | 'email' | 'cover_letter' }
): Promise<{ email_subject?: string; email_body?: string; cover_letter_text?: string }> {
  const res = await fetch(`${API_BASE}/applications/${applicationId}/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Regeneration failed')
  }
  return res.json()
}

export async function generateCVDiff(
  applicationId: number,
  instruction?: string
): Promise<{ status: string; diff: StagedCVDiff }> {
  const res = await fetch(`${API_BASE}/applications/${applicationId}/cv-diff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_instruction: instruction || null }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'CV Diff generation failed')
  }
  return res.json()
}

export async function previewCVDiff(
  applicationId: number,
  diff: StagedCVDiff
): Promise<{
  status: string
  application_id: number
  metrics: any
  layout_preset_applied?: number
  auto_compressed?: boolean
  pdf_url: string
  png_url: string
}> {
  const res = await fetch(`${API_BASE}/applications/${applicationId}/cv-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diff }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to render CV preview')
  }
  return res.json()
}

export async function confirmCVDiff(
  applicationId: number,
  diff: StagedCVDiff
): Promise<CVConfirmResponse> {
  const res = await fetch(`${API_BASE}/applications/${applicationId}/cv-confirm`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diff }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to confirm CV diff')
  }
  return res.json()
}

export async function saveCVDraftDiff(
  applicationId: number,
  diff: StagedCVDiff
): Promise<{ status: string; diff: StagedCVDiff }> {
  const res = await fetch(`${API_BASE}/applications/${applicationId}/cv-draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diff }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to save CV draft')
  }
  return res.json()
}

export async function saveApplicationEdits(
  applicationId: number,
  payload: {
    email_to?: string
    email_subject?: string
    email_body?: string
    cover_letter_text?: string
    include_cover_letter?: boolean
    language?: 'fr' | 'en'
    delivery_mode?: 'combined_email' | 'split_emails' | 'external_form'
    selected_subject_refs?: string[]
    tailor_cv_enabled?: boolean
  }
): Promise<{ status: string; application_id: number; application_status: string }> {
  const res = await fetch(`${API_BASE}/applications/${applicationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to save application edits')
  }
  return res.json()
}

export async function deleteApplication(applicationId: number): Promise<{ status: string; deleted_id: number }> {
  const res = await fetch(`${API_BASE}/applications/${applicationId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to delete application')
  }
  return res.json()
}

export function getApplicationZipUrl(applicationId: number): string {
  return `${API_BASE}/applications/${applicationId}/download-zip`
}

export function getApplicationFileUrl(applicationId: number, filename: string): string {
  return `${API_BASE}/applications/${applicationId}/files/${encodeURIComponent(filename)}`
}

export async function prepareSend(
  applicationId: number,
  senderEmail?: string
): Promise<PreparePackageResponse> {
  const query = new URLSearchParams()
  if (senderEmail) query.set('sender_email', senderEmail)
  const qs = query.toString()

  const res = await fetch(
    `${API_BASE}/applications/${applicationId}/prepare-send${qs ? `?${qs}` : ''}`,
    { method: 'POST' }
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Prepare package failed')
  }
  return res.json()
}

export async function fetchApplications(status?: string): Promise<ApplicationListItem[]> {
  const url = status && status !== 'all'
    ? `${API_BASE}/applications?status=${encodeURIComponent(status)}`
    : `${API_BASE}/applications`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch applications')
  return res.json()
}

export async function updateApplicationStatus(
  applicationId: number,
  status: ApplicationRecord['status'],
  notes?: string
): Promise<{ status: string; new_status: string; notes?: string }> {
  const res = await fetch(`${API_BASE}/applications/${applicationId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, notes }),
  })
  if (!res.ok) throw new Error('Failed to update status')
  return res.json()
}

export async function fetchUserDocuments(): Promise<UserDocumentItem[]> {
  const res = await fetch(`${API_BASE}/documents`)
  if (!res.ok) throw new Error('Failed to fetch user documents')
  return res.json()
}

export async function uploadUserDocument(formData: FormData): Promise<UserDocumentItem> {
  const res = await fetch(`${API_BASE}/documents`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) throw new Error('Failed to upload document')
  return res.json()
}

export async function deleteUserDocument(documentId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${documentId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete document')
}

export async function fetchProfilePreview(lang: 'en' | 'fr'): Promise<{
  status: string
  language: string
  page_count: number
  pdf_path: string
  png_path: string
}> {
  const res = await fetch(`${API_BASE}/profile/preview?lang=${lang}`)
  if (!res.ok) throw new Error('Failed to fetch profile preview')
  return res.json()
}

export async function fetchProfiles(): Promise<{ active_profile_id: string; profiles: ProfileSlot[] }> {
  const res = await fetch(`${API_BASE}/profiles`)
  if (!res.ok) throw new Error('Failed to fetch profiles')
  return res.json()
}

export async function createProfile(name: string, activate = true): Promise<{ status: string; profile: ProfileSlot }> {
  const res = await fetch(`${API_BASE}/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, activate }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to create profile')
  }
  return res.json()
}

export async function activateProfile(profileId: string): Promise<{ status: string; profile: ProfileSlot }> {
  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(profileId)}/activate`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to activate profile')
  }
  return res.json()
}

export async function deleteProfile(profileId: string): Promise<{ status: string; deleted_id: string }> {
  const res = await fetch(`${API_BASE}/profiles/${encodeURIComponent(profileId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to delete profile')
  }
  return res.json()
}

export async function loadSampleProfile(lang: 'en' | 'fr' | 'both' = 'both'): Promise<{ status: string; languages: string[] }> {
  const res = await fetch(`${API_BASE}/profile/load-sample?lang=${lang}`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load sample profile')
  }
  return res.json()
}

export async function fetchFullProfile(): Promise<FullProfileResponse> {
  const res = await fetch(`${API_BASE}/profile`)
  if (!res.ok) throw new Error('Failed to fetch candidate profile')
  return res.json()
}

export async function updateProfile(
  lang: 'en' | 'fr',
  profile: CandidateProfile,
  autoFit = true
): Promise<{
  status: string
  language: string
  profile: CandidateProfile
  metrics: ProfileMetrics
  profile_hash: string
}> {
  const res = await fetch(`${API_BASE}/profile/${lang}?auto_fit=${autoFit}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to update profile')
  }
  return res.json()
}

export async function previewProfileDraft(
  lang: 'en' | 'fr',
  profile: CandidateProfile,
  preset = 0
): Promise<ProfileDraftPreviewResponse> {
  const res = await fetch(`${API_BASE}/profile/preview-draft/${lang}?preset=${preset}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to generate preview draft')
  }
  return res.json()
}

export async function importProfilePdf(
  file: File
): Promise<{ status: string; detected_language: 'en' | 'fr'; profile: CandidateProfile }> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API_BASE}/profile/import-pdf`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to parse CV PDF')
  }
  return res.json()
}

export async function optimizeProfileAts(payload: {
  lang: 'en' | 'fr'
  profile: CandidateProfile
}): Promise<{
  status: string
  language: 'en' | 'fr'
  profile: CandidateProfile
  improvements: string[]
}> {
  const res = await fetch(`${API_BASE}/profile/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to ATS-optimize profile')
  }
  return res.json()
}

export async function translateProfile(payload: {
  source_lang: 'en' | 'fr'
  target_lang: 'en' | 'fr'
  profile: CandidateProfile
  auto_save?: boolean
}): Promise<{
  status: string
  target_language: 'en' | 'fr'
  profile: CandidateProfile
  metrics?: ProfileMetrics
}> {
  const res = await fetch(`${API_BASE}/profile/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to translate profile')
  }
  return res.json()
}

export async function rescoreAllListings(): Promise<{
  status: string
  profile_hash: string
  rescored_listings: number
}> {
  const res = await fetch(`${API_BASE}/profile/rescore-all`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to rescore listings')
  }
  return res.json()
}
