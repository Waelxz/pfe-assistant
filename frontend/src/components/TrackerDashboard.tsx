import React, { useState, useEffect, useMemo } from 'react'
import {
  Kanban,
  Table as TableIcon,
  ArrowRight,
  AlertCircle,
  Calendar,
  Search,
  RotateCcw,
} from 'lucide-react'
import { fetchApplications, updateApplicationStatus, deleteApplication } from '../api'
import { isSyntheticRef, type ApplicationListItem } from '../types'

interface TrackerDashboardProps {
  onOpenWorkspace: (listingId: number) => void
}

const PIPELINE_COLUMNS: {
  key: ApplicationListItem['status']
  label: string
  color: string
  badgeColor: string
}[] = [
  {
    key: 'drafted',
    label: 'Drafted',
    color: 'border-blue-300 bg-blue-50/40 text-blue-900',
    badgeColor: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  {
    key: 'opened_gmail',
    label: 'Opened in Gmail',
    color: 'border-amber-300 bg-amber-50/40 text-amber-900',
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  {
    key: 'sent',
    label: 'Sent (Applied)',
    color: 'border-emerald-300 bg-emerald-50/40 text-emerald-900',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  {
    key: 'interview',
    label: 'Interview',
    color: 'border-purple-300 bg-purple-50/40 text-purple-900',
    badgeColor: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  {
    key: 'rejected',
    label: 'Archived / Rejected',
    color: 'border-rose-300 bg-rose-50/40 text-rose-900',
    badgeColor: 'bg-rose-100 text-rose-800 border-rose-200',
  },
]

export const TrackerDashboard: React.FC<TrackerDashboardProps> = ({ onOpenWorkspace }) => {
  const [apps, setApps] = useState<ApplicationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [noteDraft, setNoteDraft] = useState('')

  // View mode: 'table' (ideal for 50+ volume) or 'kanban'
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>(() => {
    return (localStorage.getItem('pfe_tracker_view') as 'table' | 'kanban') || 'table'
  })

  // Filters & Sorting
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [langFilter, setLangFilter] = useState<'all' | 'fr' | 'en'>('all')
  const [sortField, setSortField] = useState<'updated_desc' | 'sent_desc' | 'name_asc'>('updated_desc')

  const handleSetViewMode = (mode: 'table' | 'kanban') => {
    setViewMode(mode)
    localStorage.setItem('pfe_tracker_view', mode)
  }

  const loadApps = () => {
    setLoading(true)
    fetchApplications()
      .then(setApps)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadApps()
  }, [])

  const handleStatusMove = async (appId: number, newStatus: ApplicationListItem['status']) => {
    try {
      await updateApplicationStatus(appId, newStatus)
      setApps((prev) =>
        prev.map((a) =>
          a.id === appId
            ? {
                ...a,
                status: newStatus,
                sent_at:
                  newStatus === 'sent' && !a.sent_at
                    ? new Date().toISOString()
                    : a.sent_at,
              }
            : a
        )
      )
    } catch (err: any) {
      setError(err.message || 'Failed to update status')
    }
  }

  const handleSaveNote = async (appId: number, currentStatus: ApplicationListItem['status']) => {
    try {
      await updateApplicationStatus(appId, currentStatus, noteDraft)
      setApps((prev) =>
        prev.map((a) => (a.id === appId ? { ...a, notes: noteDraft } : a))
      )
      setEditingNoteId(null)
    } catch (err: any) {
      setError(err.message || 'Failed to save note')
    }
  }

  const handleDeleteApp = async (appId: number, companyName: string) => {
    if (!window.confirm(`Remove application for ${companyName} from tracker?`)) return
    try {
      await deleteApplication(appId)
      setApps((prev) => prev.filter((a) => a.id !== appId))
    } catch (err: any) {
      setError(err.message || 'Failed to remove application')
    }
  }

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return '—'
    try {
      const d = new Date(iso)
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    } catch {
      return iso
    }
  }

  const isFollowUpDue = (sentAt: string | null | undefined, status: string) => {
    if (status !== 'sent' || !sentAt) return false
    try {
      const sentTime = new Date(sentAt).getTime()
      const now = new Date().getTime()
      const diffDays = (now - sentTime) / (1000 * 3600 * 24)
      return diffDays >= 7
    } catch {
      return false
    }
  }

  // Filtered & Sorted applications
  const filteredApps = useMemo(() => {
    return apps
      .filter((a) => {
        // Status filter
        if (statusFilter !== 'all' && a.status !== statusFilter) return false

        // Language filter
        if (langFilter !== 'all' && a.language !== langFilter) return false

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase()
          const nameMatch = a.company_name.toLowerCase().includes(q)
          const slugMatch = a.slug.toLowerCase().includes(q)
          const notesMatch = (a.notes || '').toLowerCase().includes(q)
          const refMatch = (a.selected_subject_refs || []).some((r) => r.toLowerCase().includes(q))
          if (!nameMatch && !slugMatch && !notesMatch && !refMatch) return false
        }

        return true
      })
      .sort((a, b) => {
        if (sortField === 'name_asc') {
          return a.company_name.localeCompare(b.company_name)
        }
        if (sortField === 'sent_desc') {
          const tA = a.sent_at ? new Date(a.sent_at).getTime() : 0
          const tB = b.sent_at ? new Date(b.sent_at).getTime() : 0
          return tB - tA
        }
        const uA = a.updated_at ? new Date(a.updated_at).getTime() : 0
        const uB = b.updated_at ? new Date(b.updated_at).getTime() : 0
        return uB - uA
      })
  }, [apps, statusFilter, langFilter, searchQuery, sortField])

  // Quick stats
  const total = apps.length
  const sentCount = apps.filter((a) => a.status === 'sent' || a.status === 'interview').length
  const interviewCount = apps.filter((a) => a.status === 'interview').length
  const rate = sentCount > 0 ? Math.round((interviewCount / sentCount) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
            Total Tracked
          </span>
          <span className="text-2xl font-bold text-slate-900 mt-1 block">
            {total}
          </span>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            Applications in pipeline
          </span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
            Sent / Applied
          </span>
          <span className="text-2xl font-bold text-emerald-600 mt-1 block">
            {sentCount}
          </span>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            Email or Form submitted
          </span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
            Interviews
          </span>
          <span className="text-2xl font-bold text-purple-600 mt-1 block">
            {interviewCount}
          </span>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            Invitations received
          </span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
            Response Rate
          </span>
          <span className="text-2xl font-bold text-indigo-600 mt-1 block">
            {rate}%
          </span>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            Interviews per sent
          </span>
        </div>
      </div>

      {/* Toolbar: Search, Filters, View Switcher */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search company, topic ref, notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            All ({total})
          </button>
          <button
            onClick={() => setStatusFilter('drafted')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              statusFilter === 'drafted'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Drafted
          </button>
          <button
            onClick={() => setStatusFilter('opened_gmail')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              statusFilter === 'opened_gmail'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Opened
          </button>
          <button
            onClick={() => setStatusFilter('sent')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              statusFilter === 'sent'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Sent
          </button>
          <button
            onClick={() => setStatusFilter('interview')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              statusFilter === 'interview'
                ? 'bg-purple-600 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Interview
          </button>
          <button
            onClick={() => setStatusFilter('rejected')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              statusFilter === 'rejected'
                ? 'bg-rose-600 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Rejected
          </button>
        </div>

        {/* Sort & View Mode Switcher */}
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={langFilter}
            onChange={(e: any) => setLangFilter(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            <option value="all">Lang: All</option>
            <option value="fr">Lang: FR</option>
            <option value="en">Lang: EN</option>
          </select>
          <select
            value={sortField}
            onChange={(e: any) => setSortField(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 cursor-pointer"
          >
            <option value="updated_desc">Sort: Recently Updated</option>
            <option value="sent_desc">Sort: Sent Date</option>
            <option value="name_asc">Sort: Company A–Z</option>
          </select>

          {/* Table / Kanban View Toggle */}
          <div className="flex items-center rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs font-semibold">
            <button
              onClick={() => handleSetViewMode('table')}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Compact Table View (Optimal for 50+ applications)"
            >
              <TableIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleSetViewMode('kanban')}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                viewMode === 'kanban'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Kanban Board View"
            >
              <Kanban className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Content: Table or Kanban */}
      {loading ? (
        <div className="py-20 text-center text-xs text-slate-400">
          Loading applications pipeline...
        </div>
      ) : apps.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-2xl border border-dashed border-slate-300 p-8">
          <Kanban className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-700 mb-1">
            Pipeline is empty
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Choose a listing from the Catalogue view and click "Apply Now" to draft your first application package.
          </p>
        </div>
      ) : filteredApps.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-2xl border border-dashed border-slate-200 p-8">
          <p className="text-xs text-slate-400">
            No applications match current filters. Try resetting search or status filters.
          </p>
        </div>
      ) : viewMode === 'table' ? (
        /* ================= HIGH-DENSITY TABLE VIEW (50+ VOL) ================= */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3 px-4">Company</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Topics</th>
                  <th className="py-3 px-3">Lang</th>
                  <th className="py-3 px-3">Sent Date</th>
                  <th className="py-3 px-3">Follow-Up Notes</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredApps.map((a) => {
                  const followUp = isFollowUpDue(a.sent_at, a.status)
                  return (
                    <tr
                      key={a.id}
                      className="hover:bg-slate-50/70 transition-colors group"
                    >
                      {/* Company Name */}
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        <div className="flex items-center gap-2">
                          <span
                            onClick={() => onOpenWorkspace(a.listing_id)}
                            className="hover:text-indigo-600 transition-colors cursor-pointer font-bold"
                          >
                            {a.company_name}
                          </span>
                          {followUp && (
                            <span
                              className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-300"
                              title="Application was sent >7 days ago. Consider following up!"
                            >
                              Follow-up Due
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono block">
                          {a.slug}
                        </span>
                      </td>

                      {/* Status Dropdown */}
                      <td className="py-3 px-3">
                        <select
                          value={a.status}
                          onChange={(e) => handleStatusMove(a.id, e.target.value as any)}
                          className={`text-[11px] font-bold rounded-md px-2 py-1 border cursor-pointer ${
                            a.status === 'sent'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : a.status === 'interview'
                              ? 'bg-purple-50 text-purple-800 border-purple-300'
                              : a.status === 'opened_gmail'
                              ? 'bg-amber-50 text-amber-800 border-amber-300'
                              : a.status === 'drafted'
                              ? 'bg-blue-50 text-blue-800 border-blue-300'
                              : 'bg-rose-50 text-rose-800 border-rose-300'
                          }`}
                        >
                          <option value="drafted">Drafted</option>
                          <option value="opened_gmail">Opened</option>
                          <option value="sent">Sent</option>
                          <option value="interview">Interview</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      </td>

                      {/* Targeted Topics */}
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {a.selected_subject_refs?.length > 0 ? (
                            a.selected_subject_refs.map((ref, idx) => {
                              const title = a.selected_subject_titles?.[idx]
                              const isSynth = isSyntheticRef(ref)
                              const label = isSynth && title
                                ? (title.length > 22 ? title.slice(0, 20) + '...' : title)
                                : ref
                              return (
                                <span
                                  key={ref}
                                  title={title || ref}
                                  className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 truncate max-w-[190px]"
                                >
                                  {label}
                                </span>
                              )
                            })
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">None</span>
                          )}
                        </div>
                      </td>

                      {/* Language & CV Lock */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded uppercase font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            {a.language}
                          </span>
                          {a.cv_diff_confirmed && (
                            <span
                              className="w-2 h-2 rounded-full bg-emerald-500"
                              title="Tailored CV confirmed and locked"
                            />
                          )}
                        </div>
                      </td>

                      {/* Sent Date */}
                      <td className="py-3 px-3 text-slate-500 font-mono text-[11px]">
                        {formatDate(a.sent_at)}
                      </td>

                      {/* Follow-up Notes */}
                      <td className="py-3 px-3 max-w-xs">
                        {editingNoteId === a.id ? (
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              placeholder="Follow-up notes..."
                              className="w-full text-[11px] p-1 bg-slate-50 border border-slate-200 rounded text-slate-800"
                            />
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => setEditingNoteId(null)}
                                className="text-[10px] px-1.5 py-0.5 rounded text-slate-500"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleSaveNote(a.id, a.status)}
                                className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 text-white font-semibold"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            onClick={() => {
                              setEditingNoteId(a.id)
                              setNoteDraft(a.notes || '')
                            }}
                            className="cursor-pointer text-[11px] text-slate-500 truncate hover:text-slate-800"
                            title={a.notes || 'Click to add follow-up notes'}
                          >
                            {a.notes ? `"${a.notes}"` : <span className="text-slate-400 italic">+ Add note</span>}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onOpenWorkspace(a.listing_id)}
                            className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-colors cursor-pointer"
                          >
                            Workspace
                          </button>
                          <button
                            onClick={() => handleDeleteApp(a.id, a.company_name)}
                            title="Remove from tracker"
                            className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ================= KANBAN BOARD VIEW ================= */
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-start">
          {PIPELINE_COLUMNS.map((col) => {
            const colApps = filteredApps.filter((a) => a.status === col.key)
            return (
              <div
                key={col.key}
                className="bg-slate-100/70 rounded-2xl p-3 border border-slate-200/80 flex flex-col min-h-[420px]"
              >
                {/* Column Header */}
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-200">
                  <span className="text-xs font-bold text-slate-800">
                    {col.label}
                  </span>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${col.badgeColor}`}
                  >
                    {colApps.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="space-y-3 flex-1 overflow-y-auto">
                  {colApps.map((a) => {
                    const followUp = isFollowUpDue(a.sent_at, a.status)
                    return (
                      <div
                        key={a.id}
                        className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs hover:shadow-sm hover:border-indigo-300 transition-all flex flex-col justify-between group"
                      >
                        <div className="space-y-2">
                          {/* Title & Lang & Date */}
                          <div className="flex items-start justify-between gap-1.5">
                            <h4
                              onClick={() => onOpenWorkspace(a.listing_id)}
                              className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors leading-tight line-clamp-2 cursor-pointer"
                            >
                              {a.company_name}
                            </h4>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded uppercase font-bold bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                              {a.language}
                            </span>
                          </div>

                          {a.sent_at && (
                            <div className="flex items-center gap-1 text-[10px] text-slate-400">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              <span>Sent {formatDate(a.sent_at)}</span>
                            </div>
                          )}

                          {followUp && (
                            <span className="inline-block px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-300">
                              Follow-up Due (&gt;7d)
                            </span>
                          )}

                          {/* Subject References */}
                          {a.selected_subject_refs?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {a.selected_subject_refs.map((ref, idx) => {
                                const title = a.selected_subject_titles?.[idx]
                                const isSynth = isSyntheticRef(ref)
                                const label = isSynth && title
                                  ? (title.length > 28 ? title.slice(0, 25) + '...' : title)
                                  : ref
                                return (
                                  <span
                                    key={ref}
                                    title={title || ref}
                                    className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 truncate max-w-[220px]"
                                  >
                                    {label}
                                  </span>
                                )
                              })}
                            </div>
                          )}

                          {/* Badges: Tailored CV / Cover letter */}
                          <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-slate-500">
                            {a.cv_diff_confirmed && (
                              <span className="px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                                Tailored CV (1p)
                              </span>
                            )}
                            {a.include_cover_letter && (
                              <span className="px-1.5 py-0.2 rounded bg-violet-50 text-violet-700 border border-violet-200 font-semibold">
                                Cover Letter
                              </span>
                            )}
                          </div>

                          {/* Notes */}
                          <div className="pt-1.5 border-t border-slate-100">
                            {editingNoteId === a.id ? (
                              <div className="space-y-1">
                                <textarea
                                  value={noteDraft}
                                  onChange={(e) => setNoteDraft(e.target.value)}
                                  placeholder="Add follow-up notes..."
                                  rows={2}
                                  className="w-full text-[11px] p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:ring-1 focus:ring-indigo-500"
                                />
                                <div className="flex justify-end gap-1">
                                  <button
                                    onClick={() => setEditingNoteId(null)}
                                    className="text-[10px] px-2 py-0.5 rounded text-slate-600 hover:bg-slate-100"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleSaveNote(a.id, a.status)}
                                    className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 text-white font-semibold"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div
                                onClick={() => {
                                  setEditingNoteId(a.id)
                                  setNoteDraft(a.notes || '')
                                }}
                                className="cursor-pointer text-[11px] text-slate-500 italic hover:text-slate-800 transition-colors"
                              >
                                {a.notes ? (
                                  <span className="not-italic text-slate-700 block line-clamp-2">
                                    "{a.notes}"
                                  </span>
                                ) : (
                                  <span>+ Add follow-up note</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Card Footer */}
                        <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-1 text-[11px]">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => onOpenWorkspace(a.listing_id)}
                              className="font-semibold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-0.5"
                            >
                              <span>Workspace</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteApp(a.id, a.company_name)}
                              title="Remove from tracker"
                              className="text-slate-400 hover:text-rose-600 p-0.5 transition-colors cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          </div>

                          <select
                            value={a.status}
                            onChange={(e) =>
                              handleStatusMove(a.id, e.target.value as any)
                            }
                            className="text-[10px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-slate-700 font-semibold cursor-pointer"
                          >
                            <option value="drafted">Drafted</option>
                            <option value="opened_gmail">Opened</option>
                            <option value="sent">Sent</option>
                            <option value="interview">Interview</option>
                            <option value="rejected">Rejected</option>
                          </select>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
