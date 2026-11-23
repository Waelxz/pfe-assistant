import React, { useState, useEffect } from 'react'
import {
  X,
  Upload,
  Trash2,
  FileText,
  AlertTriangle,
  FolderOpen,
  ExternalLink,
} from 'lucide-react'
import {
  fetchUserDocuments,
  uploadUserDocument,
  deleteUserDocument,
} from '../api'
import type { UserDocumentItem } from '../types'

interface DocumentsModalProps {
  onClose: () => void
}

export const DocumentsModal: React.FC<DocumentsModalProps> = ({ onClose }) => {
  const [docs, setDocs] = useState<UserDocumentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form states
  const [docType, setDocType] = useState('transcripts')
  const [label, setLabel] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const loadDocs = () => {
    setLoading(true)
    fetchUserDocuments()
      .then(setDocs)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadDocs()
  }, [])

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedFile || !label.trim()) return

    const formData = new FormData()
    formData.append('file', selectedFile)
    formData.append('doc_type', docType)
    formData.append('label', label.trim())

    try {
      setUploading(true)
      setError(null)
      await uploadUserDocument(formData)
      setLabel('')
      setSelectedFile(null)
      loadDocs()
    } catch (err: any) {
      setError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteUserDocument(id)
      setDocs(docs.filter((d) => d.id !== id))
    } catch (err: any) {
      setError(err.message || 'Failed to delete')
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col border border-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Reusable Documents Library
              </h2>
              <p className="text-xs text-slate-500">
                Upload your transcripts, diplomas, or letters once; they attach automatically.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Upload Form */}
          <form
            onSubmit={handleUpload}
            className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3 text-xs"
          >
            <span className="font-bold text-slate-800 block uppercase tracking-wider text-[11px]">
              Upload New Document
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-slate-600 font-medium block mb-1">
                  Document Type:
                </label>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2 text-slate-800"
                >
                  <option value="transcripts">Transcripts (Relevés)</option>
                  <option value="diploma">Diploma / Attestation</option>
                  <option value="recommendation">Recommendation Letter</option>
                  <option value="portfolio">Portfolio</option>
                  <option value="other">Other Document</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="text-slate-600 font-medium block mb-1">
                  Label / Description:
                </label>
                <input
                  type="text"
                  placeholder="e.g. Master 1 Transcripts"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                  className="w-full bg-white border border-slate-200 rounded-lg p-2 text-slate-800"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <input
                type="file"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                required
                className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
              />

              <button
                type="submit"
                disabled={uploading || !selectedFile || !label.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-xs flex items-center gap-1.5 shrink-0 transition-colors disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{uploading ? 'Uploading...' : 'Save Document'}</span>
              </button>
            </div>
          </form>

          {/* List of uploaded documents */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
              Uploaded Documents ({docs.length})
            </h3>

            {loading ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                Loading documents...
              </p>
            ) : docs.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center border border-dashed border-slate-200 rounded-xl">
                No documents uploaded yet. Add your transcripts or diplomas above.
              </p>
            ) : (
              <div className="space-y-2">
                {docs.map((d) => (
                  <div
                    key={d.id}
                    className="p-3 rounded-xl border border-slate-200 bg-white flex items-center justify-between text-xs hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                      <div>
                        <strong className="text-slate-800 block">
                          {d.label}
                        </strong>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {d.original_filename} • {d.doc_type}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <a
                        href={`/data/${d.storage_key}`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                        title="View / Download file"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <button
                        onClick={() => handleDelete(d.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="Delete document"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-white rounded-b-2xl flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
