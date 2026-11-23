import React from 'react'
import { Loader2, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'
import type { SyncProgressEvent } from '../types'

interface SyncProgressBannerProps {
  progress: SyncProgressEvent | null
  onDismiss: () => void
}

export const SyncProgressBanner: React.FC<SyncProgressBannerProps> = ({
  progress,
  onDismiss,
}) => {
  if (!progress) return null

  const isError = progress.step === 'error' || Boolean((progress as any).had_error)
  const isComplete = progress.step === 'done'
  const pct = typeof progress.progress_pct === 'number' ? progress.progress_pct : isComplete ? 100 : 5

  return (
    <div
      className={`text-white px-4 py-3 shadow-md border-b ${
        isError
          ? 'bg-gradient-to-r from-rose-900 via-rose-800 to-slate-900 border-rose-700/50'
          : 'bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 border-indigo-700/50'
      }`}
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        {/* Status text */}
        <div className="flex items-center gap-2.5">
          {isError ? (
            <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0" />
          ) : isComplete ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <Loader2 className="w-4 h-4 text-indigo-300 animate-spin shrink-0" />
          )}

          <div>
            <div className="font-semibold flex items-center gap-1.5">
              <span>
                {isError
                  ? 'Sync Finished with Errors'
                  : isComplete
                  ? 'Sync Complete'
                  : progress.step === 'fetch_posts'
                  ? 'Fetching Listings from pfebooks.com...'
                  : progress.step === 'download_pdf'
                  ? 'Downloading PFE Book PDFs...'
                  : progress.step === 'extract'
                  ? 'AI PDF Extraction & Scoring...'
                  : 'Syncing PFE Catalogues...'}
              </span>
              {progress.listing_slug && (
                <span className="text-indigo-200 font-mono bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-700/50">
                  {progress.listing_slug}
                </span>
              )}
            </div>
            {progress.message && (
              <p className="text-slate-300 text-[11px] mt-0.5">
                {progress.message}
              </p>
            )}
          </div>
        </div>

        {/* Progress Bar & Dismiss */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-full sm:w-48 bg-indigo-950/80 rounded-full h-2 overflow-hidden border border-indigo-700/60">
            <div
              className={`h-full transition-all duration-300 ${
                isError
                  ? 'bg-rose-400'
                  : isComplete
                  ? 'bg-emerald-400'
                  : 'bg-gradient-to-r from-indigo-400 to-violet-400'
              }`}
              style={{ width: `${Math.max(5, pct)}%` }}
            />
          </div>
          <span className="font-mono font-medium text-indigo-200 shrink-0 min-w-[36px] text-right">
            {pct}%
          </span>
          {(isComplete || isError) && (
            <button
              onClick={onDismiss}
              className="text-indigo-200 hover:text-white font-medium hover:underline text-xs flex items-center gap-1 shrink-0 ml-1 cursor-pointer"
            >
              Dismiss <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
