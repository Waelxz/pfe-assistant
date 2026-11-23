import React, { useState, useEffect } from 'react'
import {
  Sparkles,
  Key,
  Upload,
  FileText,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  PlugZap,
  X,
  UserPlus,
} from 'lucide-react'
import { GeminiKeyGuide } from './SettingsPage'
import {
  fetchSettings,
  updateSettings,
  testLLMConnection,
  importProfilePdf,
  updateProfile,
  loadSampleProfile,
  translateProfile,
} from '../api'
import type { CandidateProfile, ProviderPreset, RuntimeSettings } from '../types'

interface OnboardingModalProps {
  onComplete: () => void
  onSkipToProfileStudio: () => void
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  onComplete,
  onSkipToProfileStudio,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [settings, setSettings] = useState<RuntimeSettings | null>(null)

  // Step 1: BYOK
  const [preset, setPreset] = useState('gemini')
  const [provider, setProvider] = useState<'gemini' | 'openai_compatible'>('gemini')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('gemini-3.5-flash')
  const [fallbackModel, setFallbackModel] = useState('gemini-3.5-flash-lite, gemini-3.8-flash')
  const [testing, setTesting] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  // Step 2: Profile
  const [importingPdf, setImportingPdf] = useState(false)
  const [loadingSample, setLoadingSample] = useState(false)
  const [importedProfile, setImportedProfile] = useState<CandidateProfile | null>(null)
  const [importedLang, setImportedLang] = useState<'en' | 'fr'>('en')
  const [targetRoles, setTargetRoles] = useState('Software Engineer, AI/ML Engineer, Data Engineer')
  const [techToLearn, setTechToLearn] = useState('Python, FastAPI, Docker, Cloud, Modern AI/Data Stack')
  const [dealbreakers, setDealbreakers] = useState('Manual data entry, non-technical support')
  const [profileErr, setProfileErr] = useState<string | null>(null)

