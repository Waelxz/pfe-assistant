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
  MapPin,
  Upload,
  Trash2,
} from 'lucide-react'
import type { ListingSummary } from '../types'

interface ListingCardProps {
  listing: ListingSummary
  onSelect: (listing: ListingSummary) => void
  onDirectApply: (listing: ListingSummary) => void
  onToggleArchive: (listing: ListingSummary) => void
  onDeleteUploaded?: (listing: ListingSummary) => void
}

export const ListingCard: React.FC<ListingCardProps> = ({
  listing,
  onSelect,
  onDirectApply,
  onToggleArchive,
  onDeleteUploaded,
}) => {
  const score = listing.best_match_score

  const getScoreColor = (s: number | null) => {
    if (s === null) return 'bg-slate-100 text-slate-600 border-slate-200'
    if (s >= 75) return 'bg-emerald-50 text-emerald-800 border-emerald-300'
    if (s >= 55) return 'bg-amber-50 text-amber-800 border-amber-300'
    return 'bg-slate-50 text-slate-700 border-slate-300'
  }

  const getStatusBadge = () => {
    if (!listing.application_status || listing.application_status === 'new' || listing.application_status === 'archived') {
      return null
    }

    switch (listing.application_status) {
      case 'sent':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Applied (Sent)
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
            Draft in Progress
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
    <div className="bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all duration-200 p-5 flex flex-col justify-between group">
      <div>
        {/* Top Badges Row */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {getStatusBadge()}
            {listing.location && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 max-w-[190px]"
                title={listing.location}
              >
                <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                <span className="truncate">{listing.location}</span>
              </span>
            )}
            {listing.apply_method === 'form' ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">
                <ExternalLink className="w-3 h-3" />
                Online Form
              </span>
            ) : listing.apply_method === 'email' ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                <Mail className="w-3 h-3" />
                Email
              </span>
            ) : null}

            {listing.deadline && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                <Calendar className="w-3 h-3" />
                {listing.deadline}
              </span>
            )}
          </div>

          {/* Match Score Badge */}
          <div
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border shrink-0 ${getScoreColor(
              score
            )}`}
            title={score !== null ? `Profile Match: ${score}%` : 'Not yet extracted'}
          >
            <Sparkles className="w-3 h-3" />
            <span>{score !== null ? `${score}%` : '—'}</span>
          </div>
        </div>

        {/* Company Title */}
        <div
          onClick={() => onDirectApply(listing)}
          className="flex items-start gap-2.5 cursor-pointer group/title"
          title="Click to open application workspace"
        >
          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 shrink-0 group-hover/title:bg-indigo-50 group-hover/title:text-indigo-600 transition-colors">
            <Building2 className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="font-semibold text-slate-900 group-hover/title:text-indigo-600 transition-colors text-base truncate">
                {listing.company_name}
              </h3>
              {listing.wp_post_id < 0 && (
                <span
                  className="inline-flex items-center justify-center p-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0"
                  title="User uploaded PFE book"
                >
                  <Upload className="w-3 h-3" />
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 font-mono truncate">
              {listing.slug}
            </p>
          </div>
        </div>

        {/* Domain Categories & Tech Tags */}
        {((listing.categories && listing.categories.length > 0) || (listing.tags && listing.tags.length > 0)) && (
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            {listing.categories
              ?.filter((cat) => cat.toLowerCase() !== 'user uploaded')
              .slice(0, 2)
              .map((cat) => (
                <span
                  key={cat}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-50/70 text-indigo-700 border border-indigo-100"
                >
                  {cat}
                </span>
              ))}
            {listing.tags?.slice(0, 2).map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"
              >
                #{t}
              </span>
            ))}
          </div>
        )}

        {/* Subjects & Catalogue Meta */}
        <div className="mt-3.5 flex items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <BookOpen className="w-3.5 h-3.5 text-slate-400" />
            <strong className="text-slate-700">
              {listing.subject_count > 0 ? `${listing.subject_count} subjects` : 'PDF pending'}
            </strong>
            {listing.data_source === 'html_preview' && listing.sync_status !== 'extracted' && (
              <span className="text-[10px] text-slate-400 font-normal">
                (preview)
              </span>
            )}
          </span>

          <span className="text-slate-300">•</span>

          <span className="text-slate-500">
            {formatDate(listing.published_at)}
          </span>

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

      {/* Action Buttons */}
      <div className="mt-5 pt-3.5 border-t border-slate-100 flex items-center justify-between gap-2">
        <button
          onClick={() => onSelect(listing)}
          className="text-xs font-semibold text-slate-700 hover:text-indigo-600 hover:underline transition-colors cursor-pointer"
        >
          View Book & Subjects
        </button>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onDirectApply(listing)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors cursor-pointer active:scale-98"
          >
            {listing.application_status && listing.application_status !== 'archived' && listing.application_status !== 'new'
              ? 'Open Workspace'
              : 'Apply Now'}
          </button>

          <button
            onClick={() => onToggleArchive(listing)}
            title={listing.application_status === 'archived' ? 'Unarchive company' : 'Shelve / Archive company (hide from list)'}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              listing.application_status === 'archived'
                ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100 border-slate-200'
            }`}
          >
            <Archive className="w-4 h-4" />
          </button>

          {listing.wp_post_id < 0 && onDeleteUploaded && (
            <button
              onClick={() => onDeleteUploaded(listing)}
              title="Delete user-uploaded PFE book"
              className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
