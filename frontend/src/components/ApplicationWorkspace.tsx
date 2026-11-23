import React, { useState, useEffect } from 'react'
import {
  ArrowLeft,
  Building2,
  Mail,
  FileText,
  Sparkles,
  Send,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Download,
  RotateCcw,
  Copy,
  Check,
  Eye,
  FileDown,
  X,
} from 'lucide-react'
import {
  fetchApplicationByListing,
  fetchListingExtraction,
  draftApplication,
  regenerateApplication,
  generateCVDiff,
  prepareSend,
  updateApplicationStatus,
  fetchUserDocuments,
  saveApplicationEdits,
  deleteApplication,
  getApplicationZipUrl,
  getApplicationFileUrl,
} from '../api'
import { StagedCVDiffModal } from './StagedCVDiffModal'
import { ListingDetailDrawer } from './ListingDetailDrawer'
import {
  isSyntheticRef,
  type ListingSummary,
  type ApplicationRecord,
  type StagedCVDiff,
  type UserDocumentItem,
  type PreparePackageResponse,
} from '../types'

interface ApplicationWorkspaceProps {
  listing: ListingSummary
  initialSubjectRefs: string[]
  candidateName?: string
  candidateEmail?: string
  activeProfileId?: string
  availableLanguages?: string[]
  baselineUrlPrefix?: string
  onBack: () => void
  onStatusChanged: () => void
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

export const ApplicationWorkspace: React.FC<ApplicationWorkspaceProps> = ({
  listing,
  initialSubjectRefs,
  candidateName,
  candidateEmail,
  activeProfileId = 'local-default',
  availableLanguages = [],
  baselineUrlPrefix,
  onBack,
  onStatusChanged,
}) => {
  const [app, setApp] = useState<ApplicationRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [drafting, setDrafting] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [savingEdits, setSavingEdits] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  // Draft inputs
  const [language, setLanguage] = useState<'fr' | 'en'>('fr')
  const [deliveryMode, setDeliveryMode] = useState<
    'combined_email' | 'split_emails' | 'external_form'
  >('combined_email')
  const [includeCoverLetter, setIncludeCoverLetter] = useState(false)
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(initialSubjectRefs)
  const [activeTab, setActiveTab] = useState<'email' | 'letter' | 'attachments'>('email')

  // Email form fields
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [coverLetterText, setCoverLetterText] = useState('')
  const [regenInstruction, setRegenInstruction] = useState('')

  const resolvedCandidateName = (candidateName || '').trim() || 'Candidate'
  const safeCandidateSlug = resolvedCandidateName.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'Candidate'

  const senderStorageKey = `pfe_sender_email_${activeProfileId}`
  const diffStorageKey = `pfe_diff_cache_${activeProfileId}_${listing.id}`

  // Sender Google Account (authuser)
  const [senderEmail, setSenderEmail] = useState<string>(() => {
    return localStorage.getItem(senderStorageKey) || candidateEmail || ''
  })

  useEffect(() => {
    if (!senderEmail && candidateEmail) {
      setSenderEmail(candidateEmail)
    }
  }, [candidateEmail])

  // CV Diff Modal state
  const [showDiffModal, setShowDiffModal] = useState(false)
  const [stagedDiff, setStagedDiff] = useState<StagedCVDiff | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [showTopicsModal, setShowTopicsModal] = useState(false)
  const [showTailoredPreviewModal, setShowTailoredPreviewModal] = useState(false)
  const [appRules, setAppRules] = useState<any>(null)
  const [subjectTitleMap, setSubjectTitleMap] = useState<Record<string, string>>({})

  // Builds email subject from company template or fallback
  const buildSubjectLine = (
    refs: string[],
    lang: 'fr' | 'en',
    customRules?: any,
    customTitles?: Record<string, string>
  ) => {
    const rulesToUse = customRules !== undefined ? customRules : appRules
    const titles = customTitles || subjectTitleMap
    const tmpl = rulesToUse?.subject_line_template
    const nameParts = resolvedCandidateName.split(/\s+/).filter(Boolean)
    const firstName = nameParts[0] || resolvedCandidateName
    const lastName = nameParts.slice(1).join(' ') || ''

    if (tmpl) {
      const refTokens = refs.map((r) => (isSyntheticRef(r) ? titles[r] || 'PFE 2027' : r || 'PFE 2027'))
      const topicStr = refTokens.length > 0 ? refTokens.join(', ') : 'PFE 2027'
      const titleStr = refs
        .map((r) => titles[r])
        .filter(Boolean)
        .join(', ')
      let res = tmpl
        .replace(/{REF}/g, topicStr)
        .replace(/{ref}/g, topicStr)
        .replace(/{SUJET}/g, topicStr)
        .replace(/{NOM}/g, lastName)
        .replace(/{PRENOM}/g, firstName)
        .replace(/{nom}/g, lastName)
        .replace(/{prenom}/g, firstName)
        .replace(/{CANDIDATE_NAME}/g, resolvedCandidateName)
        .replace(/{candidate_name}/g, resolvedCandidateName)
      if (titleStr && (res.includes('{TITLE}') || res.includes('{title}'))) {
        res = res.replace(/{TITLE}/g, titleStr).replace(/{title}/g, titleStr)
      }
      return res
    }

    const prefix = lang === 'en' ? 'PFE Internship Application 2027' : 'Candidature PFE 2027'
    const labels = refs.map((r) => {
      const t = titles[r]
      if (isSyntheticRef(r)) {
        return t || 'PFE 2027'
      }
      if (/^\d+$/.test(r.trim()) && t) {
        return lang === 'en' ? `Subject ${r}: ${t}` : `Sujet ${r} : ${t}`
      }
      if (t && r && !t.toLowerCase().includes(r.toLowerCase())) {
        return `${r} - ${t}`
      }
      return r || t || 'PFE 2027'
    })

    const sep = labels.length > 1 && labels.some((l) => l.includes(' ')) ? ' | ' : ', '
    const multiTopicStr = labels.length > 0 ? labels.join(sep) : 'PFE 2027'
    return `${prefix} – ${resolvedCandidateName} – ${multiTopicStr}`
  }

  // Topic-aware CV diff cache: persists suggestions per topic & language combination
  const getDiffCacheKey = (lang: string, subjects: string[]) => {
    const sorted = [...subjects].map((s) => s.trim().toUpperCase()).sort().join(',')
    return `${lang.toLowerCase()}:${sorted}`
  }

  const [diffCache, setDiffCache] = useState<Record<string, StagedCVDiff>>(() => {
    try {
      const raw = localStorage.getItem(diffStorageKey)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })

  const updateDiffCache = (key: string, diff: StagedCVDiff) => {
    setDiffCache((prev) => {
      const next = { ...prev, [key]: diff }
      try {
        localStorage.setItem(diffStorageKey, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  // User documents
  const [userDocs, setUserDocs] = useState<UserDocumentItem[]>([])
  const [prepareResult, setPrepareResult] = useState<PreparePackageResponse['package'] | null>(
    null
  )

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3000)
  }

  // Save sender email preference
  const handleSenderEmailChange = (val: string) => {
    setSenderEmail(val)
    localStorage.setItem(senderStorageKey, val.trim())
  }

  // Load existing application or user documents
  useEffect(() => {
    setLoading(true)
    setError(null)

    Promise.all([
      fetchApplicationByListing(listing.id),
      fetchUserDocuments().catch(() => []),
      fetchListingExtraction(listing.id).catch(() => null),
    ])
      .then(([existingApp, docs, extractionRes]) => {
        setUserDocs(docs)
        const extractionRules = extractionRes?.extraction?.application_rules
        setAppRules(extractionRules || null)
        const fallbackRecipient = extractionRules?.recipient_email || ''

        const titlesMap: Record<string, string> = {}
        extractionRes?.extraction?.subjects?.forEach((s) => {
          if (s.ref && s.title) titlesMap[s.ref] = s.title
        })
        setSubjectTitleMap(titlesMap)

        // Find highest match % topic by score
        let bestMatchRef: string | null = null
        if (extractionRes?.matches && extractionRes.matches.length > 0) {
          const sorted = [...extractionRes.matches].sort((a, b) => b.score - a.score)
          bestMatchRef = sorted[0].subject_ref
        } else if (extractionRes?.extraction?.subjects && extractionRes.extraction.subjects.length > 0) {
          bestMatchRef = extractionRes.extraction.subjects[0].ref
        }

        if (existingApp) {
          setApp(existingApp)

          const bookLang =
            extractionRes?.extraction?.primary_language &&
            (extractionRes.extraction.primary_language === 'en' ||
              extractionRes.extraction.primary_language === 'fr')
              ? extractionRes.extraction.primary_language
              : null

          const effectiveLang =
            !existingApp.email_body && bookLang ? bookLang : existingApp.language
          setLanguage(effectiveLang)
          setDeliveryMode(existingApp.delivery_mode)
          setIncludeCoverLetter(existingApp.include_cover_letter)
          setEmailTo(existingApp.email_to || fallbackRecipient)
          setCoverLetterText(existingApp.cover_letter_text || '')

          const validInitialRefs = initialSubjectRefs.filter((r) => r in titlesMap)
          const activeRefs =
            validInitialRefs.length > 0
              ? validInitialRefs
              : (existingApp.selected_subject_refs?.length
                ? existingApp.selected_subject_refs
                : (bestMatchRef ? [bestMatchRef] : []))

          setSelectedSubjects(activeRefs)

          const initialKey = getDiffCacheKey(effectiveLang, activeRefs)
          if (existingApp.cv_staged_diff) {
            setStagedDiff(existingApp.cv_staged_diff)
            updateDiffCache(initialKey, existingApp.cv_staged_diff)
          } else if (diffCache[initialKey]) {
            setStagedDiff(diffCache[initialKey])
          }

          if (existingApp.email_subject && !existingApp.email_subject.toUpperCase().includes('SUBJ-')) {
            setEmailSubject(existingApp.email_subject)
          } else {
            const defaultSub = buildSubjectLine(activeRefs, effectiveLang, extractionRules, titlesMap)
            setEmailSubject(defaultSub)
          }

          setEmailBody(existingApp.email_body || '')
        } else {
          setEmailTo(fallbackRecipient)
          const validInitialRefs = initialSubjectRefs.filter((r) => r in titlesMap)
          const activeRefs =
            validInitialRefs.length > 0
              ? validInitialRefs
              : (bestMatchRef ? [bestMatchRef] : [])
          setSelectedSubjects(activeRefs)
          const defaultSub = buildSubjectLine(activeRefs, language, extractionRules, titlesMap)
          setEmailSubject(defaultSub)
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [listing.id, initialSubjectRefs])

  // Save manual edits to SQLite
  const handleSaveEdits = async (silent = false) => {
    if (!app) return
    try {
      if (!silent) setSavingEdits(true)
      const res = await saveApplicationEdits(app.id, {
        email_to: emailTo,
        email_subject: emailSubject,
        email_body: emailBody,
        cover_letter_text: coverLetterText,
        include_cover_letter: includeCoverLetter,
        language,
        delivery_mode: deliveryMode,
        selected_subject_refs: selectedSubjects,
      })
      setApp({ ...app, status: res.application_status as any })
      if (!silent) {
        setSuccessMsg('Changes saved!')
        setTimeout(() => setSuccessMsg(null), 2500)
      }
    } catch (err: any) {
      if (!silent) setError(err.message || 'Failed to save changes')
    } finally {
      if (!silent) setSavingEdits(false)
    }
  }

  // Reset application and remove from tracker
  const handleResetApplication = async () => {
    if (!app) return
    if (!window.confirm(`Reset application for ${listing.company_name} and remove from tracker?`)) {
      return
    }

    try {
      await deleteApplication(app.id)
      try {
        localStorage.removeItem(`pfe_diff_cache_${listing.id}`)
      } catch {}
      setDiffCache({})
      setStagedDiff(null)
      onStatusChanged()
      onBack()
    } catch (err: any) {
      setError(err.message || 'Failed to reset application')
    }
  }

  const handleCreateDraft = async (overrideSubjects?: string[]) => {
    try {
      setDrafting(true)
      setError(null)
      const res = await draftApplication({
        listing_id: listing.id,
        selected_subject_refs: overrideSubjects || selectedSubjects,
        language,
        delivery_mode: deliveryMode,
        include_cover_letter: includeCoverLetter,
      })
      setApp(res)
      setEmailTo(res.email_to || '')
      setEmailSubject(res.email_subject || '')
      setEmailBody(res.email_body || '')
      setCoverLetterText(res.cover_letter_text || '')
      setSuccessMsg('Draft generated with AI!')
      setTimeout(() => setSuccessMsg(null), 3000)
      onStatusChanged()
    } catch (err: any) {
      setError(err.message || 'Failed to create draft')
    } finally {
      setDrafting(false)
    }
  }

  const handleRegenerate = async (
    target: 'email' | 'cover_letter' | 'all',
    overrides?: { include_cover_letter?: boolean; language?: 'fr' | 'en'; delivery_mode?: 'combined_email' | 'split_emails' | 'external_form' }
  ) => {
    if (!app) return
    try {
      setRegenerating(true)
      setError(null)
      await saveApplicationEdits(app.id, {
        selected_subject_refs: selectedSubjects,
        language: overrides?.language ?? language,
        delivery_mode: overrides?.delivery_mode ?? deliveryMode,
        include_cover_letter: overrides?.include_cover_letter ?? includeCoverLetter,
      })
      const res = await regenerateApplication(app.id, {
        user_instruction: regenInstruction || undefined,
        target,
      })
      if (res.email_subject) setEmailSubject(res.email_subject)
      if (res.email_body) setEmailBody(res.email_body)
      if (res.cover_letter_text) setCoverLetterText(res.cover_letter_text)
      setSuccessMsg('Regenerated successfully!')
      setTimeout(() => setSuccessMsg(null), 3000)
    } catch (err: any) {
      setError(err.message || 'Regeneration failed')
    } finally {
      setRegenerating(false)
    }
  }

  // Open CV Tailoring with cached diff or generate on demand
  const handleOpenCVTailor = async () => {
    if (!app) return

    const cacheKey = getDiffCacheKey(language, selectedSubjects)
    const cached = diffCache[cacheKey]

    // If cached diff exists for current language & topics, open immediately without LLM call
    if (cached) {
      setStagedDiff(cached)
      setShowDiffModal(true)
      return
    }

    // Fallback: check stagedDiff if matching current language
    if (stagedDiff && stagedDiff.language === language) {
      updateDiffCache(cacheKey, stagedDiff)
      setShowDiffModal(true)
      return
    }

    try {
      setLoadingDiff(true)
      setError(null)
      // Save current selected topics and compatible CV language first
      const cvLang =
        availableLanguages.length > 0 && !availableLanguages.includes(language)
          ? (availableLanguages[0] as 'fr' | 'en')
          : language
      await saveApplicationEdits(app.id, {
        selected_subject_refs: selectedSubjects,
        language: cvLang,
      })
      const res = await generateCVDiff(app.id)
      setStagedDiff(res.diff)
      updateDiffCache(cacheKey, res.diff)
      setShowDiffModal(true)
    } catch (err: any) {
      setError(err.message || 'Failed to generate CV diff')
    } finally {
      setLoadingDiff(false)
    }
  }

  // Compile package (if needed) and trigger browser .zip download
  const handleDownloadZip = async () => {
    if (!app) return
    try {
      setPreparing(true)
      setError(null)
      await handleSaveEdits(true)
      const res = await prepareSend(app.id, senderEmail)
      setPrepareResult(res.package)
      window.location.href = getApplicationZipUrl(app.id)
      showToast('Downloading application package (.zip)...')
    } catch (err: any) {
      setError(err.message || 'Failed to download package')
    } finally {
      setPreparing(false)
    }
  }

  // Copy helpers
  const handleCopyEmail = () => {
    const text = `To: ${emailTo}\nSubject: ${emailSubject}\n\n${emailBody}`
    navigator.clipboard.writeText(text)
    showToast('Copied To, Subject, and Body to clipboard!')
  }

  const handleCopyField = (label: string, value: string) => {
    navigator.clipboard.writeText(value)
    showToast(`Copied ${label} to clipboard!`)
  }

  const mailtoUrl = `mailto:${encodeURIComponent(emailTo || '')}?subject=${encodeURIComponent(emailSubject || '')}&body=${encodeURIComponent(emailBody || '')}`

  // Prepare package and launch Gmail
  const handlePrepareSend = async () => {
    if (!app) return
    try {
      setPreparing(true)
      setError(null)

      // Ensure manual edits are saved before compilation
      await handleSaveEdits(true)

      const res = await prepareSend(app.id, senderEmail)
      setPrepareResult(res.package)

      // Open Gmail compose URL if available
      if (res.package.gmail_compose_urls && res.package.gmail_compose_urls.length > 0) {
        window.open(res.package.gmail_compose_urls[0], '_blank')
      }

      await updateApplicationStatus(app.id, 'opened_gmail')
      setApp({ ...app, status: 'opened_gmail' })
      onStatusChanged()

      setSuccessMsg(
        'Package compiled! Download the ZIP or PDFs below and attach them in Gmail.'
      )
    } catch (err: any) {
      setError(err.message || 'Failed to prepare package')
    } finally {
      setPreparing(false)
    }
  }

  const handleStatusChange = async (newStatus: ApplicationRecord['status']) => {
    if (!app) return
    try {
      await updateApplicationStatus(app.id, newStatus)
      setApp({ ...app, status: newStatus })
      onStatusChanged()
    } catch (err: any) {
      setError(err.message || 'Failed to update status')
    }
  }

  const handleRemoveTopic = (refToRemove: string) => {
    const updated = selectedSubjects.filter((r) => r !== refToRemove)
    setSelectedSubjects(updated)
    const nextKey = getDiffCacheKey(language, updated)
    if (diffCache[nextKey]) {
      setStagedDiff(diffCache[nextKey])
    } else {
      setStagedDiff(null)
    }
    const newSub = buildSubjectLine(updated, language)
    setEmailSubject(newSub)
    if (app) {
      saveApplicationEdits(app.id, {
        selected_subject_refs: updated,
        email_subject: newSub,
      }).catch(() => {})
    }
  }

  const pdfViewUrl = listing.pdf_storage_key ? `/data/${listing.pdf_storage_key}` : null

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-in fade-in duration-200">
      {/* Top Navigation & Company Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-slate-900">
                  {listing.company_name}
                </h1>
                {app ? (
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase ${
                      app.status === 'sent'
                        ? 'bg-emerald-100 text-emerald-800'
                        : app.status === 'opened_gmail'
                        ? 'bg-sky-100 text-sky-800'
                        : app.status === 'drafted'
                        ? 'bg-indigo-100 text-indigo-800'
                        : 'bg-slate-100 text-slate-600 border border-slate-300'
                    }`}
                  >
                    {app.status === 'new' ? 'Untracked (Preview)' : app.status}
                  </span>
                ) : (loading || drafting) ? (
                  <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-indigo-50 text-indigo-600 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Loading...
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                <span className="font-mono">{listing.slug}</span>
                {pdfViewUrl && (
                  <>
                    <span>•</span>
                    <a
                      href={pdfViewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-600 hover:underline flex items-center gap-1 font-semibold"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span>View PFE Book PDF</span>
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quick Action Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Tailor CV Button & Preview Button */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleOpenCVTailor}
                disabled={loadingDiff}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer active:scale-98 ${
                  app?.cv_diff_confirmed
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                    : 'bg-violet-50 text-violet-800 border-violet-300 hover:bg-violet-100'
                }`}
              >
                {loadingDiff ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-violet-600" />
                    <span>Analyzing Profile...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                    <span>
                      {app?.cv_diff_confirmed ? 'CV Tailored (Locked)' : 'Customize CV'}
                    </span>
                  </>
                )}
              </button>

              {app?.cv_diff_confirmed && (
                <button
                  type="button"
                  onClick={() => setShowTailoredPreviewModal(true)}
                  className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors cursor-pointer"
                  title="View verified 1-page PDF preview"
                >
                  <Eye className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Preview CV</span>
                </button>
              )}
            </div>

            {/* Reset / Remove from Tracker Button */}
            {app && app.status !== 'new' && (
              <button
                onClick={handleResetApplication}
                title="Reset this application and remove it from the tracker"
                className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Notifications */}
      {toastMsg && (
        <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs flex items-center gap-2 animate-in fade-in">
          <Check className="w-4 h-4 text-indigo-600 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Workspace Body Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Email & Cover Letter Editors (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Tabs & Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-2 sm:pb-0 gap-2">
            <div className="flex items-center gap-2 overflow-x-auto">
              <button
                onClick={() => setActiveTab('email')}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-all cursor-pointer shrink-0 ${
                  activeTab === 'email'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Mail className="w-4 h-4" />
                <span>Email Application</span>
              </button>

              {includeCoverLetter && (
                <button
                  onClick={() => setActiveTab('letter')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-all cursor-pointer shrink-0 ${
                    activeTab === 'letter'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  <span>Cover Letter</span>
                </button>
              )}

              <button
                onClick={() => setActiveTab('attachments')}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-all cursor-pointer shrink-0 ${
                  activeTab === 'attachments'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>Attachments</span>
              </button>
            </div>

            {/* Drafting Settings & Save Button */}
            <div className="flex items-center gap-2 flex-wrap pb-1 sm:pb-0">
              {/* Language Switcher */}
              <div className="flex items-center rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-[11px] font-semibold">
                <button
                  onClick={() => {
                    setLanguage('fr')
                    const nextKey = getDiffCacheKey('fr', selectedSubjects)
                    if (diffCache[nextKey]) setStagedDiff(diffCache[nextKey])
                    else setStagedDiff(null)
                    if (emailSubject.includes('PFE Internship Application')) {
                      setEmailSubject(emailSubject.replace('PFE Internship Application', 'Candidature PFE'))
                    }
                  }}
                  className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                    language === 'fr'
                      ? 'bg-white text-indigo-600 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  FR
                </button>
                <button
                  onClick={() => {
                    setLanguage('en')
                    const nextKey = getDiffCacheKey('en', selectedSubjects)
                    if (diffCache[nextKey]) setStagedDiff(diffCache[nextKey])
                    else setStagedDiff(null)
                    if (emailSubject.includes('Candidature PFE')) {
                      setEmailSubject(emailSubject.replace('Candidature PFE', 'PFE Internship Application'))
                    }
                  }}
                  className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                    language === 'en'
                      ? 'bg-white text-indigo-600 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  EN
                </button>
              </div>

              {/* Delivery Mode Toggle */}
              <select
                value={deliveryMode}
                onChange={(e: any) => setDeliveryMode(e.target.value)}
                className="text-[11px] font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-slate-700 cursor-pointer"
              >
                <option value="combined_email">Combined Email</option>
                <option value="split_emails">Separate Emails</option>
                <option value="external_form">External Form</option>
              </select>

              {/* Cover letter toggle */}
              <label className="flex items-center gap-1 text-[11px] font-medium text-slate-700 cursor-pointer bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg">
                <input
                  type="checkbox"
                  checked={includeCoverLetter}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setIncludeCoverLetter(checked)
                    if (checked && !coverLetterText) {
                      handleRegenerate('cover_letter', { include_cover_letter: true })
                    }
                  }}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3 h-3 cursor-pointer"
                />
                <span>Letter</span>
              </label>

              {/* Save Edits Button */}
              <button
                onClick={() => handleSaveEdits(false)}
                disabled={savingEdits || !app}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg text-indigo-600 hover:bg-indigo-50 border border-indigo-200 transition-colors flex items-center gap-1 cursor-pointer active:scale-95"
              >
                {savingEdits ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Check className="w-3 h-3" />
                )}
                <span>{savingEdits ? 'Saving...' : 'Save Draft'}</span>
              </button>
            </div>
          </div>

          {/* Email Tab Content */}
          {activeTab === 'email' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700">
                      To (Recipient):
                    </label>
                    <button
                      type="button"
                      onClick={() => handleCopyField('Recipient email', emailTo)}
                      className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={emailTo}
                    onBlur={() => handleSaveEdits(true)}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="recrutement@company.com"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono text-xs focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700">
                      Subject Line:
                    </label>
                    <button
                      type="button"
                      onClick={() => handleCopyField('Subject', emailSubject)}
                      className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={emailSubject}
                    onBlur={() => handleSaveEdits(true)}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 text-xs font-medium focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700 text-xs">
                    Email Body ({language.toUpperCase()}):
                  </label>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy All</span>
                  </button>
                </div>
                <textarea
                  value={emailBody}
                  onBlur={() => handleSaveEdits(true)}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={12}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-slate-900 text-xs font-sans leading-relaxed focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Regeneration prompt */}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                <input
                  type="text"
                  placeholder="Ask AI to refine (e.g. 'Make it more concise', 'Highlight RAG project')..."
                  value={regenInstruction}
                  onChange={(e) => setRegenInstruction(e.target.value)}
                  className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  onClick={() => handleRegenerate('email')}
                  disabled={regenerating}
                  className="px-3 py-2 text-xs font-semibold rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`}
                  />
                  <span>Regenerate</span>
                </button>
              </div>
            </div>
          )}

          {/* Cover Letter Tab Content */}
          {activeTab === 'letter' && includeCoverLetter && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Cover Letter Text
                  </h3>
                  <p className="text-xs text-slate-500">
                    Rendered via Typst letter template into a verified 1-page PDF.
                  </p>
                </div>
              </div>

              <textarea
                value={coverLetterText}
                onBlur={() => handleSaveEdits(true)}
                onChange={(e) => setCoverLetterText(e.target.value)}
                rows={14}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-slate-900 text-xs font-sans leading-relaxed focus:ring-1 focus:ring-indigo-500"
              />

              <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                <input
                  type="text"
                  placeholder="Instructions for letter (e.g. 'Mention why I want to join this specific team')..."
                  value={regenInstruction}
                  onChange={(e) => setRegenInstruction(e.target.value)}
                  className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  onClick={() => handleRegenerate('cover_letter')}
                  disabled={regenerating}
                  className="px-3 py-2 text-xs font-semibold rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`}
                  />
                  <span>Regenerate Letter</span>
                </button>
              </div>
            </div>
          )}

          {/* Attachments Tab Content */}
          {activeTab === 'attachments' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xs">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Application Document Package
                </h3>
                <p className="text-xs text-slate-500">
                  These files will be assembled and copied into{' '}
                  <code>data/applications/{listing.slug}_.../</code>.
                </p>
              </div>

              <div className="space-y-2.5">
                {/* CV Item */}
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <div>
                      <strong className="text-slate-800 block">
                        {app?.cv_diff_confirmed
                          ? `Tailored 1-Page CV (${language.toUpperCase()})`
                          : `Baseline 1-Page CV (${language.toUpperCase()})`}
                      </strong>
                      <span className="text-[11px] text-slate-500 font-mono">
                        CV_{safeCandidateSlug}_{language.toUpperCase()}.pdf
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {app?.cv_diff_confirmed && (
                      <button
                        type="button"
                        onClick={() => setShowTailoredPreviewModal(true)}
                        className="text-xs font-semibold text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Preview</span>
                      </button>
                    )}
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
                      1-Page Locked
                    </span>
                  </div>
                </div>

                {/* Cover Letter Item */}
                {includeCoverLetter && (
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <div>
                        <strong className="text-slate-800 block">
                          Cover Letter Typst PDF
                        </strong>
                        <span className="text-[11px] text-slate-500 font-mono">
                          Cover_Letter_{safeCandidateSlug}.pdf
                        </span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-100 text-indigo-800">
                      Typst Rendered
                    </span>
                  </div>
                )}

                {/* Reusable Documents */}
                {userDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-3 rounded-xl border border-slate-200 bg-white flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-slate-400" />
                      <div>
                        <strong className="text-slate-800 block">
                          {doc.label} ({doc.doc_type})
                        </strong>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {doc.original_filename}
                        </span>
                      </div>
                    </div>
                    <span className="text-slate-400 text-[11px]">Ready</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Topics & Package Execution */}
        <div className="space-y-4">
          {/* Targeted Topics Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3.5 shadow-xs">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-indigo-600" />
                <span>Targeted Topics</span>
              </h3>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                {selectedSubjects.length} selected
              </span>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Topics selected here are targeted in your email pitch and tailored CV.
            </p>

            <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 rounded-xl bg-slate-50 border border-slate-200">
              {selectedSubjects.length > 0 ? (
                selectedSubjects.map((ref) => {
                  const title = subjectTitleMap[ref]
                  const isSynth = isSyntheticRef(ref)
                  const displayLabel = isSynth && title
                    ? (title.length > 36 ? title.slice(0, 33) + '...' : title)
                    : ref
                  return (
                    <span
                      key={ref}
                      title={title || ref}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-indigo-800 border border-indigo-200 shadow-2xs group"
                    >
                      <span>{displayLabel}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTopic(ref)}
                        title={`Remove topic ${ref}`}
                        className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  )
                })
              ) : (
                <span className="text-xs text-slate-400 italic">
                  No topics selected yet
                </span>
              )}
            </div>

            <button
              onClick={() => setShowTopicsModal(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-bold text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 shadow-2xs transition-all cursor-pointer active:scale-98"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Change / Select Topics</span>
            </button>

            {/* Confirm & Generate Email Button */}
            <div className="pt-2 border-t border-slate-100">
              <button
                onClick={() => handleCreateDraft()}
                disabled={drafting || selectedSubjects.length === 0}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-bold text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all cursor-pointer active:scale-98 disabled:opacity-50"
              >
                {drafting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Generating Draft...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{emailBody ? 'Re-generate Draft' : 'Confirm & Generate Email'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Prepare & Send Application Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900">
              Prepare & Send Application
            </h3>

            {/* Sender Account Selector (authuser) */}
            <div>
              <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                Sender Google Account (Gmail authuser):
              </label>
              <input
                type="text"
                value={senderEmail}
                onChange={(e) => handleSenderEmailChange(e.target.value)}
                placeholder="your.email@gmail.com"
                className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:ring-1 focus:ring-indigo-500"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Optional: picks the right Google account if signed into multiple
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Compile your 1-page CV PDF, cover letter, and attached documents, then open Gmail compose or download the ZIP.
            </p>

            <button
              onClick={handlePrepareSend}
              disabled={preparing || !app}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg transition-all active:scale-98 cursor-pointer disabled:opacity-50"
            >
              {preparing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Preparing Package...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Prepare Package & Launch Gmail</span>
                </>
              )}
            </button>

            {/* Browser-Native Download & Mail Actions */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={handleDownloadZip}
                disabled={preparing || !app}
                className="flex items-center justify-center gap-1.5 py-2 px-2.5 text-xs font-semibold rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition-colors cursor-pointer disabled:opacity-50"
                title="Compile and download all application PDFs as a .zip file"
              >
                <Download className="w-3.5 h-3.5 text-emerald-700" />
                <span>Download ZIP</span>
              </button>

              <a
                href={mailtoUrl}
                className="flex items-center justify-center gap-1.5 py-2 px-2.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                title="Open in default desktop mail client (Outlook, Apple Mail, Thunderbird)"
              >
                <Mail className="w-3.5 h-3.5 text-slate-600" />
                <span>Mail App</span>
              </a>
            </div>

            <button
              type="button"
              onClick={handleCopyEmail}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-2.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
              title="Copy To, Subject, and Body to clipboard"
            >
              <Copy className="w-3.5 h-3.5 text-slate-600" />
              <span>Copy Full Email</span>
            </button>

            {/* Application Pipeline Status */}
            <div className="pt-3 border-t border-slate-100">
              <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                Application Pipeline Status:
              </label>
              <select
                value={app?.status || 'new'}
                onChange={(e) => handleStatusChange(e.target.value as any)}
                className="w-full text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 cursor-pointer"
              >
                <option value="new">Untracked (Preview)</option>
                <option value="drafted">Drafted</option>
                <option value="opened_gmail">Opened in Gmail</option>
                <option value="sent">Sent (Completed)</option>
                <option value="interview">Interview Scheduled</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          {/* Saved Package Quick Download after reload */}
          {!prepareResult && app && app.output_dir_key && (
            <div className="bg-emerald-50/60 rounded-2xl border border-emerald-200 p-4 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-emerald-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Last Compiled Package</span>
              </div>
              <a
                href={getApplicationZipUrl(app.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px]"
              >
                <Download className="w-3 h-3" />
                <span>Download ZIP</span>
              </a>
            </div>
          )}

          {/* Package Preparation Summary */}
          {prepareResult && app && (
            <div className="bg-emerald-50/70 rounded-2xl border border-emerald-300 p-4 space-y-3 text-xs text-emerald-900 animate-in fade-in">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Package Ready!</span>
                </div>
                <a
                  href={getApplicationZipUrl(app.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shadow-2xs transition-colors"
                >
                  <Download className="w-3 h-3" />
                  <span>Download All (.zip)</span>
                </a>
              </div>

              <div>
                <span className="text-emerald-700 font-semibold block mb-1.5">
                  Attachments (click to download):
                </span>
                <div className="space-y-1.5">
                  {(prepareResult.generated_files || []).map((f, i) => (
                    <a
                      key={i}
                      href={getApplicationFileUrl(app.id, f.filename)}
                      download={f.filename}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50/40 transition-colors text-[11px]"
                    >
                      <span className="font-mono font-semibold text-emerald-950 truncate">
                        {f.filename}
                      </span>
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-bold shrink-0">
                        <Download className="w-3 h-3" />
                        PDF
                      </span>
                    </a>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 border-t border-emerald-200/70 space-y-1.5">
                {prepareResult.gmail_compose_urls && prepareResult.gmail_compose_urls.length > 0 && (
                  <a
                    href={prepareResult.gmail_compose_urls[0]}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-bold text-indigo-700 hover:underline text-xs block"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Launch Prefilled Gmail Compose</span>
                  </a>
                )}

                {prepareResult.gmail_inbox_url && (
                  <a
                    href={prepareResult.gmail_inbox_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-slate-700 hover:underline text-xs block"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                    <span>Open Full Gmail Inbox (#inbox)</span>
                  </a>
                )}

                {safeHttpUrl(prepareResult.external_url) && (
                  <a
                    href={safeHttpUrl(prepareResult.external_url)!}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-bold text-violet-700 hover:underline text-xs block"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open External Application Form</span>
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CV Tailoring Diff Modal */}
      {showDiffModal && app && (
        <StagedCVDiffModal
          applicationId={app.id}
          diff={stagedDiff}
          baselineUrlPrefix={baselineUrlPrefix}
          selectedSubjects={selectedSubjects}
          onClose={() => setShowDiffModal(false)}
          onConfirmed={(confirmedDiff) => {
            setShowDiffModal(false)
            setStagedDiff(confirmedDiff)
            const currentKey = getDiffCacheKey(language, selectedSubjects)
            updateDiffCache(currentKey, confirmedDiff)
            setApp({
              ...app,
              cv_diff_confirmed: true,
              cv_staged_diff: confirmedDiff,
              status: app.status === 'new' ? 'drafted' : app.status,
            })
            setSuccessMsg('Tailored CV locked to 1-page layout!')
            setTimeout(() => setSuccessMsg(null), 3000)
            onStatusChanged()
          }}
        />
      )}

      {/* Topics Selection Modal */}
      {showTopicsModal && (
        <ListingDetailDrawer
          listing={listing}
          initialSelectedRefs={selectedSubjects}
          mode="workspace"
          onClose={(refs) => {
            setShowTopicsModal(false)
            if (refs !== undefined && JSON.stringify(refs) !== JSON.stringify(selectedSubjects)) {
              setSelectedSubjects(refs)
              const nextKey = getDiffCacheKey(language, refs)
              if (diffCache[nextKey]) {
                setStagedDiff(diffCache[nextKey])
              } else {
                setStagedDiff(null)
              }
              const newSub = buildSubjectLine(refs, language)
              setEmailSubject(newSub)
              if (app) {
                saveApplicationEdits(app.id, {
                  selected_subject_refs: refs,
                  email_subject: newSub,
                }).catch(() => {})
              }
            }
          }}
          onDraftWithSubjects={(_listing, refs) => {
            setSelectedSubjects(refs)
            setShowTopicsModal(false)
            const nextKey = getDiffCacheKey(language, refs)
            if (diffCache[nextKey]) {
              setStagedDiff(diffCache[nextKey])
            } else {
              setStagedDiff(null)
            }
            const newSub = buildSubjectLine(refs, language)
            setEmailSubject(newSub)
            if (app) {
              saveApplicationEdits(app.id, {
                selected_subject_refs: refs,
                email_subject: newSub,
              }).catch(() => {})
            }
          }}
        />
      )}

      {/* Tailored CV Preview Modal */}
      {showTailoredPreviewModal && app && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col border border-slate-200 max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 rounded-t-2xl">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Tailored CV Preview ({language.toUpperCase()})
                </h3>
                <p className="text-xs text-slate-500">
                  Verified 1-page PDF compiled for {listing.company_name}
                </p>
              </div>
              <button
                onClick={() => setShowTailoredPreviewModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 flex flex-col items-center justify-start bg-slate-100">
              <img
                src={`/data/applications/previews/app_${app.id}/CV_Preview.png?t=${Date.now()}`}
                alt="Tailored CV Preview"
                className="w-full max-w-2xl rounded-lg shadow-md border border-slate-300"
                onError={(e: any) => {
                  e.target.style.display = 'none'
                }}
              />
              <div className="mt-4 flex items-center gap-3">
                <a
                  href={`/data/applications/previews/app_${app.id}/CV_Preview.pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Download / View PDF</span>
                </a>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-white rounded-b-2xl flex justify-end">
              <button
                onClick={() => setShowTailoredPreviewModal(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
