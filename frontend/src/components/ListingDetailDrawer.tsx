import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  Building2,
  ExternalLink,
  FileText,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Layers,
  MapPin,
  Calendar,
  Mail,
  Users,
  User,
  BookOpen,
  Check,
  Flame,
  Scale,
} from 'lucide-react'
import {
  fetchListingExtraction,
  triggerExtraction,
  rematchListing,
  compareListingSubjects,
} from '../api'
import {
  isSyntheticRef,
  type ListingSummary,
  type ExtractionResponse,
  type SubjectMatch,
  type TopicComparisonResponse,
} from '../types'

interface ListingDetailDrawerProps {
  listing: ListingSummary | null
  initialSelectedRefs?: string[]
  mode?: 'catalogue' | 'workspace'
  onClose: (selectedRefs?: string[]) => void
  onDraftWithSubjects: (listing: ListingSummary, selectedRefs: string[]) => void
  onListingUpdated?: () => void
}

function safeHttpUrl(raw?: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

export const ListingDetailDrawer: React.FC<ListingDetailDrawerProps> = ({
  listing,
  initialSelectedRefs,
  mode = 'catalogue',
  onClose,
  onDraftWithSubjects,
  onListingUpdated,
}) => {
  const [data, setData] = useState<ExtractionResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRefs, setSelectedRefs] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<'overall' | 'fit' | 'interest'>('overall')
  const [rematching, setRematching] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [comparison, setComparison] = useState<TopicComparisonResponse | null>(null)
  const [compareRefs, setCompareRefs] = useState<string[]>([])
  const comparisonRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!listing) return
    setError(null)
    setSelectedRefs([])
    setComparison(null)
    setCompareRefs([])
    setLoading(true)

    fetchListingExtraction(listing.id)
      .then((res) => {
        setData(res)
        // Find highest match % topic
        let bestMatchRef: string | null = null
        if (res.matches && res.matches.length > 0) {
          const sorted = [...res.matches].sort((a, b) => b.score - a.score)
          bestMatchRef = sorted[0].subject_ref
        } else if (res.extraction?.subjects && res.extraction.subjects.length > 0) {
          bestMatchRef = res.extraction.subjects[0].ref
        }

        const validSet = new Set((res.extraction?.subjects || []).map((s) => s.ref))
        const validInitial = (initialSelectedRefs || []).filter((r) => validSet.has(r))

        // Only use initialSelectedRefs that actually belong to this listing
        if (validInitial.length > 0) {
          setSelectedRefs(validInitial)
        } else if (bestMatchRef) {
          setSelectedRefs([bestMatchRef])
        } else {
          setSelectedRefs([])
        }

        if (res.latest_comparison) {
          setComparison(res.latest_comparison)
          if (res.latest_comparison.subject_refs && res.latest_comparison.subject_refs.length >= 2) {
            setCompareRefs(res.latest_comparison.subject_refs)
          }
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [listing, initialSelectedRefs])

  if (!listing) return null

  const handleExtract = async (force = false) => {
    try {
      setExtracting(true)
      setError(null)
      const res = await triggerExtraction(listing.id, force)
      setData(res)
      if (res.matches && res.matches.length > 0) {
        const sorted = [...res.matches].sort((a, b) => b.score - a.score)
        setSelectedRefs([sorted[0].subject_ref])
      }
      onListingUpdated?.()
    } catch (err: any) {
      setError(err.message || 'Extraction failed')
    } finally {
      setExtracting(false)
    }
  }

  const handleRematch = async () => {
    if (!listing) return
    try {
      setRematching(true)
      setError(null)
      const res = await rematchListing(listing.id)
      setData(res)
      onListingUpdated?.()
    } catch (err: any) {
      setError(err.message || 'Re-scoring failed')
    } finally {
      setRematching(false)
    }
  }

  const toggleCompareRef = (ref: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (compareRefs.includes(ref)) {
      setCompareRefs(compareRefs.filter((r) => r !== ref))
    } else {
      setCompareRefs([...compareRefs, ref])
    }
  }

  const runCompare = async (refs: string[], force = false) => {
    if (!listing || refs.length < 2) return
    try {
      setComparing(true)
      setError(null)
      const res = await compareListingSubjects(listing.id, refs, force)
      setComparison(res)
      setTimeout(() => {
        comparisonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 50)
    } catch (err: any) {
      setError(err.message || 'Comparison failed')
    } finally {
      setComparing(false)
    }
  }

  const handleCompareTop3 = () => {
    const topRefs = sortedSubjects.slice(0, 3).map((s) => s.ref)
    if (topRefs.length < 2) return
    setCompareRefs(topRefs)
    void runCompare(topRefs)
  }

  const toggleSubject = (ref: string) => {
    const maxAllowed = data?.extraction?.application_rules.max_subjects_allowed
    if (selectedRefs.includes(ref)) {
      setSelectedRefs(selectedRefs.filter((r) => r !== ref))
    } else if (maxAllowed && maxAllowed === 1) {
      setSelectedRefs([ref])
    } else {
      setSelectedRefs([...selectedRefs, ref])
    }
  }

  const rules = data?.extraction?.application_rules
  const subjects = data?.extraction?.subjects || []
  const matches = data?.matches || []

  // Combine subjects with their match scores
  const matchMap = new Map<string, SubjectMatch>()
  matches.forEach((m) => matchMap.set(m.subject_ref, m))

  const sortedSubjects = [...subjects].sort((a, b) => {
    const ma = matchMap.get(a.ref)
    const mb = matchMap.get(b.ref)
    const getVal = (m?: SubjectMatch) => {
      if (!m) return -1
      if (sortBy === 'fit') return m.score
      if (sortBy === 'interest') return m.interest_score && m.interest_score > 0 ? m.interest_score : m.score
      return m.interest_score && m.interest_score > 0 ? Math.sqrt(m.score * m.interest_score) : m.score
    }
    return getVal(mb) - getVal(ma)
  })

  const maxAllowed = rules?.max_subjects_allowed
  const isOverLimit = maxAllowed ? selectedRefs.length > maxAllowed : false

  // PDF URL relative to backend
  const pdfViewUrl = listing.pdf_storage_key ? `/data/${listing.pdf_storage_key}` : null

  return (
    <div
      onClick={() => onClose(selectedRefs)}
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl bg-white max-h-[90vh] shadow-2xl rounded-2xl border border-slate-200 flex flex-col animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 rounded-t-2xl">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 truncate">
                {listing.company_name}
              </h2>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-mono">{listing.slug}</span>
                {listing.location && (
                  <>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1 text-slate-600 font-medium">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      {listing.location}
                    </span>
                  </>
                )}
                <span>•</span>
                {safeHttpUrl(listing.post_url) ? (
                  <a
                    href={safeHttpUrl(listing.post_url)!}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-600 hover:underline flex items-center gap-1"
                  >
                    {listing.wp_post_id < 0 ? 'Source link' : 'pfebooks post'}{' '}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-indigo-600 font-medium">
                    User Uploaded PDF
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {pdfViewUrl && (
              <a
                href={pdfViewUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors shadow-xs"
              >
                <FileText className="w-3.5 h-3.5 text-indigo-600" />
                <span>View PFE Book PDF</span>
              </a>
            )}
            <button
              onClick={() => onClose(selectedRefs)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-20 text-center">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-2" />
              <p className="text-sm text-slate-600 font-medium">
                Loading extraction and candidate matches...
              </p>
            </div>
          ) : !(data?.extracted || data?.extraction) ? (
            <div className="space-y-6">
              {/* Extract CTA Banner */}
              <div className="text-center border border-indigo-200 bg-gradient-to-b from-indigo-50/60 to-white rounded-xl p-6 shadow-xs">
                <Sparkles className="w-9 h-9 text-indigo-600 mx-auto mb-2.5" />
                <h3 className="text-base font-bold text-slate-900 mb-1">
                  Extract Authoritative Subjects & Rules from PDF
                </h3>
                <p className="text-xs text-slate-600 max-w-lg mx-auto mb-4">
                  The PFE Book PDF is the authoritative ground truth. Run extraction to analyze all internship sheets,
                  confirm application guidelines, and score subjects against your profile.
                </p>
                <button
                  onClick={() => handleExtract(false)}
                  disabled={extracting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors cursor-pointer"
                >
                  {extracting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Extracting &amp; scoring...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Extract & Match Profile from PDF</span>
                    </>
                  )}
                </button>
              </div>

              {/* Provisional Website HTML Preview */}
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-amber-600" />
                      Website HTML Preview (Provisional)
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Scraped from post description. PDF ground truth overrides all fields once extracted.
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                    Pre-Extraction
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {listing.location && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-slate-500">Location:</span>{' '}
                      <strong className="text-slate-800">{listing.location}</strong>
                    </div>
                  )}

                  {listing.apply_method && (
                    <div className="flex items-center gap-1.5">
                      {listing.apply_method === 'form' ? (
                        <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      ) : (
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      <span className="text-slate-500">Apply Method:</span>{' '}
                      <strong className="text-slate-800 capitalize">{listing.apply_method}</strong>
                    </div>
                  )}

                  {listing.deadline && (
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-slate-500">Deadline:</span>{' '}
                      <strong className="text-slate-800">{listing.deadline}</strong>
                    </div>
                  )}

                  {listing.html_hints?.email && (
                    <div className="flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-slate-500">Email:</span>{' '}
                      <span className="font-mono text-indigo-600">{listing.html_hints.email}</span>
                    </div>
                  )}

                  {listing.html_hints?.external_url && (
                    <div className="sm:col-span-2 flex items-center gap-1.5">
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-slate-500">Website:</span>{' '}
                      <a
                        href={listing.html_hints.external_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 hover:underline break-all font-mono"
                      >
                        {listing.html_hints.external_url}
                      </a>
                    </div>
                  )}
                </div>

                {/* Preview Subjects List */}
                {listing.html_hints?.subjects_preview && listing.html_hints.subjects_preview.length > 0 && (
                  <div className="pt-2">
                    <h5 className="text-xs font-semibold text-slate-700 mb-2">
                      Reported Subjects ({listing.html_hints.subjects_preview.length}):
                    </h5>
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {listing.html_hints.subjects_preview.map((item, idx) => (
                        <div
                          key={idx}
                          className="bg-white p-2.5 rounded-lg border border-slate-200 text-xs flex items-center justify-between gap-2"
                        >
                          <span className="text-slate-700 font-medium">
                            {item.title}
                          </span>
                          {item.apply_url && (
                            <a
                              href={item.apply_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-600 hover:text-indigo-800 shrink-0 inline-flex items-center gap-1 font-semibold text-[11px]"
                            >
                              <span>Apply Link</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Application Rules Card */}
              {rules && (
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-indigo-600" />
                      Application Instructions (from PDF)
                    </h3>
                    <button
                      onClick={() => handleExtract(true)}
                      disabled={extracting}
                      className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1 font-medium"
                    >
                      <RefreshCw className={`w-3 h-3 ${extracting ? 'animate-spin' : ''}`} />
                      Re-extract
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-500">Method:</span>{' '}
                      <strong className="text-slate-800 capitalize">
                        {rules.method}
                      </strong>
                    </div>

                    {rules.recipient_email && (
                      <div>
                        <span className="text-slate-500">Recipient Email:</span>{' '}
                        <a
                          href={`mailto:${rules.recipient_email}`}
                          className="font-mono text-indigo-600 hover:underline"
                        >
                          {rules.recipient_email}
                        </a>
                      </div>
                    )}

                    {safeHttpUrl(rules.external_url) && (
                      <div className="sm:col-span-2">
                        <span className="text-slate-500">External Form:</span>{' '}
                        <a
                          href={safeHttpUrl(rules.external_url)!}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:underline inline-flex items-center gap-1 break-all"
                        >
                          {rules.external_url} <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}

                    {rules.subject_line_template && (
                      <div className="sm:col-span-2">
                        <span className="text-slate-500">Subject Template:</span>{' '}
                        <code className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-800 font-mono text-[11px]">
                          {rules.subject_line_template}
                        </code>
                      </div>
                    )}

                    <div>
                      <span className="text-slate-500">Max Subjects:</span>{' '}
                      <strong className="text-slate-800">
                        {rules.max_subjects_allowed ? `${rules.max_subjects_allowed} per application` : 'Not specified (UI defaults to 1)'}
                      </strong>
                    </div>

                    <div>
                      <span className="text-slate-500">Cover Letter:</span>{' '}
                      <strong className="text-slate-800">
                        {rules.cover_letter_requested ? 'Required / Requested' : 'Optional'}
                      </strong>
                    </div>

                    {(rules.required_documents?.length ?? 0) > 0 && (
                      <div className="sm:col-span-2 flex items-center gap-1.5 flex-wrap">
                        <span className="text-slate-500">Required Docs:</span>
                        {rules.required_documents.map((doc) => (
                          <span
                            key={doc}
                            className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-full text-[11px] font-medium uppercase"
                          >
                            {doc}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {data.extraction?.conflicts_with_description &&
                    data.extraction.conflicts_with_description.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] space-y-1">
                        <div className="font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                          PDF vs Website Discrepancies (PDF used as ground truth):
                        </div>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {data.extraction.conflicts_with_description.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                </div>
              )}

              {/* Subjects Section */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Internship Subjects ({sortedSubjects.length})
                    </h3>
                    <p className="text-xs text-slate-500">
                      Scored by CV Fit & Topic Richness against your Career Goals.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-medium">
                      {(['overall', 'fit', 'interest'] as const).map((modeKey) => (
                        <button
                          key={modeKey}
                          type="button"
                          onClick={() => setSortBy(modeKey)}
                          className={`px-2 py-1 rounded-md transition-colors cursor-pointer ${
                            sortBy === modeKey
                              ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {modeKey === 'overall' ? 'Best Overall' : modeKey === 'fit' ? 'CV Fit' : 'Richness'}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={handleRematch}
                      disabled={rematching}
                      title="Re-score topics against your current CV & Career Goals (~2s, skips PDF re-extraction)"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${rematching ? 'animate-spin' : ''}`} />
                      <span>{rematching ? 'Scoring...' : 'Re-Score'}</span>
                    </button>

                    {sortedSubjects.length >= 2 && (
                      <button
                        type="button"
                        onClick={handleCompareTop3}
                        disabled={comparing}
                        title="Compare top 3 ranked topics head-to-head"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-violet-50 border border-violet-200 text-violet-800 hover:bg-violet-100 disabled:opacity-50 cursor-pointer"
                      >
                        <Scale className="w-3 h-3" />
                        <span>{comparing ? 'Comparing...' : `Compare Top ${Math.min(3, sortedSubjects.length)}`}</span>
                      </button>
                    )}

                    {maxAllowed && (
                      <span
                        className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                          isOverLimit
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                        }`}
                      >
                        Selected: {selectedRefs.length} / {maxAllowed} allowed
                      </span>
                    )}
                  </div>
                </div>

                {comparison && (
                  <div
                    ref={comparisonRef}
                    className="mb-4 rounded-xl border border-violet-200 bg-violet-50/60 p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-violet-900 uppercase tracking-wider">
                          <Scale className="w-3.5 h-3.5 text-violet-600" />
                          Head-to-Head Topic Advisor
                          {comparison.cached && (
                            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-medium normal-case rounded bg-violet-100 text-violet-700 border border-violet-200">
                              Saved
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                          {comparison.overall_verdict}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={comparing}
                          onClick={() => {
                            const refs =
                              compareRefs.length >= 2
                                ? compareRefs
                                : comparison.subject_refs || []
                            if (refs.length >= 2) void runCompare(refs, true)
                          }}
                          title="Re-run AI comparison"
                          className="text-violet-500 hover:text-violet-700 p-1 cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${comparing ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setComparison(null)}
                          className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {comparison.comparisons.map((item) => {
                        const subj = sortedSubjects.find((s) => s.ref === item.subject_ref)
                        return (
                          <div
                            key={item.subject_ref}
                            className="bg-white rounded-lg border border-violet-200/80 p-3 text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-bold text-slate-900">
                                #{item.rank} — {isSyntheticRef(item.subject_ref) ? subj?.title || item.subject_ref : `${item.subject_ref}${subj?.title ? `: ${subj.title}` : ''}`}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedRefs([item.subject_ref])
                                }}
                                className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer transition-colors ${
                                  item.rank === 1
                                    ? 'bg-violet-600 text-white hover:bg-violet-700'
                                    : 'bg-violet-50 text-violet-800 border border-violet-300 hover:bg-violet-100'
                                }`}
                              >
                                Pick #{item.rank}
                              </button>
                            </div>
                            <div className="text-slate-700">
                              <strong className="text-slate-800">Richness:</strong> {item.richness_verdict}
                            </div>
                            <div className="text-slate-700">
                              <strong className="text-slate-800">Thesis:</strong> {item.thesis_potential}
                            </div>
                            <div className="text-slate-700">
                              <strong className="text-slate-800">Career Growth:</strong> {item.career_growth}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  {sortedSubjects.map((s) => {
                    const match = matchMap.get(s.ref)
                    const isSelected = selectedRefs.includes(s.ref)
                    const isPinnedCompare = compareRefs.includes(s.ref)

                    return (
                      <div
                        key={s.ref}
                        onClick={() => toggleSubject(s.ref)}
                        className={`rounded-xl border p-4 transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-50/50 border-indigo-500 ring-2 ring-indigo-500/20'
                            : isPinnedCompare
                            ? 'bg-violet-50/30 border-violet-300 hover:border-violet-400'
                            : 'bg-white border-slate-200 hover:border-indigo-300 hover:bg-slate-50/50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => toggleSubject(s.ref)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                            />
                            {isSyntheticRef(s.ref) ? (
                              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                Page {s.page_in_pdf}
                              </span>
                            ) : (
                              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                                {s.ref}
                              </span>
                            )}
                            <h4 className="font-semibold text-slate-900 text-sm">
                              {s.title}
                            </h4>
                            {s.work_mode && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                                {s.work_mode === 'binome' ? (
                                  <>
                                    <Users className="w-3 h-3" />
                                    <span>Binôme</span>
                                  </>
                                ) : s.work_mode === 'solo' ? (
                                  <>
                                    <User className="w-3 h-3" />
                                    <span>Solo</span>
                                  </>
                                ) : (
                                  <span>Solo / Binôme</span>
                                )}
                              </span>
                            )}
                            {s.location && (
                              <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-500">
                                <MapPin className="w-3 h-3 text-slate-400" />
                                {s.location}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {sortedSubjects.length >= 2 && (
                              <button
                                type="button"
                                onClick={(e) => toggleCompareRef(s.ref, e)}
                                title={isPinnedCompare ? 'Remove from comparison' : 'Pin to compare'}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors cursor-pointer ${
                                  isPinnedCompare
                                    ? 'bg-violet-600 text-white border-violet-600'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50'
                                }`}
                              >
                                <Scale className="w-3 h-3" />
                                <span>{isPinnedCompare ? 'Pinned' : 'Compare'}</span>
                              </button>
                            )}
                            {safeHttpUrl(s.apply_url) && (
                              <a
                                href={safeHttpUrl(s.apply_url)!}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                              >
                                <span>Apply Link</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            {match && (
                              <div className="flex items-center gap-1.5">
                                <div
                                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${
                                    match.score >= 75
                                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                      : match.score >= 50
                                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                      : 'bg-slate-100 text-slate-700 border border-slate-300'
                                  }`}
                                >
                                  <Sparkles className="w-3 h-3" />
                                  <span>{match.score}% fit</span>
                                </div>
                                {typeof match.interest_score === 'number' && match.interest_score > 0 && (
                                  <div
                                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${
                                      match.interest_score >= 70
                                        ? 'bg-violet-100 text-violet-800 border border-violet-300'
                                        : match.interest_score >= 40
                                        ? 'bg-sky-100 text-sky-800 border border-sky-300'
                                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                                    }`}
                                    title="Topic technical richness & career goal alignment"
                                  >
                                    <Flame className="w-3 h-3" />
                                    <span>{match.interest_score}% rich</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <p className="text-xs text-slate-600 line-clamp-2 mb-3">
                          {s.summary}
                        </p>

                        {/* Match Analysis */}
                        {match && (
                          <div className="bg-white/80 rounded-lg p-2.5 border border-slate-200/80 mb-3 space-y-1.5 text-xs">
                            <div className="text-slate-700 italic">
                              "{match.why_match}"
                            </div>
                            {match.why_interesting && (
                              <div className="text-violet-900 bg-violet-50/70 border border-violet-100 rounded px-2 py-1 text-[11px]">
                                <strong className="font-semibold">Richness & Goals:</strong> {match.why_interesting}
                              </div>
                            )}
                            {match.score_breakdown && (
                              <div className="flex flex-wrap gap-2 text-[10px] text-slate-600 font-mono">
                                {match.score_breakdown.fit && (
                                  <span className="bg-slate-100 px-1.5 py-0.5 rounded">
                                    Fit: D {match.score_breakdown.fit.domain}/45 · S {match.score_breakdown.fit.stack}/30 · A {match.score_breakdown.fit.academic}/15 · Del {match.score_breakdown.fit.deliverable}/10
                                  </span>
                                )}
                                {match.score_breakdown.richness && (
                                  <span className="bg-violet-50 text-violet-800 px-1.5 py-0.5 rounded">
                                    Rich: C {match.score_breakdown.richness.career}/40 · T {match.score_breakdown.richness.thesis}/35 · M {match.score_breakdown.richness.market}/25
                                  </span>
                                )}
                              </div>
                            )}
                            {match.matched_skills && match.matched_skills.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[11px] font-semibold text-emerald-700">
                                  Matched:
                                </span>
                                {match.matched_skills.map((skill) => (
                                  <span
                                    key={skill}
                                    className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 rounded text-[11px]"
                                  >
                                    {skill}
                                  </span>
                                ))}
                              </div>
                            )}
                            {match.missing_gaps && match.missing_gaps.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[11px] font-semibold text-rose-700">
                                  Gaps:
                                </span>
                                {match.missing_gaps.map((gap) => (
                                  <span
                                    key={gap}
                                    className="bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.2 rounded text-[11px]"
                                  >
                                    {gap}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Technologies Tags */}
                        {s.technologies && s.technologies.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                            {s.technologies.map((tech) => (
                              <span
                                key={tech}
                                className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded"
                              >
                                {tech}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Action Bar */}
        <div className="px-6 py-4 border-t border-slate-200 bg-white rounded-b-2xl flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-slate-600">
            {selectedRefs.length > 0 ? (
              <>
                <span>
                  Selected <strong>{selectedRefs.length}</strong> subject
                  {selectedRefs.length > 1 ? 's' : ''} (
                  {selectedRefs
                    .map((r) => {
                      if (isSyntheticRef(r)) {
                        const item = sortedSubjects.find((s) => s.ref === r)
                        return item?.title
                          ? item.title.length > 28
                            ? item.title.slice(0, 26) + '...'
                            : item.title
                          : r
                      }
                      return r
                    })
                    .join(', ')}
                  )
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedRefs([])}
                  className="px-2 py-0.5 rounded text-[11px] font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 transition-colors cursor-pointer"
                >
                  Clear Selection
                </button>
              </>
            ) : (
              <span className="text-slate-400">No subject selected</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {compareRefs.length >= 2 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void runCompare(compareRefs)}
                  disabled={comparing}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <Scale className="w-3.5 h-3.5" />
                  <span>{comparing ? 'Comparing...' : `Compare (${compareRefs.length})`}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCompareRefs([])}
                  title="Clear comparison pins"
                  className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <button
              onClick={() => onDraftWithSubjects(listing, selectedRefs)}
              disabled={selectedRefs.length === 0}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg shadow-xs transition-colors ${
                selectedRefs.length === 0
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-98 cursor-pointer'
              }`}
            >
              <span>{mode === 'workspace' ? 'Apply Selection' : 'Open Application Workspace'}</span>
              {mode === 'workspace' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
