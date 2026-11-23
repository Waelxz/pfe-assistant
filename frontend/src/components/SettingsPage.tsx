import React, { useState, useEffect } from 'react'
import {
  Key,
  Save,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  PlugZap,
  Globe,
  Sliders,
} from 'lucide-react'
import { fetchSettings, updateSettings, testLLMConnection } from '../api'
import type { RuntimeSettings, ProviderPreset } from '../types'

export const GeminiKeyGuide: React.FC<{ defaultOpen?: boolean }> = ({ defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-bold text-indigo-900 hover:bg-indigo-100/60 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <Key className="w-3.5 h-3.5 text-indigo-600" />
          <span>How to get a free Google Gemini API key (Takes 1 min)</span>
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="px-4 pb-3.5 pt-1 text-xs text-indigo-950 space-y-2 border-t border-indigo-200/70">
          <ol className="list-decimal pl-4 space-y-1.5 leading-relaxed">
            <li>
              Open{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="font-bold text-indigo-700 underline inline-flex items-center gap-1"
              >
                Google AI Studio (API Keys) <ExternalLink className="w-3 h-3" />
              </a>{' '}
              and sign in with your Google account.
            </li>
            <li>
              Click <strong>Create API key</strong> (create a new project if prompted — the Free Tier requires no credit card).
            </li>
            <li>
              Copy the key starting with <code className="bg-white px-1 py-0.5 rounded border border-indigo-200">AIza...</code> and paste it below. Your key stays strictly on your computer in <code className="bg-white px-1 py-0.5 rounded border border-indigo-200">settings.json</code>.
            </li>
          </ol>
          <p className="text-[11px] text-indigo-700">
            Why Gemini? Gemini supports native PFE Book PDF reading (even scanned brochures) and generous free daily usage.
          </p>
        </div>
      )}
    </div>
  )
}

