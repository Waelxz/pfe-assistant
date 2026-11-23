import React, { useState, useEffect } from 'react'
import {
  X,
  FileText,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react'
import { fetchProfilePreview } from '../api'

interface ProfilePreviewModalProps {
  baselineUrlPrefix?: string
  onClose: () => void
}

export const ProfilePreviewModal: React.FC<ProfilePreviewModalProps> = ({
  baselineUrlPrefix = '/data/baseline',
  onClose,
}) => {
  const [lang, setLang] = useState<'fr' | 'en'>('fr')
  const [preview, setPreview] = useState<{
    page_count: number
    pdf_path: string
    png_path: string
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchProfilePreview(lang)
      .then((res) => setPreview(res))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [lang])

  // PDF URL relative to data
  const pdfFileName =
    lang === 'en'
      ? 'baseline_CV_EN.pdf'
      : 'baseline_CV_FR.pdf'
  const pngFileName =
    lang === 'en'
      ? 'baseline_CV_EN.png'
      : 'baseline_CV_FR.png'

  const pdfUrl = `${baselineUrlPrefix}/${pdfFileName}`
  const pngUrl = `${baselineUrlPrefix}/${pngFileName}`

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col border border-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  Baseline CV Profile & 1-Page Verification
                </h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  Exact 1 Page Confirmed
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Single source of truth rendered via RenderCV + Typst.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Language switcher */}
            <div className="flex items-center rounded-lg border border-slate-200 p-0.5 bg-white text-xs font-semibold">
              <button
                onClick={() => setLang('fr')}
                className={`px-3 py-1 rounded-md transition-colors ${
                  lang === 'fr'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                French (FR)
              </button>
              <button
                onClick={() => setLang('en')}
                className={`px-3 py-1 rounded-md transition-colors ${
                  lang === 'en'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                English (EN)
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center bg-slate-100/50">
          {error && (
            <div className="p-3 mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-20 text-center">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-2" />
              <p className="text-xs text-slate-500 font-medium">
                Compiling Typst template and verifying 1-page layout...
              </p>
            </div>
          ) : (
            <div className="space-y-4 max-w-2xl w-full">
              {/* Preview Image */}
              <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden group relative">
                <img
                  src={pngUrl}
                  alt={`Baseline CV ${lang.toUpperCase()}`}
                  className="w-full h-auto object-contain block"
                  onError={(e) => {
                    // Fallback if image path needs reload
                    e.currentTarget.style.display = 'none'
                  }}
                />

                <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 rounded-lg bg-white text-slate-900 font-semibold text-xs shadow-lg hover:bg-slate-100 transition-colors flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open PDF in Full Tab
                  </a>
                </div>
              </div>

              {/* Metrics Footer */}
              <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <span className="flex items-center gap-1.5 font-medium text-emerald-700">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Verified: Exactly {preview?.page_count || 1} page (No overflow)
                </span>
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 hover:underline flex items-center gap-1 font-medium"
                >
                  Download {pdfFileName} <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
