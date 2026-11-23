import React, { useState, useEffect } from 'react'
import {
  BookOpen,
  Kanban,
  Upload,
  RefreshCw,
  Eye,
  FolderOpen,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Inbox,
  Building2,
  Archive,
  Menu,
  X,
  UserCheck,
  Settings,
  Plus,
  Trash2,
} from 'lucide-react'
import type { AppConfig, ListingSummary, ProfileSlot } from '../types'

export type CatalogueFilterMode =
  | 'all'
  | 'high_match'
  | 'applied'
  | 'untouched'
  | 'uploaded'
  | 'archived'

interface SidebarProps {
  config: AppConfig | null
  currentTab: 'catalogue' | 'tracker' | 'profile' | 'settings'
  onSelectTab: (tab: 'catalogue' | 'tracker' | 'profile' | 'settings') => void
  onNavigateHome: () => void
  workspaceListing: ListingSummary | null
  filterMode: CatalogueFilterMode
  onSelectFilterMode: (mode: CatalogueFilterMode) => void
  counts: {
    total: number
    highMatch: number
    untouched: number
    applied: number
    uploaded: number
    archived: number
  }
  onSync: () => void
  isSyncing: boolean
  onOpenUploadBook: () => void
  onOpenDocuments: () => void
  onOpenProfile: () => void
  trackedCount?: number
  profiles?: ProfileSlot[]
  onSwitchProfile?: (profileId: string) => void
  onOpenCreateProfile?: () => void
  onDeleteProfile?: (profileId: string) => void
  onOpenOnboarding?: () => void
}

