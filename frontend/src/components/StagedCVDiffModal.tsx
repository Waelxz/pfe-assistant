import React, { useState, useRef, useEffect } from 'react'
import {
  X,
  FileCheck2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Plus,
  Tag,
  Check,
  CheckCircle2,
  Eye,
  FileDown,
} from 'lucide-react'
import { confirmCVDiff, generateCVDiff, saveCVDraftDiff, previewCVDiff } from '../api'
import {
  isSyntheticRef,
  type StagedCVDiff,
  type BulletDiff,
  type SkillCategoryDiff,
} from '../types'

interface StagedCVDiffModalProps {
  applicationId: number
  diff: StagedCVDiff | null
  onClose: () => void
  onConfirmed: (diff: StagedCVDiff) => void
  selectedSubjects?: string[]
}

export const StagedCVDiffModal: React.FC<StagedCVDiffModalProps> = ({
  applicationId,
  diff: initialDiff,
  onClose,
  onConfirmed,
  selectedSubjects = [],
}) => {
  const [diff, setDiff] = useState<StagedCVDiff | null>(initialDiff)
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [showMorePlaces, setShowMorePlaces] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [showGuardrailPopup, setShowGuardrailPopup] = useState(false)
  const [ignoreGuardrail, setIgnoreGuardrail] = useState(false)
  const [previewRendering, setPreviewRendering] = useState(false)
  const [previewTimestamp, setPreviewTimestamp] = useState<number>(Date.now())
  const [previewPresetLevel, setPreviewPresetLevel] = useState<number>(0)
  const [previewOutdated, setPreviewOutdated] = useState(false)

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  // Track currently focused textarea for keyword injection
  const focusedInputRef = useRef<{
    element: HTMLTextAreaElement | null
    type: 'headline' | 'summary' | 'skill' | 'bullet'
    index?: number
  } | null>(null)

  // Toggle states
  const [acceptHeadline, setAcceptHeadline] = useState(true)
  const [acceptSummary, setAcceptSummary] = useState(() =>
    Boolean(initialDiff?.summary_suggestion?.accepted && initialDiff?.summary_suggestion?.original?.trim())
  )
  const [acceptedBullets, setAcceptedBullets] = useState<Record<number, boolean>>(() => {
    const map: Record<number, boolean> = {}
    initialDiff?.bullet_diffs?.forEach((_, idx) => {
      map[idx] = true
    })
    return map
  })
  const [acceptedSkills, setAcceptedSkills] = useState<Record<number, boolean>>(() => {
    const map: Record<number, boolean> = {}
    initialDiff?.skill_category_diffs?.forEach((_, idx) => {
      map[idx] = true
    })
    return map
  })

  // Manual preview compilation (triggered on initial open or Refresh button click)
  const triggerLivePreview = async (currentDiff: StagedCVDiff) => {
    const activeDiff: StagedCVDiff = {
      language: currentDiff.language,
      headline_suggestion: acceptHeadline ? currentDiff.headline_suggestion : null,
      summary_suggestion: acceptSummary ? currentDiff.summary_suggestion : null,
      skill_category_diffs: (currentDiff.skill_category_diffs || []).filter((_, idx) => acceptedSkills[idx]),
      bullet_diffs: (currentDiff.bullet_diffs || []).filter((_, idx) => acceptedBullets[idx]),
      has_unverified_keywords: currentDiff.has_unverified_keywords,
      all_unverified_keywords: currentDiff.all_unverified_keywords,
      target_keywords: currentDiff.target_keywords || [],
      available_bullets: currentDiff.available_bullets || [],
      available_skills: currentDiff.available_skills || [],
    }

    try {
      setPreviewRendering(true)
      const res = await previewCVDiff(applicationId, activeDiff)
      setPreviewPresetLevel(res.layout_preset_applied || 0)
      setPreviewTimestamp(Date.now())
      setPreviewOutdated(false)
    } catch {
      // Ignore preview errors
    } finally {
      setPreviewRendering(false)
    }
  }

  // Render preview once on initial mount, then mark outdated when user edits
  const isInitialMountRef = useRef(true)
  useEffect(() => {
    if (!diff) return
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false
      triggerLivePreview(diff)
    } else {
      setPreviewOutdated(true)
    }
  }, [diff, acceptHeadline, acceptSummary, acceptedSkills, acceptedBullets])

  if (!diff) return null

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3000)
  }

  const handleCloseAndSaveDraft = async () => {
    try {
      if (diff) {
        await saveCVDraftDiff(applicationId, diff)
      }
    } catch {
      // Ignore background save errors on modal dismiss
    }
    onClose()
  }

  const handleRegenerate = async () => {
    try {
      setRegenerating(true)
      setError(null)
      const res = await generateCVDiff(applicationId, instruction)
      setDiff(res.diff)
      setAcceptSummary(
        Boolean(res.diff.summary_suggestion?.accepted && res.diff.summary_suggestion?.original?.trim())
      )
      const bulletMap: Record<number, boolean> = {}
      res.diff.bullet_diffs.forEach((_, idx) => {
        bulletMap[idx] = true
      })
      setAcceptedBullets(bulletMap)
      const skillMap: Record<number, boolean> = {}
      res.diff.skill_category_diffs.forEach((_, idx) => {
        skillMap[idx] = true
      })
      setAcceptedSkills(skillMap)
      showToast('CV suggestions regenerated!')
    } catch (err: any) {
      setError(err.message || 'Failed to re-generate CV diff')
    } finally {
      setRegenerating(false)
    }
  }

  const handleConfirm = async () => {
    if (!diff) return

    // Build final accepted diff
    const finalDiff: StagedCVDiff = {
      language: diff.language,
      headline_suggestion: acceptHeadline ? diff.headline_suggestion : null,
      summary_suggestion: acceptSummary ? diff.summary_suggestion : null,
      skill_category_diffs: (diff.skill_category_diffs || []).filter((_, idx) => acceptedSkills[idx]),
      bullet_diffs: (diff.bullet_diffs || []).filter((_, idx) => acceptedBullets[idx]),
      has_unverified_keywords: diff.has_unverified_keywords,
      all_unverified_keywords: diff.all_unverified_keywords,
      target_keywords: diff.target_keywords || [],
      available_bullets: diff.available_bullets || [],
      available_skills: diff.available_skills || [],
    }

    try {
      setLoading(true)
      setError(null)
      const res = await confirmCVDiff(applicationId, finalDiff)
      
      const returnedDiff = res.fitted_diff || finalDiff
      if (res.auto_compressed) {
        showToast('Auto-compressed & locked to 1-page layout without losing your edits!')
      } else if (res.layout_preset_applied && res.layout_preset_applied > 0) {
        showToast(`Auto-fitted spacing (Level ${res.layout_preset_applied}) — 1-page locked!`)
      } else {
        showToast('1-page layout verified & locked!')
      }
      onConfirmed(returnedDiff)
    } catch (err: any) {
      setError(
        err.message ||
          'Failed to compile CV. If page count exceeded 1 page, please uncheck or shorten some changes.'
      )
    } finally {
      setLoading(false)
    }
  }

  // Insert keyword into focused textarea or copy to clipboard
  const handleInjectKeyword = (keyword: string) => {
    const focused = focusedInputRef.current
    if (focused && focused.element) {
      const el = focused.element
      const start = el.selectionStart || 0
      const end = el.selectionEnd || 0
      const text = el.value
      const before = text.substring(0, start)
      const after = text.substring(end)
      const insertText = before.endsWith(' ') || before.endsWith(',') || before.length === 0 ? keyword : ` ${keyword}`
      const newText = before + insertText + after

      if (focused.type === 'headline' && diff.headline_suggestion) {
        setDiff({
          ...diff,
          headline_suggestion: {
            ...diff.headline_suggestion,
            proposed: newText,
            user_modified: true,
          },
        })
      } else if (focused.type === 'summary' && diff.summary_suggestion) {
        setDiff({
          ...diff,
          summary_suggestion: {
            ...diff.summary_suggestion,
            proposed: newText,
            user_modified: true,
          },
        })
      } else if (focused.type === 'skill' && focused.index !== undefined) {
        const updated = [...(diff.skill_category_diffs || [])]
        updated[focused.index] = {
          ...updated[focused.index],
          proposed_details: newText,
          user_modified: true,
        }
        setDiff({ ...diff, skill_category_diffs: updated })
      } else if (focused.type === 'bullet' && focused.index !== undefined) {
        const updated = [...(diff.bullet_diffs || [])]
        updated[focused.index] = {
          ...updated[focused.index],
          proposed_text: newText,
          user_modified: true,
        }
        setDiff({ ...diff, bullet_diffs: updated })
      }

      showToast(`Injected "${keyword}" into active field!`)
    } else {
      navigator.clipboard.writeText(keyword)
      showToast(`Copied "${keyword}" to clipboard — paste into any field!`)
    }
  }

  // Promote an available bullet into active suggestions
  const handlePromoteBullet = (bullet: BulletDiff) => {
    const updatedAvailable = (diff.available_bullets || []).filter(
      (b) => !(b.entry_title === bullet.entry_title && b.bullet_index === bullet.bullet_index)
    )
    const newBullet: BulletDiff = {
      ...bullet,
      accepted: true,
      reason: 'User-selected custom customization',
      priority: 'high',
    }
    const newIndex = (diff.bullet_diffs || []).length
    setDiff({
      ...diff,
      bullet_diffs: [...(diff.bullet_diffs || []), newBullet],
      available_bullets: updatedAvailable,
    })
    setAcceptedBullets({ ...acceptedBullets, [newIndex]: true })
    showToast(`Added "${bullet.entry_title}" bullet to active suggestions!`)
  }

  // Promote an available skill category into active suggestions
  const handlePromoteSkill = (skill: SkillCategoryDiff) => {
    const updatedAvailable = (diff.available_skills || []).filter(
      (s) => s.category.toLowerCase() !== skill.category.toLowerCase()
    )
    const newSkill: SkillCategoryDiff = {
      ...skill,
      accepted: true,
      reason: 'User-selected skill category refinement',
      priority: 'high',
    }
    const newIndex = (diff.skill_category_diffs || []).length
    setDiff({
      ...diff,
      skill_category_diffs: [...(diff.skill_category_diffs || []), newSkill],
      available_skills: updatedAvailable,
    })
    setAcceptedSkills({ ...acceptedSkills, [newIndex]: true })
    showToast(`Added "${skill.category}" to active skill suggestions!`)
  }

  const unverifiedKeywords = diff.all_unverified_keywords || []
  const targetKeywords = diff.target_keywords || []

  // Global net character delta calculation across all proposed items vs originals
  let globalDelta = 0
  if (diff.headline_suggestion && acceptHeadline) {
    globalDelta += (diff.headline_suggestion.proposed?.length || 0) - (diff.headline_suggestion.original?.length || 0)
  }
  if (diff.summary_suggestion && acceptSummary) {
    globalDelta += (diff.summary_suggestion.proposed?.length || 0) - (diff.summary_suggestion.original?.length || 0)
  }
  for (let i = 0; i < (diff.skill_category_diffs || []).length; i++) {
    if (acceptedSkills[i]) {
      const sk = diff.skill_category_diffs[i]
      globalDelta += (sk.proposed_details?.length || 0) - (sk.original_details?.length || 0)
    }
  }
  for (let i = 0; i < (diff.bullet_diffs || []).length; i++) {
    if (acceptedBullets[i]) {
      const b = diff.bullet_diffs[i]
      globalDelta += (b.proposed_text?.length || 0) - (b.original_text?.length || 0)
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[96vw] xl:max-w-[1550px] h-[92vh] flex flex-col border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900">
                  Staged CV Keyword Tailoring & Live 1-Page Preview
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-violet-100 text-violet-800 border border-violet-200 uppercase">
                  {diff.language}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                  1-Page Layout Lock
                </span>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-bold border transition-all ${
                    globalDelta <= 120
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : globalDelta <= 250
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-rose-50 text-rose-800 border-rose-300'
                  }`}
                  title="Net character change compared to baseline CV. Auto-fit automatically squeezes spacing or compresses copy to fit."
                >
                  Net Budget: {globalDelta > 0 ? `+${globalDelta}` : globalDelta} chars
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Edit suggestions on the left — click "Refresh Preview" on the right to re-render the 1-page PDF.
              </p>
            </div>
          </div>

          <button
            onClick={handleCloseAndSaveDraft}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Split Body: Left (Editor) + Right (Live 1-Page Preview) */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Left Column: Tailoring Controls */}
          <div className="lg:col-span-7 overflow-y-auto p-6 space-y-6 border-r border-slate-200">
          {toastMsg && (
            <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs flex items-center gap-2 animate-in fade-in">
              <Check className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>{toastMsg}</span>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold block mb-0.5">
                  1-Page Verification or Render Error
                </strong>
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Keyword Quick-Inject Toolbar */}
          {((diff.topic_keywords && diff.topic_keywords.length > 0) || targetKeywords.length > 0) && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-violet-600" />
                  Target Keywords by Topic
                </span>
                <span className="text-[11px] text-slate-400">
                  Click any keyword to inject into active field
                </span>
              </div>

              {diff.topic_keywords && diff.topic_keywords.length > 0 ? (
                <div className="space-y-3">
                  {diff.topic_keywords.map((tk) => (
                    <div
                      key={tk.subject_ref}
                      className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-2.5 shadow-2xs"
                    >
                      {/* Topic Name & Reference on Top */}
                      <div className="border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {!isSyntheticRef(tk.subject_ref) && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono">
                              {tk.subject_ref}
                            </span>
                          )}
                          <span className="text-xs font-bold text-slate-900 leading-snug">
                            {tk.subject_title || tk.subject_ref}
                          </span>
                        </div>
                      </div>

                      {/* Keywords underneath */}
                      <div className="space-y-1.5 pt-0.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Keywords for this topic:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {tk.keywords.map((kw) => (
                            <button
                              key={kw}
                              type="button"
                              onClick={() => handleInjectKeyword(kw)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-50 hover:bg-violet-50 text-slate-800 hover:text-violet-700 border border-slate-200 hover:border-violet-300 transition-all cursor-pointer active:scale-95"
                              title={`Click to insert "${kw}" into active field`}
                            >
                              <Plus className="w-3 h-3 text-violet-500" />
                              <span>{kw}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-2.5 shadow-2xs">
                  <div className="border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded text-[11px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono">
                        {selectedSubjects.length > 0 ? selectedSubjects.join(', ') : 'Target Topic'}
                      </span>
                      <span className="text-xs font-bold text-slate-900 leading-snug">
                        Target Topic Keywords
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5 pt-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                      Keywords for this topic:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {targetKeywords.map((kw) => (
                        <button
                          key={kw}
                          type="button"
                          onClick={() => handleInjectKeyword(kw)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-50 hover:bg-violet-50 text-slate-800 hover:text-violet-700 border border-slate-200 hover:border-violet-300 transition-all cursor-pointer active:scale-95"
                          title={`Click to insert "${kw}" into active field`}
                        >
                          <Plus className="w-3 h-3 text-violet-500" />
                          <span>{kw}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section 1: Headline Suggestion */}
          {diff.headline_suggestion && (
            <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => toggleSection('headline')}
                  className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 hover:text-violet-700 transition-colors cursor-pointer"
                >
                  {collapsedSections['headline'] ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  )}
                  <span>Headline Suggestion</span>
                </button>
                <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={acceptHeadline}
                    onChange={(e) => setAcceptHeadline(e.target.checked)}
                    className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
                  />
                  <span>Apply Headline</span>
                </label>
              </div>

              {!collapsedSections['headline'] && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                    <span className="text-[11px] font-semibold text-slate-400 block mb-1">
                      CURRENT BASELINE
                    </span>
                    <p className="text-slate-700 font-medium">{diff.headline_suggestion.original}</p>
                  </div>

                  <div
                    className={`p-3 rounded-lg border transition-all ${
                      acceptHeadline
                        ? 'bg-violet-50/60 border-violet-300'
                        : 'bg-white border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-violet-700">
                        PROPOSED TAILORING (EDITABLE)
                      </span>
                      <div className="flex items-center gap-1.5">
                        {diff.headline_suggestion.user_modified && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-200">
                            Pinned (Edited)
                          </span>
                        )}
                        {(() => {
                          const delta =
                            diff.headline_suggestion.proposed.length -
                            diff.headline_suggestion.original.length
                          return (
                            <span
                              className={`text-[10px] font-mono px-1 rounded ${
                                delta > 20
                                  ? 'text-amber-700 bg-amber-50 font-bold'
                                  : delta < 0
                                  ? 'text-emerald-700 bg-emerald-50'
                                  : 'text-slate-500'
                              }`}
                            >
                              {delta > 0 ? `+${delta}` : delta} chars
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                    <textarea
                      value={diff.headline_suggestion.proposed}
                      onFocus={(e) => {
                        focusedInputRef.current = { element: e.target, type: 'headline' }
                      }}
                      onChange={(e) => {
                        if (!diff.headline_suggestion) return
                        setDiff({
                          ...diff,
                          headline_suggestion: {
                            ...diff.headline_suggestion,
                            proposed: e.target.value,
                            user_modified: true,
                          },
                        })
                      }}
                      rows={2}
                      className="w-full text-xs font-medium text-slate-900 bg-white border border-slate-200 rounded p-1.5 focus:ring-1 focus:ring-violet-500"
                    />
                    <span className="text-[11px] text-slate-500 mt-1 block italic">
                      Why: {diff.headline_suggestion.reason}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section 2: Summary Suggestion */}
          {diff.summary_suggestion && (
            <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => toggleSection('summary')}
                  className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 hover:text-violet-700 transition-colors cursor-pointer"
                >
                  {collapsedSections['summary'] ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  )}
                  <span>Summary Suggestion</span>
                </button>
                <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer text-slate-700">
                  <input
                    type="checkbox"
                    checked={acceptSummary}
                    onChange={(e) => setAcceptSummary(e.target.checked)}
                    className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
                  />
                  <span>Apply Summary</span>
                </label>
              </div>

              {!collapsedSections['summary'] && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
                  <div className="bg-white p-3 rounded-lg border border-slate-200">
                    <span className="text-[11px] font-semibold text-slate-400 block mb-1">
                      CURRENT BASELINE
                    </span>
                    <p className="text-slate-700 leading-relaxed">{diff.summary_suggestion.original}</p>
                  </div>

                  <div
                    className={`p-3 rounded-lg border transition-all ${
                      acceptSummary
                        ? 'bg-violet-50/60 border-violet-300'
                        : 'bg-white border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-violet-700">
                        PROPOSED TAILORING (EDITABLE)
                      </span>
                      <div className="flex items-center gap-1.5">
                        {diff.summary_suggestion.user_modified && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-200">
                            Pinned (Edited)
                          </span>
                        )}
                        {(() => {
                          const delta =
                            diff.summary_suggestion.proposed.length -
                            diff.summary_suggestion.original.length
                          return (
                            <span
                              className={`text-[10px] font-mono px-1 rounded ${
                                delta > 40
                                  ? 'text-amber-700 bg-amber-50 font-bold'
                                  : delta < 0
                                  ? 'text-emerald-700 bg-emerald-50'
                                  : 'text-slate-500'
                              }`}
                            >
                              {delta > 0 ? `+${delta}` : delta} chars
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                    <textarea
                      value={diff.summary_suggestion.proposed}
                      onFocus={(e) => {
                        focusedInputRef.current = { element: e.target, type: 'summary' }
                      }}
                      onChange={(e) => {
                        if (!diff.summary_suggestion) return
                        setDiff({
                          ...diff,
                          summary_suggestion: {
                            ...diff.summary_suggestion,
                            proposed: e.target.value,
                            user_modified: true,
                          },
                        })
                      }}
                      rows={3}
                      className="w-full text-xs text-slate-900 bg-white border border-slate-200 rounded p-1.5 focus:ring-1 focus:ring-violet-500 leading-relaxed"
                    />
                    <span className="text-[11px] text-slate-500 mt-1 block italic">
                      Why: {diff.summary_suggestion.reason}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section 3: Skills Diffs (All Editable) */}
          {diff.skill_category_diffs && diff.skill_category_diffs.length > 0 && (
            <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => toggleSection('skills')}
                  className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 hover:text-violet-700 transition-colors cursor-pointer"
                >
                  {collapsedSections['skills'] ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  )}
                  <span>Skills Category Adjustments ({diff.skill_category_diffs.length})</span>
                </button>
              </div>

              {!collapsedSections['skills'] && (
                <div className="space-y-2 pt-1">
                  {diff.skill_category_diffs.map((sk, idx) => {
                    const isAccepted = acceptedSkills[idx] ?? true
                    return (
                      <div
                        key={idx}
                        className={`p-3.5 rounded-xl border transition-all space-y-2 text-xs ${
                          isAccepted
                            ? 'bg-violet-50/40 border-violet-300'
                            : 'bg-white border-slate-200 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800 capitalize">
                              {sk.category}
                            </span>
                            {sk.priority && (
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                  sk.priority === 'high'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {sk.priority} priority
                              </span>
                            )}
                          </div>

                          <label className="flex items-center gap-1.5 font-semibold cursor-pointer text-slate-700">
                            <input
                              type="checkbox"
                              checked={isAccepted}
                              onChange={(e) =>
                                setAcceptedSkills({
                                  ...acceptedSkills,
                                  [idx]: e.target.checked,
                                })
                              }
                              className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
                            />
                            <span>Apply</span>
                          </label>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="bg-white p-2.5 rounded border border-slate-200">
                            <span className="text-[10px] text-slate-400 font-bold block mb-0.5">ORIGINAL</span>
                            <span className="text-slate-600">{sk.original_details}</span>
                          </div>
                          <div className="bg-white p-2.5 rounded border border-violet-200">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] text-violet-600 font-bold">
                                PROPOSED (EDITABLE)
                              </span>
                              <div className="flex items-center gap-1.5">
                                {sk.user_modified && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                    Pinned
                                  </span>
                                )}
                                {(() => {
                                  const delta = (sk.proposed_details?.length || 0) - (sk.original_details?.length || 0)
                                  return (
                                    <span
                                      className={`text-[10px] font-mono px-1 rounded ${
                                        delta > 25
                                          ? 'text-amber-700 bg-amber-50 font-bold'
                                          : delta < 0
                                          ? 'text-emerald-700 bg-emerald-50'
                                          : 'text-slate-500'
                                      }`}
                                    >
                                      {delta > 0 ? `+${delta}` : delta} chars
                                    </span>
                                  )
                                })()}
                              </div>
                            </div>
                            <textarea
                              value={sk.proposed_details}
                              onFocus={(e) => {
                                focusedInputRef.current = { element: e.target, type: 'skill', index: idx }
                              }}
                              onChange={(e) => {
                                const updated = [...(diff.skill_category_diffs || [])]
                                updated[idx] = {
                                  ...updated[idx],
                                  proposed_details: e.target.value,
                                  user_modified: true,
                                }
                                setDiff({ ...diff, skill_category_diffs: updated })
                              }}
                              rows={2}
                              className="w-full text-xs text-slate-900 bg-white border border-slate-200 rounded p-1.5 focus:ring-1 focus:ring-violet-500 font-medium"
                            />
                            <span className="text-[11px] text-slate-500 mt-1 block italic">
                              Why: {sk.reason}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Section 4: Bullet Swaps & Keyword Rewording (All Editable) */}
          {diff.bullet_diffs && diff.bullet_diffs.length > 0 && (
            <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => toggleSection('bullets')}
                  className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 hover:text-violet-700 transition-colors cursor-pointer"
                >
                  {collapsedSections['bullets'] ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  )}
                  <span>Experience & Project Bullet Refinements ({diff.bullet_diffs.length})</span>
                </button>
              </div>

              {!collapsedSections['bullets'] && (
                <div className="space-y-3 pt-1">
                  {diff.bullet_diffs.map((b, idx) => {
                    const isAccepted = acceptedBullets[idx] ?? true
                    return (
                      <div
                        key={idx}
                        className={`p-4 rounded-xl border transition-all text-xs space-y-2.5 ${
                          isAccepted
                            ? 'bg-violet-50/40 border-violet-300'
                            : 'bg-white border-slate-200 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200 capitalize">
                              {b.section}: {b.entry_title}
                            </span>
                            {b.priority && (
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                  b.priority === 'high'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {b.priority} priority
                              </span>
                            )}
                          </div>

                          <label className="flex items-center gap-1.5 font-semibold cursor-pointer text-slate-700">
                            <input
                              type="checkbox"
                              checked={isAccepted}
                              onChange={(e) =>
                                setAcceptedBullets({
                                  ...acceptedBullets,
                                  [idx]: e.target.checked,
                                })
                              }
                              className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
                            />
                            <span>Apply</span>
                          </label>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="bg-white p-3 rounded-lg border border-slate-200">
                            <span className="text-[11px] font-semibold text-slate-400 block mb-1">
                              ORIGINAL
                            </span>
                            <p className="text-slate-600 leading-relaxed">{b.original_text}</p>
                          </div>

                          <div className="bg-white p-3 rounded-lg border border-violet-200">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-semibold text-violet-700">
                                PROPOSED (EDITABLE)
                              </span>
                              <div className="flex items-center gap-1.5">
                                {b.user_modified && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                    Pinned
                                  </span>
                                )}
                                {(() => {
                                  const delta = (b.proposed_text?.length || 0) - (b.original_text?.length || 0)
                                  return (
                                    <span
                                      className={`text-[10px] font-mono px-1 rounded ${
                                        delta > 30
                                          ? 'text-amber-700 bg-amber-50 font-bold'
                                          : delta < 0
                                          ? 'text-emerald-700 bg-emerald-50'
                                          : 'text-slate-500'
                                      }`}
                                    >
                                      {delta > 0 ? `+${delta}` : delta} chars
                                    </span>
                                  )
                                })()}
                              </div>
                            </div>
                            <textarea
                              value={b.proposed_text}
                              onFocus={(e) => {
                                focusedInputRef.current = { element: e.target, type: 'bullet', index: idx }
                              }}
                              onChange={(e) => {
                                const updated = [...(diff.bullet_diffs || [])]
                                updated[idx] = {
                                  ...updated[idx],
                                  proposed_text: e.target.value,
                                  user_modified: true,
                                }
                                setDiff({ ...diff, bullet_diffs: updated })
                              }}
                              rows={3}
                              className="w-full text-xs text-slate-900 bg-white border border-slate-200 rounded p-1.5 focus:ring-1 focus:ring-violet-500 font-medium leading-relaxed"
                            />
                            <span className="text-[11px] text-slate-500 mt-1 block italic">
                              Why: {b.reason}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Section 5: More Places to Edit (by Priority) */}
          {((diff.available_bullets && diff.available_bullets.length > 0) ||
            (diff.available_skills && diff.available_skills.length > 0)) && (
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
              <button
                type="button"
                onClick={() => setShowMorePlaces(!showMorePlaces)}
                className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <span>
                  More Places to Edit in CV (
                  {(diff.available_bullets?.length || 0) + (diff.available_skills?.length || 0)} available
                  items)
                </span>
                {showMorePlaces ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {showMorePlaces && (
                <div className="p-4 border-t border-slate-200 bg-white space-y-4 text-xs">
                  {/* Available Skills */}
                  {diff.available_skills && diff.available_skills.length > 0 && (
                    <div className="space-y-2">
                      <span className="font-semibold text-slate-600 block uppercase text-[11px]">
                        Additional Skill Categories
                      </span>
                      {diff.available_skills.map((sk, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between gap-3"
                        >
                          <div>
                            <strong className="text-slate-800 block">{sk.category}</strong>
                            <p className="text-slate-600 text-[11px] line-clamp-1">
                              {sk.original_details}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handlePromoteSkill(sk)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors shrink-0 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Customize</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Available Bullets */}
                  {diff.available_bullets && diff.available_bullets.length > 0 && (
                    <div className="space-y-2">
                      <span className="font-semibold text-slate-600 block uppercase text-[11px]">
                        Additional Work & Project Bullets
                      </span>
                      {diff.available_bullets.map((b, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-200 text-slate-700 font-bold uppercase inline-block mb-0.5">
                              {b.section}: {b.entry_title}
                            </span>
                            <p className="text-slate-600 text-[11px] line-clamp-2">
                              {b.original_text}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handlePromoteBullet(b)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors shrink-0 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Customize</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Regenerate Prompt */}
          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center gap-3">
            <input
              type="text"
              placeholder="Refine suggestions with instructions (e.g. 'focus more on ETL and Power BI')..."
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              className="flex-1 text-xs bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:ring-1 focus:ring-violet-500"
            />
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
              <span>Regenerate</span>
            </button>
          </div>
          </div>

          {/* Right Column: Live 1-Page CV Preview */}
          <div className="lg:col-span-5 bg-slate-100 flex flex-col min-h-0 overflow-hidden">
            {/* Live Preview Sub-header */}
            <div className="px-4 py-2.5 bg-slate-200/70 border-b border-slate-200 flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center gap-2">
                <Eye className="w-3.5 h-3.5 text-violet-600" />
                <span className="font-bold text-slate-800">
                  Live 1-Page CV Preview ({diff.language.toUpperCase()})
                </span>
                {previewRendering ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Rendering...
                  </span>
                ) : previewOutdated ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full">
                    Unrendered edits — click Refresh
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                    <Check className="w-3 h-3" />
                    {previewPresetLevel > 0 ? `Auto-Fitted (Preset ${previewPresetLevel})` : '1-Page Synced'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => diff && triggerLivePreview(diff)}
                  disabled={previewRendering}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all ${
                    previewOutdated
                      ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-xs animate-pulse'
                      : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                  }`}
                  title="Render current edits into 1-page preview"
                >
                  <RefreshCw className={`w-3 h-3 ${previewRendering ? 'animate-spin' : ''}`} />
                  <span>Refresh Preview</span>
                </button>
                <a
                  href={`/data/applications/previews/app_${applicationId}/CV_Preview.pdf?t=${previewTimestamp}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold flex items-center gap-1 transition-colors"
                >
                  <FileDown className="w-3 h-3" />
                  <span>PDF</span>
                </a>
              </div>
            </div>

            {/* Scrollable Full-Page Preview Container */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-start">
              <div className="relative w-full max-w-[600px] bg-white rounded-lg shadow-lg border border-slate-300 overflow-hidden">
                {previewRendering && (
                  <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] z-10 flex items-center justify-center">
                    <div className="px-3 py-1.5 rounded-lg bg-slate-900/80 text-white text-xs font-semibold flex items-center gap-2 shadow-lg">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-violet-400" />
                      <span>Updating 1-page PDF...</span>
                    </div>
                  </div>
                )}
                <img
                  src={`/data/applications/previews/app_${applicationId}/CV_Preview.png?t=${previewTimestamp}`}
                  alt="Live 1-Page CV Preview"
                  className="w-full h-auto block"
                  onError={(e: any) => {
                    e.target.src = `/data/baseline/baseline_CV_${diff.language.toUpperCase()}.png`
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-white rounded-b-2xl flex items-center justify-between">
          <button
            onClick={handleCloseAndSaveDraft}
            className="px-4 py-2 text-xs font-semibold rounded-lg text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Save Draft & Close
          </button>

          <div className="flex items-center gap-3">
            {/* Truthful CV Guardrail Icon + Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowGuardrailPopup(!showGuardrailPopup)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                  unverifiedKeywords.length > 0 && !ignoreGuardrail
                    ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                    : 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                }`}
                title={
                  unverifiedKeywords.length > 0 && !ignoreGuardrail
                    ? `${unverifiedKeywords.length} unverified keywords detected. Click to review.`
                    : 'Truthful CV Guardrail: Verified or Ignored'
                }
              >
                {unverifiedKeywords.length > 0 && !ignoreGuardrail ? (
                  <>
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Guardrail ({unverifiedKeywords.length})</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Truthful Guardrail</span>
                  </>
                )}
              </button>

              {/* Popup right on top of warning icon */}
              {showGuardrailPopup && (
                <div className="absolute bottom-full right-0 mb-2 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-slate-200 p-4 z-50 text-xs space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-2">
                      {unverifiedKeywords.length > 0 && !ignoreGuardrail ? (
                        <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      )}
                      <h4 className="font-bold text-slate-900">
                        Truthful CV Guardrail
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowGuardrailPopup(false)}
                      className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {unverifiedKeywords.length > 0 ? (
                    <div className="space-y-2.5">
                      <p className="text-slate-600 leading-relaxed">
                        {unverifiedKeywords.length} keyword
                        {unverifiedKeywords.length > 1 ? 's do' : ' does'} not exist in your master profile (<code>master.{diff.language}.yaml</code>). Review before confirming:
                      </p>

                      <div className="flex items-center gap-1.5 flex-wrap max-h-32 overflow-y-auto p-1.5 bg-slate-50 rounded-lg border border-slate-100">
                        {Array.from(new Set(unverifiedKeywords)).map((kw) => (
                          <span
                            key={kw}
                            className="bg-amber-100 text-amber-900 font-mono text-[11px] px-2 py-0.5 rounded font-semibold border border-amber-300"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400">
                          {ignoreGuardrail ? 'Currently ignored' : 'Action required'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const nextState = !ignoreGuardrail
                            setIgnoreGuardrail(nextState)
                            if (nextState) {
                              setShowGuardrailPopup(false)
                              showToast('Guardrail warning ignored. Checkmark enabled.')
                            }
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            ignoreGuardrail
                              ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              : 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs'
                          }`}
                        >
                          {ignoreGuardrail ? 'Re-enable Warning' : 'Ignore Warning'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 text-slate-600">
                      <p className="flex items-center gap-1.5 text-emerald-700 font-medium">
                        <Check className="w-4 h-4 text-emerald-600" />
                        All suggested keywords exist in your master profile!
                      </p>
                      <p className="text-[11px] text-slate-400">
                        No hallucinated or unverified technical claims found.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={handleConfirm}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg bg-violet-600 hover:bg-violet-700 text-white shadow-xs transition-colors cursor-pointer active:scale-98"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying 1-Page Layout...</span>
                </>
              ) : (
                <>
                  <FileCheck2 className="w-3.5 h-3.5" />
                  <span>Confirm & Lock 1-Page Layout</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
