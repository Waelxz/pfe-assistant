import React, { useState } from 'react'
import {
  X,
  Upload,
  FileText,
  AlertTriangle,
  Sparkles,
  Building2,
  MapPin,
  Link as LinkIcon,
  RefreshCw,
} from 'lucide-react'
import { uploadPfeBook } from '../api'
import type { ListingSummary } from '../types'

interface UploadPfeBookModalProps {
  geminiConfigured: boolean
  onClose: () => void
  onUploaded: (listing: ListingSummary) => void
}

function guessCompanyFromFilename(filename: string): string {
  const stem = filename.replace(/\.pdf$/i, '')
  const cleaned = stem
    .replace(/[_\-]+/g, ' ')
    .replace(/\b(pfe|book|catalogue|stage|stages|2025|2026|2027)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || stem
}

export const UploadPfeBookModal: React.FC<UploadPfeBookModalProps> = ({
  geminiConfigured,
  onClose,
  onUploaded,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [location, setLocation] = useState('')
  const [postUrl, setPostUrl] = useState('')
  const [extractNow, setExtractNow] = useState(geminiConfigured)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFileChange = (file: File | null) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setError('Please select or drop a valid PDF file.')
      return
    }
    setSelectedFile(file)
    setError(null)
    if (!companyName.trim()) {
      setCompanyName(guessCompanyFromFilename(file.name))
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!submitting) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (submitting) return

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      handleFileChange(files[0])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedFile) return

    const formData = new FormData()
    formData.append('file', selectedFile)
    formData.append('company_name', companyName.trim())
    formData.append('location', location.trim())
    formData.append('post_url', postUrl.trim())
    formData.append('extract_now', String(extractNow))

    try {
      setSubmitting(true)
      setError(null)
      const res = await uploadPfeBook(formData)
      onUploaded(res.listing)
    } catch (err: any) {
      setError(err.message || 'Failed to upload PFE Book')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={() => !submitting && onClose()}
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col border border-slate-200 animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Upload Custom PFE Book
              </h2>
              <p className="text-xs text-slate-500">
                Add any company PFE Book PDF directly to your catalogue via drag-and-drop or file picker.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-xs">
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Drag & Drop PDF Zone */}
          <div>
            <label className="text-slate-700 font-semibold block mb-1.5">
              PFE Book PDF <span className="text-rose-500">*</span>
            </label>
            <div
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-6 transition-all duration-200 text-center ${
                isDragging
                  ? 'border-indigo-600 bg-indigo-50/80 ring-4 ring-indigo-500/20 scale-[1.01]'
                  : selectedFile
                  ? 'border-emerald-300 bg-emerald-50/30 hover:border-emerald-400'
                  : 'border-slate-300 bg-slate-50/70 hover:border-indigo-400 hover:bg-indigo-50/30'
              }`}
            >
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                disabled={submitting}
                id="pfe-upload-input"
                className="hidden"
              />

              {isDragging ? (
                <div className="py-2 space-y-1">
                  <Upload className="w-10 h-10 text-indigo-600 mx-auto animate-bounce" />
                  <span className="font-bold text-sm text-indigo-700 block">
                    Drop your PFE Book PDF here
                  </span>
                  <span className="text-[11px] text-indigo-500 block">
                    Release to select this file
                  </span>
                </div>
              ) : selectedFile ? (
                <div className="space-y-2 py-1 w-full max-w-md">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-xs">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-800 text-sm block truncate">
                      {selectedFile.name}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono block mt-0.5">
                      {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • PDF Ready
                    </span>
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-1">
                    <label
                      htmlFor="pfe-upload-input"
                      className="text-indigo-600 hover:text-indigo-800 hover:underline font-semibold cursor-pointer text-xs"
                    >
                      Choose another file
                    </label>
                    <span className="text-slate-300">•</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null)
                        setCompanyName('')
                      }}
                      className="text-rose-600 hover:text-rose-800 hover:underline font-semibold cursor-pointer text-xs"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <label htmlFor="pfe-upload-input" className="cursor-pointer space-y-1.5 py-2 block w-full">
                  <Upload className="w-8 h-8 text-indigo-600 mx-auto mb-1" />
                  <span className="font-bold text-slate-800 text-sm block">
                    Drag and drop your PFE Book PDF here
                  </span>
                  <p className="text-[11px] text-slate-500">
                    or <span className="text-indigo-600 font-semibold underline">browse from your computer</span>
                  </p>
                  <span className="text-[10px] text-slate-400 block pt-0.5">
                    Supports any standard PFE Book or internship catalogue (.pdf)
                  </span>
                </label>
              )}
            </div>
          </div>

          {/* Company Name */}
          <div>
            <label className="text-slate-700 font-semibold flex items-center gap-1.5 mb-1">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <span>Company Name</span>
              <span className="text-[11px] font-normal text-slate-400">
                (auto-detected from filename or extracted by AI)
              </span>
            </label>
            <input
              type="text"
              placeholder="e.g. Vermeg, Instadeep, Sofrecom..."
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={submitting}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 focus:ring-1 focus:ring-indigo-500 text-xs"
            />
          </div>

          {/* Location & Source URL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-slate-700 font-semibold flex items-center gap-1.5 mb-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                <span>Location (Optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Tunis, Lac 1"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled={submitting}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 focus:ring-1 focus:ring-indigo-500 text-xs"
              />
            </div>

            <div>
              <label className="text-slate-700 font-semibold flex items-center gap-1.5 mb-1">
                <LinkIcon className="w-3.5 h-3.5 text-slate-400" />
                <span>Source URL (Optional)</span>
              </label>
              <input
                type="url"
                placeholder="https://linkedin.com/posts/..."
                value={postUrl}
                onChange={(e) => setPostUrl(e.target.value)}
                disabled={submitting}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 focus:ring-1 focus:ring-indigo-500 text-xs"
              />
            </div>
          </div>

          {/* Immediate Extraction Toggle */}
          <label className="flex items-start gap-2.5 p-3.5 rounded-xl border border-indigo-100 bg-indigo-50/50 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={extractNow}
              onChange={(e) => setExtractNow(e.target.checked)}
              disabled={submitting}
              className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
            />
            <div>
              <span className="font-semibold text-slate-800 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                Extract subjects & score profile match immediately
              </span>
              <span className="text-[11px] text-slate-500 block mt-0.5">
                Uses Gemini to parse all internship topics, application rules, and calculate profile compatibility scores right away.
              </span>
            </div>
          </label>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !selectedFile}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>
                    {extractNow ? 'Uploading & Extracting...' : 'Uploading PDF...'}
                  </span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  <span>{extractNow ? 'Upload & Extract' : 'Add to Catalogue'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