  // Step 3: Optional Second Language Sync
  const [translating, setTranslating] = useState(false)
  const [translatedDone, setTranslatedDone] = useState(false)

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setSettings(s)
        setPreset(s.llm_provider_preset || 'gemini')
        setProvider(s.llm_provider || 'gemini')
        setApiKey(s.api_key_masked || '')
        setBaseUrl(s.llm_base_url || '')
        setModel(s.llm_model || 'gemini-3.5-flash')
        setFallbackModel(s.llm_fallback_model || 'gemini-3.5-flash-lite, gemini-3.8-flash')
        if (s.api_key_configured) {
          setTestResult({ ok: true, text: 'API key already configured.' })
        }
      })
      .catch(() => {})
  }, [])

  const handleSelectPreset = (key: string) => {
    setPreset(key)
    setTestResult(null)
    if (settings && key !== settings.llm_provider_preset) {
      setApiKey('')
    } else if (settings?.api_key_masked) {
      setApiKey(settings.api_key_masked)
    }
    const p: ProviderPreset | undefined = settings?.presets?.[key]
    if (!p) return
    setProvider(p.llm_provider)
    setBaseUrl(p.llm_base_url)
    setModel(p.llm_model)
    setFallbackModel(p.llm_fallback_model)
  }

  const persistStep1Settings = async () => {
    if (preset === 'ollama' || apiKey.trim()) {
      await updateSettings({
        llm_provider_preset: preset,
        llm_provider: provider,
        llm_api_key: preset === 'ollama' ? '' : apiKey,
        llm_base_url: baseUrl,
        llm_model: model,
        llm_fallback_model: fallbackModel,
      })
    }
  }

  const handleTestAndSaveKey = async (advance = false) => {
    setSavingKey(true)
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testLLMConnection({
        llm_provider: provider,
        llm_api_key: preset === 'ollama' ? '' : apiKey,
        llm_base_url: baseUrl,
        llm_model: model,
      })
      await persistStep1Settings()
      setTestResult({ ok: true, text: `Connected (${res.model})!` })
      if (advance) setStep(2)
    } catch (err: any) {
      setTestResult({ ok: false, text: err.message || 'Connection failed' })
    } finally {
      setSavingKey(false)
      setTesting(false)
    }
  }

  const handlePdfImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportingPdf(true)
    setProfileErr(null)
    try {
      await persistStep1Settings()
      const res = await importProfilePdf(file)
      const prof: CandidateProfile = {
        ...res.profile,
        career_goals: {
          target_roles: targetRoles,
          tech_to_learn: techToLearn,
          dealbreakers,
          pfe_priorities:
            res.profile.career_goals?.pfe_priorities ||
            'Real engineering depth, measurable thesis outcomes, pre-hiring potential',
        },
      }
      await updateProfile(res.detected_language, prof, true)
      setImportedProfile(prof)
      setImportedLang(res.detected_language)
      setStep(3)
    } catch (err: any) {
      setProfileErr(err.message || 'Failed to parse CV PDF. Check your API key or try Sample CV.')
    } finally {
      setImportingPdf(false)
      e.target.value = ''
    }
  }

  const handleUseSample = async () => {
    setLoadingSample(true)
    setProfileErr(null)
    try {
      await persistStep1Settings()
      await loadSampleProfile('both')
      await finishOnboarding()
    } catch (err: any) {
      setProfileErr(err.message || 'Failed to load sample CV')
    } finally {
      setLoadingSample(false)
    }
  }

  const handleTranslateSecondLang = async () => {
    if (!importedProfile) return
    const targetLang = importedLang === 'en' ? 'fr' : 'en'
    setTranslating(true)
    setProfileErr(null)
    try {
      await translateProfile({
        source_lang: importedLang,
        target_lang: targetLang,
        profile: importedProfile,
        auto_save: true,
      })
      setTranslatedDone(true)
    } catch (err: any) {
      setProfileErr(err.message || 'Translation failed — you can retry later in Profile & CV Studio.')
    } finally {
      setTranslating(false)
    }
  }

  const finishOnboarding = async () => {
    await updateSettings({ onboarding_completed: true }).catch(() => {})
    onComplete()
  }

  const handleSkip = async () => {
    await updateSettings({ onboarding_completed: true }).catch(() => {})
    onComplete()
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">Welcome to PFE Assistant (BYOK)</h2>
              <p className="text-xs text-indigo-100">
                Step {step} of 3 — Set up your local AI key & 1-page CV profile
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSkip}
            className="text-xs font-semibold text-white/80 hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <span>Skip for now</span>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="grid grid-cols-3 h-1 bg-slate-100">
          <div className="bg-indigo-600 transition-all" />
          <div className={`${step >= 2 ? 'bg-indigo-600' : 'bg-transparent'} transition-all`} />
          <div className={`${step >= 3 ? 'bg-indigo-600' : 'bg-transparent'} transition-all`} />
        </div>

        <div className="p-6 space-y-5">
          {step === 1 && (
            <>
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Key className="w-4 h-4 text-indigo-600" />
                  <span>1. Connect Your Own AI Key (Free Tier Works Great)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  This app runs 100% locally on your computer with zero subscription fees. Paste your own API key below.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 block">AI Provider</label>
                <select
                  value={preset}
                  onChange={(e) => handleSelectPreset(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium cursor-pointer"
                >
                  {Object.entries(settings?.presets || { gemini: { label: 'Google Gemini (Recommended)' } }).map(
                    ([k, meta]: any) => (
                      <option key={k} value={k}>
                        {meta.label}
                      </option>
                    )
                  )}
                </select>
              </div>

              {preset === 'gemini' && <GeminiKeyGuide defaultOpen />}

              {preset !== 'ollama' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 block">API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={preset === 'gemini' ? 'AIza...' : 'sk-...'}
                    className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              )}

              {provider !== 'gemini' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Base URL</label>
                    <input
                      type="text"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Model</label>
                    <input
                      type="text"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
                    />
                  </div>
                </div>
              )}

              {testResult && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                    testResult.ok
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>{testResult.text}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => handleTestAndSaveKey(false)}
                  disabled={savingKey || testing}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5 text-indigo-600" />}
                  <span>Test & Save Key</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await persistStep1Settings().catch(() => {})
                      setStep(2)
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Next: Your CV Profile</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-indigo-600" />
                  <span>2. Create Your Candidate CV Profile</span>
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Upload your existing CV PDF to extract everything automatically, or start with a sample / blank template.
                </p>
              </div>

              {/* Career Goals quick inputs */}
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-3.5 space-y-2.5 text-xs">
                <span className="font-bold text-slate-700 block">Target Roles & Preferences (for Match Scoring)</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">Target Roles</label>
                    <input
                      type="text"
                      value={targetRoles}
                      onChange={(e) => setTargetRoles(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">Tech You Want to Learn</label>
                    <input
                      type="text"
                      value={techToLearn}
                      onChange={(e) => setTechToLearn(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Dealbreakers (Topics to Penalize)</label>
                  <input
                    type="text"
                    value={dealbreakers}
                    onChange={(e) => setDealbreakers(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>

              {profileErr && (
                <div className="p-3 rounded-xl border bg-rose-50 border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{profileErr}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="p-4 rounded-xl border-2 border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100/70 cursor-pointer transition-colors text-center space-y-1.5">
                  {importingPdf ? (
                    <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin mx-auto" />
                  ) : (
                    <Upload className="w-6 h-6 text-indigo-600 mx-auto" />
                  )}
                  <span className="text-xs font-bold text-indigo-950 block">
                    {importingPdf ? 'Extracting CV...' : 'Upload Existing CV PDF'}
                  </span>
                  <span className="text-[11px] text-indigo-700 block">
                    AI parses & compiles 1-page CV
                  </span>
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={handlePdfImport}
                    disabled={importingPdf}
                  />
                </label>

                <button
                  type="button"
                  onClick={handleUseSample}
                  disabled={loadingSample}
                  className="p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors text-center space-y-1.5"
                >
                  {loadingSample ? (
                    <RefreshCw className="w-6 h-6 text-slate-600 animate-spin mx-auto" />
                  ) : (
                    <FileText className="w-6 h-6 text-slate-700 mx-auto" />
                  )}
                  <span className="text-xs font-bold text-slate-900 block">
                    {loadingSample ? 'Loading...' : 'Load Sample CV'}
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    Preview immediately with demo data
                  </span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    await updateSettings({ onboarding_completed: true }).catch(() => {})
                    onSkipToProfileStudio()
                  }}
                  className="p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors text-center space-y-1.5"
                >
                  <Sparkles className="w-6 h-6 text-violet-600 mx-auto" />
                  <span className="text-xs font-bold text-slate-900 block">Build in CV Studio</span>
                  <span className="text-[11px] text-slate-500 block">
                    Fill sections manually with live preview
                  </span>
                </button>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Back to API Key
                </button>
                <button
                  type="button"
                  onClick={handleSkip}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  Skip & Explore Catalogue
                </button>
              </div>
            </>
          )}

          {step === 3 && importedProfile && (
            <>
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-xs text-emerald-950 space-y-1">
                  <strong className="block text-sm">
                    Imported {importedProfile.basics.name}'s {importedLang.toUpperCase()} CV!
                  </strong>
                  <p className="text-emerald-800">
                    Compiled and locked to 1 page. You can work with a single language, or generate the{' '}
                    {importedLang === 'en' ? 'French (FR)' : 'English (EN)'} version now.
                  </p>
                </div>
              </div>

              {profileErr && (
                <div className="p-3 rounded-xl border bg-rose-50 border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{profileErr}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleTranslateSecondLang}
                  disabled={translating || translatedDone}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-violet-50 hover:bg-violet-100 text-violet-800 border border-violet-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {translating ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                  )}
                  <span>
                    {translatedDone
                      ? `${importedLang === 'en' ? 'FR' : 'EN'} Version Saved!`
                      : translating
                      ? 'Translating...'
                      : `Also Generate ${importedLang === 'en' ? 'FR' : 'EN'} CV with AI`}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={finishOnboarding}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Enter App</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
