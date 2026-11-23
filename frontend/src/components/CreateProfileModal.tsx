import React, { useState } from 'react'
import {
  UserPlus,
  Upload,
  FileText,
  Sparkles,
  X,
  RefreshCw,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react'
import {
  createProfile,
  importProfilePdf,
  updateProfile,
  loadSampleProfile,
} from '../api'

interface CreateProfileModalProps {
  geminiConfigured: boolean
  onClose: () => void
  onCreated: () => void
}

export const CreateProfileModal: React.FC<CreateProfileModalProps> = ({
  geminiConfigured,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('')
  const [startMode, setStartMode] = useState<'pdf' | 'sample' | 'blank'>(
    geminiConfigured ? 'pdf' : 'sample'
  )
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a profile name first.')
      return
    }
    if (startMode === 'pdf' && !pdfFile) {
      setError('Select a CV PDF to import, or choose Sample / Blank.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      setStatusText('Creating isolated profile...')
      await createProfile(trimmed, true)

      if (startMode === 'pdf' && pdfFile) {
        setStatusText('Extracting CV with AI...')
        const res = await importProfilePdf(pdfFile)
        setStatusText('Compiling 1-page CV...')
        await updateProfile(res.detected_language, res.profile)
      } else if (startMode === 'sample') {
        setStatusText('Loading 1-page sample CV...')
        await loadSampleProfile('both')
      }

      onCreated()
    } catch (err: any) {
      setError(err.message || 'Failed to create profile')
      setStatusText(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={() => !submitting && onClose()}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <UserPlus className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Create New Profile</h2>
              <p className="text-xs text-slate-500">
                Each profile keeps its own CV, match scores, and application tracker.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 disabled:opacity-40 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Profile Name */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
              Profile Name
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              placeholder='e.g. "AI & Data Science CV", "Full-Stack Track", or friend name'
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* Starting Point */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
              How would you like to start?
            </label>
            <div className="space-y-2.5">
              {/* Option 1: PDF Upload */}
              <label
                onClick={() => !submitting && setStartMode('pdf')}
                className={`block p-3.5 rounded-xl border transition-all cursor-pointer ${
                  startMode === 'pdf'
                    ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                } ${!geminiConfigured ? 'opacity-65' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700 shrink-0">
                    <Upload className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        Upload CV PDF (AI Auto-Fill)
                      </span>
                      {!geminiConfigured && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          Needs API Key
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Import your existing PDF and build an ATS-ready 1-page CV automatically.
                    </p>
                    {startMode === 'pdf' && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-indigo-300 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 cursor-pointer">
                          <FileText className="w-3.5 h-3.5" />
                          <span>{pdfFile ? pdfFile.name : 'Choose PDF file...'}</span>
                          <input
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            disabled={submitting}
                            onChange={(e) => {
                              const f = e.target.files?.[0] || null
                              setPdfFile(f)
                              setError(null)
                            }}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              </label>

              {/* Option 2: Sample CV */}
              <button
                type="button"
                disabled={submitting}
                onClick={() => setStartMode('sample')}
                className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                  startMode === 'sample'
                    ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700 shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Start from 1-Page Sample CV
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Pre-fills a ready EN &amp; FR engineering CV template you can edit right away.
                    </p>
                  </div>
                </div>
              </button>

              {/* Option 3: Blank */}
              <button
                type="button"
                disabled={submitting}
                onClick={() => setStartMode('blank')}
                className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                  startMode === 'blank'
                    ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-slate-100 text-slate-700 shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">Start Blank</div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Open an empty Profile &amp; CV Studio and fill in your sections manually.
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs disabled:opacity-60 cursor-pointer"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{statusText || 'Creating...'}</span>
                </>
              ) : (
                <>
                  <span>Create &amp; Open CV Studio</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
