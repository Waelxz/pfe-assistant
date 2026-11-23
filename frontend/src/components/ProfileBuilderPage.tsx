import React, { useState, useEffect } from 'react'
import {
  FileText,
  Sparkles,
  Upload,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Save,
  Download,
  User,
  Briefcase,
  FolderGit2,
  GraduationCap,
  Wrench,
  Award,
} from 'lucide-react'
import type {
  AppConfig,
  CandidateProfile,
  ProfileMetrics,
  FullProfileResponse,
  ExperienceItem,
  ProjectItem,
  EducationItem,
  SkillCategoryItem,
  CertificationItem,
  ExtracurricularItem,
} from '../types'
import {
  fetchFullProfile,
  updateProfile,
  previewProfileDraft,
  importProfilePdf,
  optimizeProfileAts,
  translateProfile,
  rescoreAllListings,
  loadSampleProfile,
} from '../api'

function createBlankProfile(lang: 'en' | 'fr', seedFrom?: CandidateProfile | null): CandidateProfile {
  return {
    language: lang,
    basics: seedFrom?.basics
      ? { ...seedFrom.basics }
      : {
          name: '',
          email: '',
          phone: '',
          location: '',
          linkedin: '',
          github: '',
          website: '',
          institution: '',
          degree: '',
          availability: 'PFE 2027 (Starting February 2027 / 4-6 months)',
        },
    career_goals: seedFrom?.career_goals
      ? { ...seedFrom.career_goals }
      : {
          target_roles: 'Software Engineer, AI/ML Engineer, Data Engineer',
          tech_to_learn: 'Python, FastAPI, Docker, Cloud, Modern AI/Data Stack',
          dealbreakers: 'Manual data entry, non-technical support',
          pfe_priorities: 'Real engineering depth, measurable thesis outcomes, pre-hiring potential',
        },
    headline: '',
    summary: '',
    work_experience: [],
    projects: [],
    education: [],
    skills: [],
    certifications: [],
    extracurricular: [],
  }
}

interface ProfileBuilderPageProps {
  config?: AppConfig | null
  onRefreshConfig: () => void
}

