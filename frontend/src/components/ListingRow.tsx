import React from 'react'
import {
  Building2,
  Calendar,
  Mail,
  ExternalLink,
  BookOpen,
  CheckCircle2,
  Clock,
  Sparkles,
  Archive,
} from 'lucide-react'
import type { ListingSummary } from '../types'

interface ListingRowProps {
  listing: ListingSummary
  onSelect: (listing: ListingSummary) => void
  onDirectApply: (listing: ListingSummary) => void
  onToggleArchive: (listing: ListingSummary) => void
}

export const ListingRow: React.FC<ListingRowProps> = ({
  listing,
  onSelect,
  onDirectApply,
  onToggleArchive,
}) => {
  const score = listing.best_match_score

  const getScoreColor = (s: number | null) => {
    if (s === null) return 'bg-slate-100 text-slate-600 border-slate-200'
    if (s >= 75) return 'bg-emerald-50 text-emerald-800 border-emerald-300'
    if (s >= 55) return 'bg-amber-50 text-amber-800 border-amber-300'
    return 'bg-slate-50 text-slate-700 border-slate-300'
  }

  const getStatusBadge = () => {
    if (!listing.application_status) return null

    switch (listing.application_status) {
      case 'sent':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Applied
          </span>
        )
      case 'interview':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-300">
            Interview
          </span>
        )
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300">
            Rejected
          </span>
        )
      case 'drafted':
      case 'opened_gmail':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300">
            <Clock className="w-3 h-3 text-blue-600" />
            Draft
          </span>
        )
      default:
        return null
    }
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    } catch {
      return iso
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-xs transition-all duration-150 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 group">
      {/* Left: Company & Meta */}
      <div className="flex items-center gap-3.5 min-w-0 flex-1">
        <div
          onClick={() => onSelect(listing)}
          className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 shrink-0 group-hover:bg-indigo-50 group-hover:text-indigo-600 cursor-pointer transition-colors"
        >
          <Building2 className="w-5 h-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              onClick={() => onSelect(listing)}
              className="font-bold text-slate-900 group-hover:text-indigo-600 cursor-pointer transition-colors text-sm truncate hover:underline"
              title="Click to view book and select topics"
            >
              {listing.company_name}
            </h3>

            {getStatusBadge()}

            {listing.apply_method === 'form' ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">
                <ExternalLink className="w-3 h-3" />
                Form
              </span>
            ) : listing.apply_method === 'email' ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                <Mail className="w-3 h-3" />
                Email
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500 mt-1 flex-wrap">
            <span className="font-mono text-[11px] text-slate-400">
              {listing.slug}
            </span>

            <span className="text-slate-300">•</span>

            <span className="inline-flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5 text-slate-400" />
              <strong className="text-slate-700">
                {listing.subject_count > 0 ? `${listing.subject_count} topics` : 'PDF pending'}
              </strong>
            </span>

            {listing.deadline && (
              <>
                <span className="text-slate-300">•</span>
                <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                  <Calendar className="w-3.5 h-3.5 text-amber-500" />
                  Deadline: {listing.deadline}
                </span>
              </>
            )}

            <span className="text-slate-300">•</span>
            <span className="text-slate-400">{formatDate(listing.published_at)}</span>

            {listing.sync_status === 'extracted' && (
              <>
                <span className="text-slate-300">•</span>
                <span
                  className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 ring-2 ring-emerald-100 inline-block"
                  title="Extracted from PDF"
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right: Score & Actions */}
      <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
        {/* Match Score Badge */}
        <div
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border ${getScoreColor(
            score
          )}`}
          title={score !== null ? `Profile Match: ${score}%` : 'Not yet extracted'}
        >
          <Sparkles className="w-3 h-3" />
          <span>{score !== null ? `${score}%` : '—'}</span>
        </div>

        {/* View Book Button */}
        <button
          onClick={() => onSelect(listing)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition-colors"
        >
          View Book
        </button>

        {/* Apply / Open Button */}
        <button
          onClick={() => onDirectApply(listing)}
          className="text-xs font-semibold px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors"
        >
          {listing.application_status && listing.application_status !== 'archived'
            ? 'Open Workspace'
            : 'Apply Now'}
        </button>

        {/* Archive / Shelve Button */}
        <button
          onClick={() => onToggleArchive(listing)}
          title={listing.application_status === 'archived' ? 'Unarchive company' : 'Shelve / Archive company (hide from list)'}
          className={`p-1.5 rounded-lg border transition-colors ${
            listing.application_status === 'archived'
              ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
              : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100 border-slate-200'
          }`}
        >
          <Archive className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