export const Sidebar: React.FC<SidebarProps> = ({
  config,
  currentTab,
  onSelectTab,
  onNavigateHome,
  workspaceListing,
  filterMode,
  onSelectFilterMode,
  counts,
  onSync,
  isSyncing,
  onOpenUploadBook,
  onOpenDocuments,
  onOpenProfile,
  trackedCount = 0,
  profiles = [],
  onSwitchProfile,
  onOpenCreateProfile,
  onDeleteProfile,
  onOpenOnboarding,
}) => {
  const [confirmDeleteProfile, setConfirmDeleteProfile] = useState(false)
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('pfe_sidebar_collapsed') === 'true'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('pfe_sidebar_collapsed', String(next))
      } catch {}
      return next
    })
  }

  // Close mobile drawer on route / tab change
  useEffect(() => {
    setMobileOpen(false)
  }, [currentTab, workspaceListing])

  const navItems = [
    {
      id: 'catalogue' as const,
      label: 'Catalogue',
      icon: BookOpen,
      count: counts.total,
      onClick: () => {
        onNavigateHome()
      },
      isActive: currentTab === 'catalogue' && !workspaceListing,
    },
    {
      id: 'tracker' as const,
      label: 'Applications Tracker',
      icon: Kanban,
      count: trackedCount,
      onClick: () => {
        onSelectTab('tracker')
      },
      isActive: currentTab === 'tracker' && !workspaceListing,
    },
    {
      id: 'profile' as const,
      label: 'Profile & CV Studio',
      icon: UserCheck,
      count: undefined,
      onClick: () => {
        onSelectTab('profile')
      },
      isActive: currentTab === 'profile' && !workspaceListing,
    },
    {
      id: 'settings' as const,
      label: 'Settings & API Key',
      icon: Settings,
      count: undefined,
      onClick: () => {
        onSelectTab('settings')
      },
      isActive: currentTab === 'settings' && !workspaceListing,
    },
  ]

  const catalogueViews: {
    mode: CatalogueFilterMode
    label: string
    icon: React.ComponentType<{ className?: string }>
    count: number
    color?: string
  }[] = [
    { mode: 'all', label: 'All Listings', icon: Inbox, count: counts.total },
    {
      mode: 'high_match',
      label: 'High Fit (≥ 65%)',
      icon: Sparkles,
      count: counts.highMatch,
      color: 'text-emerald-600',
    },
    {
      mode: 'untouched',
      label: 'Untouched',
      icon: Inbox,
      count: counts.untouched,
    },
    {
      mode: 'applied',
      label: 'Applied',
      icon: CheckCircle2,
      count: counts.applied,
      color: 'text-violet-600',
    },
    ...(counts.uploaded > 0
      ? [
          {
            mode: 'uploaded' as CatalogueFilterMode,
            label: 'User Uploaded',
            icon: Upload,
            count: counts.uploaded,
            color: 'text-indigo-600',
          },
        ]
      : []),
    ...(counts.archived > 0
      ? [
          {
            mode: 'archived' as CatalogueFilterMode,
            label: 'Shelved',
            icon: Archive,
            count: counts.archived,
            color: 'text-amber-700',
          },
        ]
      : []),
  ]

  const sidebarContent = (
    <div className="flex flex-col h-full select-none">
      {/* Top Brand Header */}
      <div className="h-16 px-3.5 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
        <div
          onClick={onNavigateHome}
          className="flex items-center gap-2.5 cursor-pointer group min-w-0"
          title="Return to Catalogue"
        >
          <img
            src="/logo.svg"
            alt="PFE Assistant"
            className="w-9 h-9 rounded-xl shadow-xs shrink-0 group-hover:scale-105 transition-transform"
          />
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
                  PFE Assistant
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
                  26–27
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                {config?.candidate_institution || 'BYOK Local Workspace'}
              </p>
            </div>
          )}
        </div>

        {/* Desktop Collapse Toggle */}
        <button
          onClick={toggleCollapse}
          className="hidden md:flex p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>

        {/* Mobile Close Button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main Navigation Area */}
      <div className="flex-1 overflow-y-auto px-2.5 py-4 space-y-6">
        {/* Workspace Active Indicator */}
        {workspaceListing && (
          <div className="px-1">
            {!collapsed && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 block mb-1">
                Active Application
              </span>
            )}
            <div
              className={`p-2 rounded-xl bg-indigo-50/80 border border-indigo-200 text-indigo-900 flex items-center ${
                collapsed ? 'justify-center' : 'justify-between'
              } gap-2`}
              title={`Editing ${workspaceListing.company_name}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-4 h-4 text-indigo-600 shrink-0" />
                {!collapsed && (
                  <span className="text-xs font-semibold truncate">
                    {workspaceListing.company_name}
                  </span>
                )}
              </div>
              {!collapsed && (
                <button
                  onClick={onNavigateHome}
                  className="text-[11px] font-semibold text-indigo-600 hover:underline shrink-0"
                  title="Close workspace"
                >
                  Exit
                </button>
              )}
            </div>
          </div>
        )}

        {/* Primary Tabs */}
        <div>
          {!collapsed && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 block mb-1.5">
              Navigation
            </span>
          )}
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={item.onClick}
                  className={`w-full flex items-center ${
                    collapsed ? 'justify-center' : 'justify-between'
                  } px-2.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    item.isActive
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                  title={item.label}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </div>
                  {!collapsed && item.count !== undefined && item.count > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                        item.isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Indented Catalogue Views (only if on catalogue tab & expanded) */}
          {!collapsed && currentTab === 'catalogue' && !workspaceListing && (
            <div className="mt-2.5 ml-3 pl-2.5 border-l border-slate-200 space-y-1">
              {catalogueViews.map((cv) => {
                const Icon = cv.icon
                const isSelected = filterMode === cv.mode
                return (
                  <button
                    key={cv.mode}
                    onClick={() => onSelectFilterMode(cv.mode)}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-slate-200/80 text-slate-900 font-semibold'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${cv.color || 'text-slate-400'}`} />
                      <span className="truncate">{cv.label}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {cv.count}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Sources Section */}
        <div>
          {!collapsed && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 block mb-1.5">
              PFE Sources
            </span>
          )}
          <div className="space-y-1">
            <button
              onClick={onOpenUploadBook}
              className={`w-full flex items-center ${
                collapsed ? 'justify-center' : 'justify-start'
              } gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100/80 border border-indigo-200 transition-colors cursor-pointer`}
              title="Upload custom PFE Book PDF"
            >
              <Upload className="w-4 h-4 text-indigo-600 shrink-0" />
              {!collapsed && <span>Upload PFE Book</span>}
            </button>

            {config?.enable_pfebooks_sync !== false && (
              <button
                onClick={onSync}
                disabled={isSyncing}
                className={`w-full flex items-center ${
                  collapsed ? 'justify-center' : 'justify-start'
                } gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:text-indigo-600 hover:bg-slate-100 transition-colors disabled:opacity-50 cursor-pointer`}
                title={isSyncing ? 'Syncing catalogue...' : 'Sync pfebooks.com'}
              >
                <RefreshCw
                  className={`w-4 h-4 shrink-0 text-slate-500 ${isSyncing ? 'animate-spin text-indigo-600' : ''}`}
                />
                {!collapsed && <span>{isSyncing ? 'Syncing...' : 'Sync pfebooks'}</span>}
              </button>
            )}
          </div>
        </div>

        {/* Candidate Assets Section */}
        <div>
          {!collapsed && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 block mb-1.5">
              Candidate Assets
            </span>
          )}
          <div className="space-y-1">
            <button
              onClick={onOpenProfile}
              className={`w-full flex items-center ${
                collapsed ? 'justify-center' : 'justify-between'
              } px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:text-indigo-600 hover:bg-slate-100 transition-colors cursor-pointer`}
              title="Preview baseline 1-page EN & FR CVs"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Eye className="w-4 h-4 text-slate-500 shrink-0" />
                {!collapsed && <span className="truncate">Baseline CVs</span>}
              </div>
              {!collapsed && (
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  1-Page
                </span>
              )}
            </button>

            <button
              onClick={onOpenDocuments}
              className={`w-full flex items-center ${
                collapsed ? 'justify-center' : 'justify-start'
              } gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:text-indigo-600 hover:bg-slate-100 transition-colors cursor-pointer`}
              title="Manage transcripts, diplomas & letters"
            >
              <FolderOpen className="w-4 h-4 text-slate-500 shrink-0" />
              {!collapsed && <span>Docs Library</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar Footer: Candidate & Live LLM Status */}
      <div className="p-3 border-t border-slate-200 bg-slate-50/80 shrink-0">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2" title={`${config?.candidate_name || 'Candidate'} • ${config?.gemini_configured ? 'LLM Ready' : 'API Key Missing'}`}>
            <div
              className={`w-3 h-3 rounded-full ${
                config?.gemini_configured ? 'bg-emerald-500 ring-2 ring-emerald-200' : 'bg-amber-500'
              }`}
            />
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
        ) : (
          <div className="space-y-2">
            {/* Profile Switcher */}
            {profiles.length > 0 && onSwitchProfile && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <span>Active Profile</span>
                  {onOpenCreateProfile && (
                    <button
                      type="button"
                      onClick={onOpenCreateProfile}
                      className="text-indigo-600 hover:underline inline-flex items-center gap-0.5 normal-case font-semibold cursor-pointer"
                      title="Create new isolated profile"
                    >
                      <Plus className="w-3 h-3" />
                      <span>New</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <select
                    value={config?.active_profile_id || 'local-default'}
                    onChange={(e) => {
                      setConfirmDeleteProfile(false)
                      onSwitchProfile(e.target.value)
                    }}
                    className="flex-1 min-w-0 text-[11px] font-semibold bg-white border border-slate-200 rounded-lg px-2 py-1 text-slate-800 cursor-pointer"
                  >
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {profiles.length > 1 && onDeleteProfile && config?.active_profile_id && (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteProfile((prev) => !prev)}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                      title="Delete current profile"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {confirmDeleteProfile && config?.active_profile_id && onDeleteProfile && (
                  <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-[10px] text-rose-900 space-y-1.5">
                    <div className="font-semibold">
                      Delete this profile &amp; its scores/applications?
                    </div>
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteProfile(false)}
                        className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteProfile(false)
                          onDeleteProfile(config.active_profile_id!)
                        }}
                        className="px-2 py-0.5 rounded bg-rose-600 text-white font-semibold cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-slate-800 truncate max-w-[130px]" title={config?.candidate_name || 'Candidate'}>
                {config?.candidate_name || 'No CV yet'}
              </span>
              <div className="flex items-center gap-1 text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 shrink-0">
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                <span>1-Page Lock</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-200/60">
              <span className="text-slate-400">LLM Status</span>
              {config?.gemini_configured ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold truncate max-w-[135px]" title={config?.llm_model || 'LLM Ready'}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse shrink-0" />
                  <span className="truncate">{config?.llm_provider_preset === 'ollama' ? 'Ollama Ready' : 'API Ready'}</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectTab('settings')}
                  className="inline-flex items-center gap-1 text-amber-700 font-semibold hover:underline cursor-pointer"
                >
                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                  Add API Key
                </button>
              )}
            </div>

            {onOpenOnboarding && (
              <button
                type="button"
                onClick={onOpenOnboarding}
                className="w-full text-[10px] font-semibold text-indigo-600 hover:underline text-left pt-0.5 cursor-pointer"
              >
                Open Setup Wizard
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* Mobile Top App Bar */}
      <div className="md:hidden sticky top-0 z-40 bg-white border-b border-slate-200 px-4 h-14 flex items-center justify-between shadow-xs">
        <div
          onClick={onNavigateHome}
          className="flex items-center gap-2 cursor-pointer"
        >
          <img src="/logo.svg" alt="PFE Assistant" className="w-8 h-8 rounded-lg" />
          <span className="font-bold text-sm text-slate-900">PFE Assistant</span>
        </div>

        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer"
          title="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-72 bg-white h-full shadow-2xl flex flex-col"
          >
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Desktop Sticky Left Sidebar */}
      <aside
        className={`hidden md:flex flex-col sticky top-0 h-screen bg-white border-r border-slate-200 transition-all duration-200 shrink-0 z-30 ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  )
}