interface SettingsPageProps {
  onRefreshConfig: () => void
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ onRefreshConfig }) => {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showKey, setShowKey] = useState(false)

  // Form fields
  const [preset, setPreset] = useState('gemini')
  const [provider, setProvider] = useState<'gemini' | 'openai_compatible'>('gemini')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [fallbackModel, setFallbackModel] = useState('')
  const [modelExtract, setModelExtract] = useState('')
  const [modelMatch, setModelMatch] = useState('')
  const [modelDraft, setModelDraft] = useState('')
  const [modelTailor, setModelTailor] = useState('')
  const [enablePfebooksSync, setEnablePfebooksSync] = useState(true)

  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchSettings()
      .then((data) => {
        setSettings(data)
        setPreset(data.llm_provider_preset || 'gemini')
        setProvider(data.llm_provider || 'gemini')
        setApiKey(data.api_key_masked || '')
        setBaseUrl(data.llm_base_url || '')
        setModel(data.llm_model || 'gemini-3.5-flash')
        setFallbackModel(data.llm_fallback_model || 'gemini-3.5-flash-lite, gemini-3.8-flash')
        setModelExtract(data.llm_model_extract || '')
        setModelMatch(data.llm_model_match || '')
        setModelDraft(data.llm_model_draft || '')
        setModelTailor(data.llm_model_tailor || '')
        setEnablePfebooksSync(data.enable_pfebooks_sync ?? true)
      })
      .catch((err) => setStatusMsg({ type: 'error', text: err.message }))
      .finally(() => setLoading(false))
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setStatusMsg(null)
    try {
      const updated = await updateSettings({
        llm_provider_preset: preset,
        llm_provider: provider,
        llm_api_key: apiKey,
        llm_base_url: baseUrl,
        llm_model: model,
        llm_fallback_model: fallbackModel,
        llm_model_extract: modelExtract || null,
        llm_model_match: modelMatch || null,
        llm_model_draft: modelDraft || null,
        llm_model_tailor: modelTailor || null,
        enable_pfebooks_sync: enablePfebooksSync,
      })
      setSettings(updated)
      setApiKey(updated.api_key_masked || '')
      setStatusMsg({ type: 'success', text: 'Settings saved and LLM client reloaded.' })
      onRefreshConfig()
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to save settings' })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testLLMConnection({
        llm_provider: provider,
        llm_api_key: apiKey,
        llm_base_url: baseUrl,
        llm_model: model,
      })
      setTestResult({
        ok: true,
        text: `Connected (${res.provider} • ${res.model}) — reply: "${res.reply}"`,
      })
    } catch (err: any) {
      setTestResult({
        ok: false,
        text: err.message || 'Connection failed',
      })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <RefreshCw className="w-7 h-7 text-indigo-600 animate-spin mx-auto mb-2" />
        <p className="text-xs text-slate-500">Loading BYOK settings...</p>
      </div>
    )
  }

  const activePresetMeta = settings?.presets?.[preset]

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Settings & Bring Your Own Key (BYOK)</h1>
        <p className="text-xs text-slate-500 mt-1">
          Configure your own AI provider key and catalogue preferences. All credentials stay local on your machine.
        </p>
      </div>

      {statusMsg && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
              : 'bg-rose-50 border-rose-300 text-rose-800'
          }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        {/* AI Provider & Key Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-bold text-slate-900">AI Provider & API Key</h2>
            </div>
            {activePresetMeta?.docs_url && (
              <a
                href={activePresetMeta.docs_url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1"
              >
                Get API Key <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 block">Provider Preset</label>
            <select
              value={preset}
              onChange={(e) => handleSelectPreset(e.target.value)}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 font-medium cursor-pointer"
            >
              {Object.entries(settings?.presets || {}).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>

          {preset === 'gemini' && <GeminiKeyGuide defaultOpen={!settings?.api_key_configured} />}

          {preset !== 'ollama' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">
                API Key{' '}
                {settings?.api_key_configured && preset === settings.llm_provider_preset && (
                  <span className="text-emerald-600 font-normal">(configured)</span>
                )}
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={preset === 'gemini' ? 'AIza...' : 'sk-...'}
                  className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-9 py-2 text-slate-800 focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  title={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Leave the masked placeholder unchanged to keep your current key.
              </p>
            </div>
          )}

          {provider !== 'gemini' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">Base URL (OpenAI-compatible)</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">Primary Model</label>
              <input
                type="text"
                list={preset === 'gemini' ? 'gemini-model-suggestions' : undefined}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={preset === 'gemini' ? 'gemini-3.5-flash' : 'model-name'}
                className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">
                Fallback Models (comma-separated, tried in order)
              </label>
              <input
                type="text"
                list="gemini-model-suggestions"
                value={fallbackModel}
                onChange={(e) => setFallbackModel(e.target.value)}
                placeholder="gemini-3.5-flash-lite, gemini-3.8-flash"
                className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:ring-1 focus:ring-indigo-500"
              />
              {preset === 'gemini' && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[10px] text-slate-400">Quick add:</span>
                  {['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-lite-latest'].map(
                    (mName) => (
                      <button
                        key={mName}
                        type="button"
                        onClick={() => {
                          const existing = fallbackModel
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean)
                          if (!existing.includes(mName)) {
                            setFallbackModel([...existing, mName].join(', '))
                          }
                        }}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 font-mono border border-slate-200 cursor-pointer"
                      >
                        + {mName}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
            <datalist id="gemini-model-suggestions">
              <option value="gemini-3.5-flash" />
              <option value="gemini-3.5-flash-lite" />
              <option value="gemini-3.8-flash" />
              <option value="gemini-3.6-flash" />
              <option value="gemini-flash-latest" />
              <option value="gemini-flash-lite-latest" />
            </datalist>
          </div>

          {/* Test Connection Row */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5 text-indigo-600" />}
              <span>{testing ? 'Testing...' : 'Test Connection'}</span>
            </button>
            {testResult && (
              <span
                className={`text-xs font-medium flex items-center gap-1.5 ${
                  testResult.ok ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <span>{testResult.text}</span>
              </span>
            )}
          </div>

          {/* Advanced Per-Job Model Overrides */}
          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Advanced: Per-Job Model Overrides</span>
              {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100">
                {[
                  ['PDF Extraction Model', modelExtract, setModelExtract],
                  ['Profile Matching Model', modelMatch, setModelMatch],
                  ['Email & Letter Drafting Model', modelDraft, setModelDraft],
                  ['CV Tailoring Model', modelTailor, setModelTailor],
                ].map(([label, val, setter]: any) => (
                  <div key={label} className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-600 block">{label}</label>
                    <input
                      type="text"
                      value={val}
                      onChange={(e) => setter(e.target.value)}
                      placeholder={`Default (${model})`}
                      className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Catalogue Source Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 shadow-xs">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900">Catalogue Sources</h2>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enablePfebooksSync}
              onChange={(e) => setEnablePfebooksSync(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="text-xs">
              <span className="font-semibold text-slate-800 block">
                Enable pfebooks.com Tunisia Catalogue Sync
              </span>
              <span className="text-slate-500">
                Show the built-in Tunisia PFE Books sync button in the sidebar. Uncheck if you only upload your own company PDFs.
              </span>
            </div>
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{saving ? 'Saving...' : 'Save Settings'}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