export const ProfileBuilderPage: React.FC<ProfileBuilderPageProps> = ({
  config,
  onRefreshConfig,
}) => {
  const [activeLang, setActiveLang] = useState<'fr' | 'en'>('fr')
  const [profileData, setProfileData] = useState<FullProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [rescoring, setRescoring] = useState(false)
  const [showSampleConfirm, setShowSampleConfirm] = useState(false)
  const [previewImgErr, setPreviewImgErr] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  // Current working profile in active language
  const [currentProfile, setCurrentProfile] = useState<CandidateProfile | null>(null)
  // Active layout metrics for the preview
  const [activeMetrics, setActiveMetrics] = useState<ProfileMetrics | null>(null)
  const [previewPngUrl, setPreviewPngUrl] = useState<string>('')
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string>('')

  // Accordion section collapse state
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    basics: true,
    headline: true,
    experience: true,
    projects: true,
    education: false,
    skills: false,
    optional: false,
  })

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const [loadingSample, setLoadingSample] = useState(false)

  // Load initial profile data
  const loadProfile = async (targetLang?: 'fr' | 'en') => {
    setLoading(true)
    try {
      const data = await fetchFullProfile()
      setProfileData(data)
      const avail = data.available_languages || []
      const lang =
        targetLang ||
        (avail.includes(activeLang) ? activeLang : (avail[0] as 'fr' | 'en' | undefined)) ||
        activeLang
      setActiveLang(lang)
      const existing = lang === 'fr' ? data.fr : data.en
      const other = lang === 'fr' ? data.en : data.fr
      setCurrentProfile(existing || createBlankProfile(lang, other))
      const urlPrefix = data.baseline_url_prefix || '/data/baseline'
      const m = lang === 'fr' ? data.metrics.fr : data.metrics.en
      const cacheBust = `?t=${Date.now()}`
      if (m && m.valid !== false) {
        setActiveMetrics(m)
        setPreviewPngUrl(`${m.png_url || `${urlPrefix}/baseline_CV_${lang.toUpperCase()}.png`}${cacheBust}`)
        setPreviewPdfUrl(`${m.pdf_url || `${urlPrefix}/baseline_CV_${lang.toUpperCase()}.pdf`}${cacheBust}`)
      } else {
        setActiveMetrics(m || null)
        setPreviewPngUrl('')
        setPreviewPdfUrl('')
      }
      setPreviewImgErr(false)
      setIsDirty(false)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to load profile' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfile()
  }, [config?.active_profile_id])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  // Switch language tab
  const handleSwitchLang = (newLang: 'fr' | 'en') => {
    if (newLang === activeLang || !profileData) return
    if (isDirty && !window.confirm('Discard unsaved edits on this CV tab before switching languages?')) {
      return
    }
    setActiveLang(newLang)
    const existing = newLang === 'fr' ? profileData.fr : profileData.en
    const other = newLang === 'fr' ? profileData.en : profileData.fr
    setCurrentProfile(existing || createBlankProfile(newLang, other))
    const urlPrefix = profileData.baseline_url_prefix || ''
    const m = newLang === 'fr' ? profileData.metrics.fr : profileData.metrics.en
    const cacheBust = `?t=${Date.now()}`
    if (m && m.valid !== false) {
      setActiveMetrics(m)
      setPreviewPngUrl(`${m.png_url || `${urlPrefix}/baseline_CV_${newLang.toUpperCase()}.png`}${cacheBust}`)
      setPreviewPdfUrl(`${m.pdf_url || `${urlPrefix}/baseline_CV_${newLang.toUpperCase()}.pdf`}${cacheBust}`)
    } else {
      setActiveMetrics(m || null)
      setPreviewPngUrl('')
      setPreviewPdfUrl('')
    }
    setPreviewImgErr(false)
    if (!existing && other) {
      setMessage({
        type: 'info',
        text: `${newLang.toUpperCase()} CV not created yet. Click "Sync to ${newLang.toUpperCase()} (AI)" to translate from ${newLang === 'fr' ? 'EN' : 'FR'}, or fill out below.`,
      })
    }
    setIsDirty(false)
  }

  const executeLoadSample = async () => {
    setShowSampleConfirm(false)
    setLoadingSample(true)
    setMessage(null)
    try {
      await loadSampleProfile('both')
      onRefreshConfig()
      await loadProfile(activeLang)
      setMessage({ type: 'success', text: 'Loaded sample CV in EN & FR! Edit any field or upload your own PDF.' })
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to load sample CV' })
    } finally {
      setLoadingSample(false)
    }
  }

  const handleLoadSample = () => {
    const hasExisting = Boolean(
      currentProfile &&
        (currentProfile.basics.name.trim() ||
          currentProfile.work_experience.length > 0 ||
          currentProfile.projects.length > 0 ||
          currentProfile.education.length > 0)
    )
    if (hasExisting) {
      setShowSampleConfirm(true)
      return
    }
    executeLoadSample()
  }

  // Field update helpers
  const updateBasics = (field: keyof CandidateProfile['basics'], val: any) => {
    if (!currentProfile) return
    setCurrentProfile({
      ...currentProfile,
      basics: {
        ...currentProfile.basics,
        [field]: val,
      },
    })
    setIsDirty(true)
  }

  const updateHeadline = (val: string) => {
    if (!currentProfile) return
    setCurrentProfile({ ...currentProfile, headline: val })
    setIsDirty(true)
  }

  const updateSummary = (val: string) => {
    if (!currentProfile) return
    setCurrentProfile({ ...currentProfile, summary: val })
    setIsDirty(true)
  }

  // Save profile to master YAML
  const handleSave = async (autoFit = true) => {
    if (!currentProfile) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await updateProfile(activeLang, currentProfile, autoFit)
      setMessage({
        type: 'success',
        text: `Successfully saved ${activeLang.toUpperCase()} profile! Exactly 1-page confirmed (${res.metrics.last_y1_pt.toFixed(1)}pt / 825pt).`,
      })
      setActiveMetrics(res.metrics)
      setPreviewPngUrl(`${res.metrics.png_url}?t=${Date.now()}`)
      setPreviewPdfUrl(`${res.metrics.pdf_url}?t=${Date.now()}`)
      setIsDirty(false)
      onRefreshConfig()
      // Reload profile data to update hash and metrics
      await loadProfile(activeLang)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save profile' })
    } finally {
      setSaving(false)
    }
  }

  // Preview draft without saving to master YAML
  const handlePreview = async () => {
    if (!currentProfile) return
    setPreviewing(true)
    setMessage(null)
    try {
      const res = await previewProfileDraft(activeLang, currentProfile)
      if (res.status === 'success' && res.pdf_url && res.png_url) {
        setActiveMetrics({
          page_count: res.page_count || 1,
          last_y1_pt: res.last_y1_pt || 0,
          max_y1_pt: res.max_y1_pt || 825,
          valid: res.valid_1_page,
          pdf_url: res.pdf_url,
          png_url: res.png_url,
        })
        setPreviewPngUrl(`${res.png_url}?t=${Date.now()}`)
        setPreviewPdfUrl(`${res.pdf_url}?t=${Date.now()}`)
        setMessage({
          type: res.valid_1_page ? 'success' : 'error',
          text: res.valid_1_page
            ? `1-Page Preview Refreshed: ${res.last_y1_pt?.toFixed(1)}pt / 825pt`
            : `Draft exceeds 1-page budget (${res.page_count} pages). Click "Auto-Fit & Save" to compress.`,
        })
      } else {
        setMessage({ type: 'error', text: res.message || 'Preview generation failed' })
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Preview generation failed' })
    } finally {
      setPreviewing(false)
    }
  }

  // ATS Optimize existing profile using 90+ Resume Worded rules
  const handleOptimizeAts = async () => {
    if (!currentProfile) return
    setOptimizing(true)
    setMessage(null)
    try {
      const res = await optimizeProfileAts({
        lang: activeLang,
        profile: currentProfile,
      })
      setCurrentProfile(res.profile)
      setIsDirty(true)
      const summary =
        res.improvements && res.improvements.length > 0
          ? ` Improvements: ${res.improvements.slice(0, 3).join(' • ')}`
          : ''
      setMessage({
        type: 'success',
        text: `ATS-optimized ${activeLang.toUpperCase()} profile (zero fabricated facts).${summary} Review and click Save & Compile.`,
      })
      const prev = await previewProfileDraft(activeLang, res.profile)
      if (prev.status === 'success' && prev.pdf_url && prev.png_url) {
        setActiveMetrics({
          page_count: prev.page_count || 1,
          last_y1_pt: prev.last_y1_pt || 0,
          max_y1_pt: prev.max_y1_pt || 825,
          valid: prev.valid_1_page,
          pdf_url: prev.pdf_url,
          png_url: prev.png_url,
        })
        setPreviewPngUrl(`${prev.png_url}?t=${Date.now()}`)
        setPreviewPdfUrl(`${prev.pdf_url}?t=${Date.now()}`)
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'ATS optimization failed' })
    } finally {
      setOptimizing(false)
    }
  }

  // Cross-Language AI Translation
  const handleTranslate = async () => {
    if (!currentProfile) return
    const targetLang = activeLang === 'fr' ? 'en' : 'fr'
    const confirmMsg = `Generate ${targetLang.toUpperCase()} profile from your current ${activeLang.toUpperCase()} profile using AI?\n\nThis will translate your headline, summary, positions, and bullets while preserving 100% of numbers, dates, tools, and 1-page layout.`
    if (!window.confirm(confirmMsg)) return

    setTranslating(true)
    setMessage(null)
    try {
      const res = await translateProfile({
        source_lang: activeLang,
        target_lang: targetLang,
        profile: currentProfile,
        auto_save: true,
      })
      setMessage({
        type: 'success',
        text: `Successfully generated and saved ${targetLang.toUpperCase()} profile with AI!`,
      })
      setActiveLang(targetLang)
      setCurrentProfile(res.profile)
      if (res.metrics) {
        const urlPrefix = profileData?.baseline_url_prefix || '/data/baseline'
        setActiveMetrics({
          page_count: res.metrics.page_count,
          last_y1_pt: res.metrics.last_y1_pt,
          max_y1_pt: 825,
          valid: true,
          pdf_url: res.metrics.pdf_url || `${urlPrefix}/baseline_CV_${targetLang.toUpperCase()}.pdf`,
          png_url: res.metrics.png_url || `${urlPrefix}/baseline_CV_${targetLang.toUpperCase()}.png`,
        })
      }
      setIsDirty(false)
      onRefreshConfig()
      await loadProfile(targetLang)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Translation failed' })
    } finally {
      setTranslating(false)
    }
  }

  // Import CV PDF via file input
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setMessage(null)
    try {
      const res = await importProfilePdf(file)
      setCurrentProfile(res.profile)
      setActiveLang(res.detected_language)
      setIsDirty(true)
      setMessage({
        type: 'success',
        text: `Extracted CV into structured profile! Detected language: ${res.detected_language.toUpperCase()}. Review fields and click Save.`,
      })
      // Trigger draft preview and display it immediately
      const previewRes = await previewProfileDraft(res.detected_language, res.profile)
      setActiveMetrics({
        page_count: previewRes.page_count ?? 1,
        last_y1_pt: previewRes.last_y1_pt ?? 0,
        valid: previewRes.valid_1_page,
        pdf_url: previewRes.pdf_url,
        png_url: previewRes.png_url,
      })
      setPreviewPngUrl(`${previewRes.png_url}?t=${Date.now()}`)
      setPreviewPdfUrl(`${previewRes.pdf_url}?t=${Date.now()}`)
      setPreviewImgErr(false)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'PDF extraction failed' })
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  // Re-score all listings
  const handleRescoreAll = async () => {
    setRescoring(true)
    try {
      const res = await rescoreAllListings()
      setMessage({
        type: 'success',
        text: `Re-scored ${res.rescored_listings} listings against updated candidate profile!`,
      })
      await loadProfile(activeLang)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to rescore listings' })
    } finally {
      setRescoring(false)
    }
  }

  if (loading || !currentProfile) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-700">Loading Candidate Profile & CV Studio...</p>
        </div>
      </div>
    )
  }

  const fillPercentage = activeMetrics
    ? Math.min(100, Math.round((activeMetrics.last_y1_pt / (activeMetrics.max_y1_pt || 825)) * 100))
    : 0
  const isOverflow = activeMetrics ? activeMetrics.page_count > 1 || activeMetrics.last_y1_pt > 825 : false

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-50">
      {/* Top Studio Toolbar */}
      <div className="bg-white border-b border-slate-200 px-6 py-3.5 sticky top-0 z-20 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Title & Language */}
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-900">Profile & CV Studio</h1>
                {isDirty && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-300">
                    Unsaved Edits
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Profile: <code>{profileData?.active_profile_id || 'local-default'}</code> (<code>master.{activeLang}.yaml</code>). Compiles to exact 1-page PDF.
              </p>
            </div>

            {/* Language Switcher */}
            <div className="flex items-center rounded-lg border border-slate-200 p-0.5 bg-slate-100 text-xs font-semibold ml-2">
              <button
                onClick={() => handleSwitchLang('fr')}
                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                  activeLang === 'fr'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                French (FR)
              </button>
              <button
                onClick={() => handleSwitchLang('en')}
                className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                  activeLang === 'en'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                English (EN)
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Load Sample CV */}
            <button
              type="button"
              onClick={handleLoadSample}
              disabled={loadingSample}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer shadow-xs transition-colors"
              title="Populate a generic sample CV in EN & FR to preview the layout"
            >
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              <span>{loadingSample ? 'Loading...' : 'Load Sample CV'}</span>
            </button>

            {/* Import PDF */}
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer shadow-xs transition-colors">
              <Upload className="w-3.5 h-3.5 text-slate-500" />
              <span>{importing ? 'Extracting...' : 'Upload Base CV (PDF)'}</span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handlePdfUpload}
                disabled={importing}
              />
            </label>

            {/* AI ATS Optimize */}
            <button
              onClick={handleOptimizeAts}
              disabled={optimizing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold cursor-pointer transition-colors"
              title="Upgrade bullets, verbs, titles, dates, and skills to 90+ Resume Worded / ATS standards (zero fabricated facts)"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>{optimizing ? 'Optimizing...' : 'ATS Optimize (AI)'}</span>
            </button>

            {/* AI Cross-Language Translate */}
            <button
              onClick={handleTranslate}
              disabled={translating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-800 text-xs font-semibold cursor-pointer transition-colors"
              title={`Translate to ${activeLang === 'fr' ? 'English (EN)' : 'French (FR)'} using AI`}
            >
              <Sparkles className="w-3.5 h-3.5 text-violet-600" />
              <span>
                {translating ? 'Translating...' : `Sync to ${activeLang === 'fr' ? 'EN' : 'FR'} (AI)`}
              </span>
            </button>

            {/* Refresh 1-Page Preview */}
            <button
              onClick={handlePreview}
              disabled={previewing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer shadow-xs transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${previewing ? 'animate-spin' : ''}`} />
              <span>Refresh Preview</span>
            </button>

            {/* Save to Master YAML */}
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Auto-fitting...' : 'Save & Compile 1-Page CV'}</span>
            </button>
          </div>
        </div>

        {/* Status Message Alert */}
        {message && (
          <div
            className={`mt-2.5 p-2.5 rounded-lg text-xs font-medium border flex items-center justify-between ${
              message.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : message.type === 'error'
                ? 'bg-rose-50 text-rose-800 border-rose-200'
                : 'bg-indigo-50 text-indigo-800 border-indigo-200'
            }`}
          >
            <span>{message.text}</span>
            <button
              onClick={() => setMessage(null)}
              className="text-slate-400 hover:text-slate-700 ml-2 font-bold"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Main Studio Body: 7 Cols Editor + 5 Cols Live Preview */}
      <div className="flex-1 p-6 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Form Editor (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Section 1: Basics & Contact */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('basics')}
              className="w-full px-5 py-3.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between text-left cursor-pointer hover:bg-slate-100/60"
            >
              <div className="flex items-center gap-2.5">
                <User className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  1. Personal Identity & Contact
                </span>
              </div>
              {openSections.basics ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {openSections.basics && (
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Full Legal Name</label>
                  <input
                    type="text"
                    value={currentProfile.basics.name}
                    onChange={(e) => updateBasics('name', e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Email</label>
                  <input
                    type="email"
                    value={currentProfile.basics.email}
                    onChange={(e) => updateBasics('email', e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={currentProfile.basics.phone}
                    onChange={(e) => updateBasics('phone', e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Location (City, Country)</label>
                  <input
                    type="text"
                    value={currentProfile.basics.location}
                    onChange={(e) => updateBasics('location', e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">LinkedIn Username / URL</label>
                  <input
                    type="text"
                    value={currentProfile.basics.linkedin || ''}
                    onChange={(e) => updateBasics('linkedin', e.target.value)}
                    placeholder="linkedin-handle"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">GitHub Username / URL</label>
                  <input
                    type="text"
                    value={currentProfile.basics.github || ''}
                    onChange={(e) => updateBasics('github', e.target.value)}
                    placeholder="github-handle"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="font-semibold text-slate-700 block mb-1">Availability Window</label>
                  <input
                    type="text"
                    value={currentProfile.basics.availability || ''}
                    onChange={(e) => updateBasics('availability', e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                  />
                </div>

                <div className="sm:col-span-2 pt-3 mt-1 border-t border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                      Career & Learning Goals (Used for Topic Richness & Interest Scoring)
                    </span>
                  </div>
                  {(
                    [
                      ['target_roles', 'Target Roles & Domains', 'AI/ML Engineer, Agentic AI & RAG, Data Engineering, MLOps...'],
                      ['tech_to_learn', 'Tech Stack to Learn / Strengthen', 'Databricks, Apache Spark, LangGraph, vLLM, Kubernetes...'],
                      ['dealbreakers', 'Dealbreakers / Low-Interest Work', 'Basic CRUD web apps, static BI maintenance, manual Excel...'],
                      ['pfe_priorities', 'PFE Thesis & Career Priorities', 'High technical richness, measurable ML architecture for thesis...'],
                    ] as const
                  ).map(([field, label, placeholder]) => (
                    <div key={field}>
                      <label className="font-semibold text-slate-700 block mb-1">{label}</label>
                      <input
                        type="text"
                        value={currentProfile.career_goals?.[field] ?? ''}
                        onChange={(e) => {
                          const val = e.target.value
                          setCurrentProfile((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  career_goals: {
                                    target_roles: prev.career_goals?.target_roles ?? '',
                                    tech_to_learn: prev.career_goals?.tech_to_learn ?? '',
                                    dealbreakers: prev.career_goals?.dealbreakers ?? '',
                                    pfe_priorities: prev.career_goals?.pfe_priorities ?? '',
                                    [field]: val,
                                  },
                                }
                              : prev
                          )
                          setIsDirty(true)
                        }}
                        placeholder={placeholder}
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Headline & Executive Summary */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('headline')}
              className="w-full px-5 py-3.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between text-left cursor-pointer hover:bg-slate-100/60"
            >
              <div className="flex items-center gap-2.5">
                <FileText className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  2. Headline & Executive Summary
                </span>
              </div>
              {openSections.headline ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {openSections.headline && (
              <div className="p-5 space-y-3 text-xs">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Dynamic Section Title / Headline
                  </label>
                  <input
                    type="text"
                    value={currentProfile.headline}
                    onChange={(e) => updateHeadline(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Appears prominently as the bold section divider on the rendered CV.
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700">1-Paragraph Executive Pitch</label>
                    <span
                      className={`text-[11px] font-mono ${
                        currentProfile.summary.length > 330 ? 'text-rose-600 font-bold' : 'text-slate-400'
                      }`}
                    >
                      {currentProfile.summary.length} chars (Target: 240–310)
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    value={currentProfile.summary}
                    onChange={(e) => updateSummary(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-indigo-500 leading-relaxed"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Work Experience */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('experience')}
              className="w-full px-5 py-3.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between text-left cursor-pointer hover:bg-slate-100/60"
            >
              <div className="flex items-center gap-2.5">
                <Briefcase className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  3. Work Experience ({currentProfile.work_experience.length})
                </span>
              </div>
              {openSections.experience ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {openSections.experience && (
              <div className="p-5 space-y-4">
                {currentProfile.work_experience.map((exp, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-indigo-700">Role #{idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = currentProfile.work_experience.filter((_, i) => i !== idx)
                          setCurrentProfile({ ...currentProfile, work_experience: updated })
                          setIsDirty(true)
                        }}
                        className="text-slate-400 hover:text-rose-600 p-1"
                        title="Delete Role"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Company</label>
                        <input
                          type="text"
                          value={exp.company}
                          onChange={(e) => {
                            const updated = [...currentProfile.work_experience]
                            updated[idx].company = e.target.value
                            setCurrentProfile({ ...currentProfile, work_experience: updated })
                            setIsDirty(true)
                          }}
                          className="w-full px-2 py-1 border border-slate-200 rounded text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Position</label>
                        <input
                          type="text"
                          value={exp.position}
                          onChange={(e) => {
                            const updated = [...currentProfile.work_experience]
                            updated[idx].position = e.target.value
                            setCurrentProfile({ ...currentProfile, work_experience: updated })
                            setIsDirty(true)
                          }}
                          className="w-full px-2 py-1 border border-slate-200 rounded text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                          Dates (e.g. 2025-02 — 2025-06)
                        </label>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={exp.start_date}
                            onChange={(e) => {
                              const updated = [...currentProfile.work_experience]
                              updated[idx].start_date = e.target.value
                              setCurrentProfile({ ...currentProfile, work_experience: updated })
                              setIsDirty(true)
                            }}
                            className="w-1/2 px-2 py-1 border border-slate-200 rounded text-slate-800"
                          />
                          <span className="text-slate-400">—</span>
                          <input
                            type="text"
                            value={exp.end_date}
                            onChange={(e) => {
                              const updated = [...currentProfile.work_experience]
                              updated[idx].end_date = e.target.value
                              setCurrentProfile({ ...currentProfile, work_experience: updated })
                              setIsDirty(true)
                            }}
                            className="w-1/2 px-2 py-1 border border-slate-200 rounded text-slate-800"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Location</label>
                        <input
                          type="text"
                          value={exp.location}
                          onChange={(e) => {
                            const updated = [...currentProfile.work_experience]
                            updated[idx].location = e.target.value
                            setCurrentProfile({ ...currentProfile, work_experience: updated })
                            setIsDirty(true)
                          }}
                          className="w-full px-2 py-1 border border-slate-200 rounded text-slate-800"
                        />
                      </div>
                    </div>

                    {/* Highlights bullets */}
                    <div className="space-y-1.5 pt-1">
                      <label className="text-[11px] font-semibold text-slate-600 block">
                        Bullet Points ({exp.highlights.length})
                      </label>
                      {exp.highlights.map((bullet, bIdx) => (
                        <div key={bIdx} className="flex items-start gap-1.5">
                          <span className="text-slate-400 mt-1.5">•</span>
                          <textarea
                            rows={2}
                            value={bullet}
                            onChange={(e) => {
                              const updated = [...currentProfile.work_experience]
                              updated[idx].highlights[bIdx] = e.target.value
                              setCurrentProfile({ ...currentProfile, work_experience: updated })
                              setIsDirty(true)
                            }}
                            className="flex-1 px-2 py-1 border border-slate-200 rounded text-slate-800 text-[11.5px]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...currentProfile.work_experience]
                              updated[idx].highlights = updated[idx].highlights.filter((_, i) => i !== bIdx)
                              setCurrentProfile({ ...currentProfile, work_experience: updated })
                              setIsDirty(true)
                            }}
                            className="text-slate-400 hover:text-rose-600 p-1 mt-1"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const updated = [...currentProfile.work_experience]
                          updated[idx].highlights.push('Delivered project achievements with concrete metrics.')
                          setCurrentProfile({ ...currentProfile, work_experience: updated })
                          setIsDirty(true)
                        }}
                        className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1 font-semibold pt-1"
                      >
                        <Plus className="w-3 h-3" /> Add Bullet
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    const newRole: ExperienceItem = {
                      company: 'New Company',
                      position: 'Role Title',
                      start_date: '2025-01',
                      end_date: '2025-06',
                      location: 'City, Country',
                      highlights: ['Delivered key technical deliverable with measured impact.'],
                    }
                    setCurrentProfile({
                      ...currentProfile,
                      work_experience: [...currentProfile.work_experience, newRole],
                    })
                    setIsDirty(true)
                  }}
                  className="w-full py-2 border border-dashed border-indigo-300 rounded-xl text-xs font-semibold text-indigo-700 hover:bg-indigo-50 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Experience Entry
                </button>
              </div>
            )}
          </div>

          {/* Section 4: Projects */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('projects')}
              className="w-full px-5 py-3.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between text-left cursor-pointer hover:bg-slate-100/60"
            >
              <div className="flex items-center gap-2.5">
                <FolderGit2 className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  4. Projects ({currentProfile.projects.length})
                </span>
              </div>
              {openSections.projects ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {openSections.projects && (
              <div className="p-5 space-y-4">
                {currentProfile.projects.map((proj, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-indigo-700">Project #{idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = currentProfile.projects.filter((_, i) => i !== idx)
                          setCurrentProfile({ ...currentProfile, projects: updated })
                          setIsDirty(true)
                        }}
                        className="text-slate-400 hover:text-rose-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="sm:col-span-2">
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                          Project Name & Stack Header
                        </label>
                        <input
                          type="text"
                          value={proj.name}
                          onChange={(e) => {
                            const updated = [...currentProfile.projects]
                            updated[idx].name = e.target.value
                            setCurrentProfile({ ...currentProfile, projects: updated })
                            setIsDirty(true)
                          }}
                          className="w-full px-2 py-1 border border-slate-200 rounded text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Date (YYYY-MM)</label>
                        <input
                          type="text"
                          value={proj.date || ''}
                          onChange={(e) => {
                            const updated = [...currentProfile.projects]
                            updated[idx].date = e.target.value
                            setCurrentProfile({ ...currentProfile, projects: updated })
                            setIsDirty(true)
                          }}
                          className="w-full px-2 py-1 border border-slate-200 rounded text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Repository / URL</label>
                        <input
                          type="text"
                          value={proj.url || ''}
                          onChange={(e) => {
                            const updated = [...currentProfile.projects]
                            updated[idx].url = e.target.value
                            setCurrentProfile({ ...currentProfile, projects: updated })
                            setIsDirty(true)
                          }}
                          className="w-full px-2 py-1 border border-slate-200 rounded text-slate-800"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <label className="text-[11px] font-semibold text-slate-600 block">Highlights</label>
                      {proj.highlights.map((bullet, bIdx) => (
                        <div key={bIdx} className="flex items-start gap-1.5">
                          <span className="text-slate-400 mt-1.5">•</span>
                          <textarea
                            rows={2}
                            value={bullet}
                            onChange={(e) => {
                              const updated = [...currentProfile.projects]
                              updated[idx].highlights[bIdx] = e.target.value
                              setCurrentProfile({ ...currentProfile, projects: updated })
                              setIsDirty(true)
                            }}
                            className="flex-1 px-2 py-1 border border-slate-200 rounded text-slate-800 text-[11.5px]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...currentProfile.projects]
                              updated[idx].highlights = updated[idx].highlights.filter((_, i) => i !== bIdx)
                              setCurrentProfile({ ...currentProfile, projects: updated })
                              setIsDirty(true)
                            }}
                            className="text-slate-400 hover:text-rose-600 p-1 mt-1"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const updated = [...currentProfile.projects]
                          updated[idx].highlights.push('Engineered feature achieving verified performance.')
                          setCurrentProfile({ ...currentProfile, projects: updated })
                          setIsDirty(true)
                        }}
                        className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1 font-semibold pt-1"
                      >
                        <Plus className="w-3 h-3" /> Add Bullet
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    const newProj: ProjectItem = {
                      name: 'New Project (Tech Stack)',
                      date: '2026-01',
                      highlights: ['Built application with full stack architecture.'],
                    }
                    setCurrentProfile({
                      ...currentProfile,
                      projects: [...currentProfile.projects, newProj],
                    })
                    setIsDirty(true)
                  }}
                  className="w-full py-2 border border-dashed border-indigo-300 rounded-xl text-xs font-semibold text-indigo-700 hover:bg-indigo-50 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Project
                </button>
              </div>
            )}
          </div>

          {/* Section 5: Education */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('education')}
              className="w-full px-5 py-3.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between text-left cursor-pointer hover:bg-slate-100/60"
            >
              <div className="flex items-center gap-2.5">
                <GraduationCap className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  5. Education ({currentProfile.education.length})
                </span>
              </div>
              {openSections.education ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {openSections.education && (
              <div className="p-5 space-y-3">
                {currentProfile.education.map((edu, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-indigo-700">Degree #{idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = currentProfile.education.filter((_, i) => i !== idx)
                          setCurrentProfile({ ...currentProfile, education: updated })
                          setIsDirty(true)
                        }}
                        className="text-slate-400 hover:text-rose-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="sm:col-span-2">
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Institution</label>
                        <input
                          type="text"
                          value={edu.institution}
                          onChange={(e) => {
                            const updated = [...currentProfile.education]
                            updated[idx].institution = e.target.value
                            setCurrentProfile({ ...currentProfile, education: updated })
                            setIsDirty(true)
                          }}
                          className="w-full px-2 py-1 border border-slate-200 rounded text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Degree Title</label>
                        <input
                          type="text"
                          value={edu.degree}
                          onChange={(e) => {
                            const updated = [...currentProfile.education]
                            updated[idx].degree = e.target.value
                            setCurrentProfile({ ...currentProfile, education: updated })
                            setIsDirty(true)
                          }}
                          className="w-full px-2 py-1 border border-slate-200 rounded text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Specialization / Area</label>
                        <input
                          type="text"
                          value={edu.area}
                          onChange={(e) => {
                            const updated = [...currentProfile.education]
                            updated[idx].area = e.target.value
                            setCurrentProfile({ ...currentProfile, education: updated })
                            setIsDirty(true)
                          }}
                          className="w-full px-2 py-1 border border-slate-200 rounded text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Dates</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={edu.start_date}
                            onChange={(e) => {
                              const updated = [...currentProfile.education]
                              updated[idx].start_date = e.target.value
                              setCurrentProfile({ ...currentProfile, education: updated })
                              setIsDirty(true)
                            }}
                            className="w-1/2 px-2 py-1 border border-slate-200 rounded text-slate-800"
                          />
                          <span className="text-slate-400">—</span>
                          <input
                            type="text"
                            value={edu.end_date}
                            onChange={(e) => {
                              const updated = [...currentProfile.education]
                              updated[idx].end_date = e.target.value
                              setCurrentProfile({ ...currentProfile, education: updated })
                              setIsDirty(true)
                            }}
                            className="w-1/2 px-2 py-1 border border-slate-200 rounded text-slate-800"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">Location</label>
                        <input
                          type="text"
                          value={edu.location}
                          onChange={(e) => {
                            const updated = [...currentProfile.education]
                            updated[idx].location = e.target.value
                            setCurrentProfile({ ...currentProfile, education: updated })
                            setIsDirty(true)
                          }}
                          className="w-full px-2 py-1 border border-slate-200 rounded text-slate-800"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    const newEdu: EducationItem = {
                      institution: 'University Name',
                      degree: "Master's Degree",
                      area: 'Computer Science',
                      start_date: '2025-09',
                      end_date: '2027-06',
                      location: 'Tunis, Tunisia',
                    }
                    setCurrentProfile({
                      ...currentProfile,
                      education: [...currentProfile.education, newEdu],
                    })
                    setIsDirty(true)
                  }}
                  className="w-full py-2 border border-dashed border-indigo-300 rounded-xl text-xs font-semibold text-indigo-700 hover:bg-indigo-50 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Education Entry
                </button>
              </div>
            )}
          </div>

          {/* Section 6: Skills & Technologies */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('skills')}
              className="w-full px-5 py-3.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between text-left cursor-pointer hover:bg-slate-100/60"
            >
              <div className="flex items-center gap-2.5">
                <Wrench className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  6. Skills & Toolsets ({currentProfile.skills.length} Categories)
                </span>
              </div>
              {openSections.skills ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {openSections.skills && (
              <div className="p-5 space-y-3">
                {currentProfile.skills.map((skill, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <input
                        type="text"
                        value={skill.label}
                        onChange={(e) => {
                          const updated = [...currentProfile.skills]
                          updated[idx].label = e.target.value
                          setCurrentProfile({ ...currentProfile, skills: updated })
                          setIsDirty(true)
                        }}
                        placeholder="Category Name (e.g. Machine Learning)"
                        className="font-bold text-indigo-700 bg-transparent border-b border-slate-300 focus:border-indigo-600 focus:outline-hidden px-1 py-0.5"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const updated = currentProfile.skills.filter((_, i) => i !== idx)
                          setCurrentProfile({ ...currentProfile, skills: updated })
                          setIsDirty(true)
                        }}
                        className="text-slate-400 hover:text-rose-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div>
                      <input
                        type="text"
                        value={skill.details}
                        onChange={(e) => {
                          const updated = [...currentProfile.skills]
                          updated[idx].details = e.target.value
                          setCurrentProfile({ ...currentProfile, skills: updated })
                          setIsDirty(true)
                        }}
                        placeholder="Comma-separated technologies..."
                        className="w-full px-2 py-1 border border-slate-200 rounded text-slate-800"
                      />
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    const newSkill: SkillCategoryItem = {
                      label: 'New Skill Category',
                      details: 'Python, Docker, Git',
                    }
                    setCurrentProfile({
                      ...currentProfile,
                      skills: [...currentProfile.skills, newSkill],
                    })
                    setIsDirty(true)
                  }}
                  className="w-full py-2 border border-dashed border-indigo-300 rounded-xl text-xs font-semibold text-indigo-700 hover:bg-indigo-50 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Skill Category
                </button>
              </div>
            )}
          </div>

          {/* Section 7: Optional Sections (Certifications & Extracurricular) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('optional')}
              className="w-full px-5 py-3.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between text-left cursor-pointer hover:bg-slate-100/60"
            >
              <div className="flex items-center gap-2.5">
                <Award className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  7. Optional Sections (Certifications & Activities)
                </span>
              </div>
              {openSections.optional ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {openSections.optional && (
              <div className="p-5 space-y-5 text-xs">
                {/* Certifications */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-700">Certifications</span>
                    <button
                      type="button"
                      onClick={() => {
                        const newCert: CertificationItem = {
                          name: 'Certification Name',
                          issuer: 'Issuer / Organization',
                          date: '2025',
                        }
                        setCurrentProfile({
                          ...currentProfile,
                          certifications: [...(currentProfile.certifications || []), newCert],
                        })
                        setIsDirty(true)
                      }}
                      className="text-[11px] text-indigo-600 font-semibold hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add Certification
                    </button>
                  </div>

                  {(currentProfile.certifications || []).map((cert, cIdx) => (
                    <div key={cIdx} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 flex items-center gap-2">
                      <input
                        type="text"
                        value={cert.name}
                        onChange={(e) => {
                          const updated = [...(currentProfile.certifications || [])]
                          updated[cIdx].name = e.target.value
                          setCurrentProfile({ ...currentProfile, certifications: updated })
                          setIsDirty(true)
                        }}
                        placeholder="Certificate name"
                        className="flex-1 px-2 py-1 border border-slate-200 rounded"
                      />
                      <input
                        type="text"
                        value={cert.issuer || ''}
                        onChange={(e) => {
                          const updated = [...(currentProfile.certifications || [])]
                          updated[cIdx].issuer = e.target.value
                          setCurrentProfile({ ...currentProfile, certifications: updated })
                          setIsDirty(true)
                        }}
                        placeholder="Issuer"
                        className="w-1/3 px-2 py-1 border border-slate-200 rounded"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const updated = (currentProfile.certifications || []).filter((_, i) => i !== cIdx)
                          setCurrentProfile({ ...currentProfile, certifications: updated })
                          setIsDirty(true)
                        }}
                        className="text-slate-400 hover:text-rose-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Extracurricular */}
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-700">Extracurricular & Leadership</span>
                    <button
                      type="button"
                      onClick={() => {
                        const newExtra: ExtracurricularItem = {
                          organization: 'Organization Name',
                          role: 'Role / Position',
                          highlights: ['Organized team initiatives.'],
                        }
                        setCurrentProfile({
                          ...currentProfile,
                          extracurricular: [...(currentProfile.extracurricular || []), newExtra],
                        })
                        setIsDirty(true)
                      }}
                      className="text-[11px] text-indigo-600 font-semibold hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add Activity
                    </button>
                  </div>

                  {(currentProfile.extracurricular || []).map((extra, eIdx) => (
                    <div key={eIdx} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <input
                          type="text"
                          value={extra.organization}
                          onChange={(e) => {
                            const updated = [...(currentProfile.extracurricular || [])]
                            updated[eIdx].organization = e.target.value
                            setCurrentProfile({ ...currentProfile, extracurricular: updated })
                            setIsDirty(true)
                          }}
                          placeholder="Organization name"
                          className="flex-1 px-2 py-1 border border-slate-200 rounded font-semibold"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = (currentProfile.extracurricular || []).filter((_, i) => i !== eIdx)
                            setCurrentProfile({ ...currentProfile, extracurricular: updated })
                            setIsDirty(true)
                          }}
                          className="text-slate-400 hover:text-rose-600 p-1 ml-2"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={extra.role}
                        onChange={(e) => {
                          const updated = [...(currentProfile.extracurricular || [])]
                          updated[eIdx].role = e.target.value
                          setCurrentProfile({ ...currentProfile, extracurricular: updated })
                          setIsDirty(true)
                        }}
                        placeholder="Role / Responsibility"
                        className="w-full px-2 py-1 border border-slate-200 rounded"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Live Sticky 1-Page Preview (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="sticky top-20 space-y-4">
            {/* Page Fill Health Meter */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">1-Page Layout Lock</span>
                {isOverflow ? (
                  <span className="px-2 py-0.5 rounded-full font-bold bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-rose-600" />
                    Overflow: &gt;1 Page
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-600" />
                    Exact 1 Page Confirmed
                  </span>
                )}
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-2.5 rounded-full transition-all duration-300 ${
                    isOverflow ? 'bg-rose-500' : fillPercentage > 95 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, fillPercentage)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  Bottom margin y1: <strong>{activeMetrics?.last_y1_pt?.toFixed(1) || '0'}pt</strong> / 825pt
                </span>
                <span>{fillPercentage}% full</span>
              </div>

              {isOverflow && (
                <button
                  type="button"
                  onClick={() => handleSave(true)}
                  className="w-full py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  Auto-Fit & Compress to 1 Page
                </button>
              )}
            </div>

            {/* Outdated Match Scores Notice */}
            {profileData && profileData.outdated_listings_count > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-2 text-xs">
                <div className="flex items-center gap-2 text-amber-800 font-bold">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Stale Match Scores ({profileData.outdated_listings_count} listings)</span>
                </div>
                <p className="text-[11.5px] text-amber-700">
                  Your profile was updated. Some catalogue listings were scored against an older profile version.
                </p>
                <button
                  type="button"
                  onClick={handleRescoreAll}
                  disabled={rescoring}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${rescoring ? 'animate-spin' : ''}`} />
                  <span>{rescoring ? 'Re-scoring...' : 'Re-score All Listings Now'}</span>
                </button>
              </div>
            )}

            {/* Rendered CV Image Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden group relative">
              {previewPngUrl && !previewImgErr ? (
                <img
                  src={previewPngUrl}
                  alt={`Rendered CV ${activeLang.toUpperCase()}`}
                  className="w-full h-auto object-contain block"
                  onError={() => setPreviewImgErr(true)}
                />
              ) : (
                <div className="py-24 text-center text-slate-400 text-xs">
                  Click "Refresh Preview" to compile 1-page layout.
                </div>
              )}

              {/* Hover Actions Overlay */}
              <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-4">
                {previewPdfUrl && (
                  <a
                    href={previewPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 rounded-lg bg-white text-slate-900 font-bold text-xs shadow-lg hover:bg-slate-100 flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open PDF in Full Tab
                  </a>
                )}
                {previewPdfUrl && (
                  <a
                    href={previewPdfUrl}
                    download={`CV_${currentProfile.basics.name.replace(/\s+/g, '_')}_${activeLang.toUpperCase()}.pdf`}
                    className="px-3 py-2 rounded-lg bg-indigo-600 text-white font-bold text-xs shadow-lg hover:bg-indigo-700 flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download PDF
                  </a>
                )}
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between text-xs text-slate-500 px-1">
              <span>Theme: <code>pfeclassic</code> (Typst)</span>
              {previewPdfUrl && (
                <a
                  href={previewPdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 hover:underline flex items-center gap-1 font-semibold"
                >
                  Direct PDF Link <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Confirm Overwrite with Sample CV */}
      {showSampleConfirm && (
        <div
          onClick={() => setShowSampleConfirm(false)}
          className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Replace current CV with Sample CV?
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  This will overwrite both the English and French CVs in your active profile (
                  <strong>{config?.active_profile_id || 'local-default'}</strong>). To test safely without touching your CV, create a new profile with <strong>+ New</strong> in the sidebar.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSampleConfirm(false)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeLoadSample}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs cursor-pointer"
              >
                Replace with Sample CV
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
