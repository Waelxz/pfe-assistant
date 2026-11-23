import { useState, useEffect, useMemo } from 'react'
import {
  Search,
  Inbox,
  RefreshCw,
  SlidersHorizontal,
  AlertTriangle,
} from 'lucide-react'
import { Sidebar, type CatalogueFilterMode } from './components/Sidebar'
import { SyncProgressBanner } from './components/SyncProgressBanner'
import { ListingCard } from './components/ListingCard'
import { ListingDetailDrawer } from './components/ListingDetailDrawer'
import { ApplicationWorkspace } from './components/ApplicationWorkspace'
import { DocumentsModal } from './components/DocumentsModal'
import { ProfilePreviewModal } from './components/ProfilePreviewModal'
import { TrackerDashboard } from './components/TrackerDashboard'
import { UploadPfeBookModal } from './components/UploadPfeBookModal'
import { ProfileBuilderPage } from './components/ProfileBuilderPage'
import { SettingsPage } from './components/SettingsPage'
import { OnboardingModal } from './components/OnboardingModal'
import { CreateProfileModal } from './components/CreateProfileModal'
import {
  fetchConfig,
  fetchListings,
  fetchProfiles,
  activateProfile,
  deleteProfile,
  triggerSync,
  archiveListing,
  deleteListing,
} from './api'
import type {
  AppConfig,
  ListingSummary,
  ProfileSlot,
  SyncProgressEvent,
} from './types'

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [profiles, setProfiles] = useState<ProfileSlot[]>([])
  const [listings, setListings] = useState<ListingSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)

  // SSE Sync State
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<SyncProgressEvent | null>(null)

  // Modals & Navigation
  const [currentTab, setCurrentTab] = useState<'catalogue' | 'tracker' | 'profile' | 'settings'>(() => {
    if (window.location.pathname === '/tracker') return 'tracker'
    if (window.location.pathname === '/profile') return 'profile'
    if (window.location.pathname === '/settings') return 'settings'
    return 'catalogue'
  })
  const [selectedDrawerListing, setSelectedDrawerListing] = useState<ListingSummary | null>(null)
  const [workspaceListing, setWorkspaceListing] = useState<ListingSummary | null>(null)
  const [workspaceSubjectRefs, setWorkspaceSubjectRefs] = useState<string[]>([])
  const [showDocumentsModal, setShowDocumentsModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showCreateProfileModal, setShowCreateProfileModal] = useState(false)

  // Navigate helper that keeps URL pathname in sync
  const navigateTo = (path: string, listing: ListingSummary | null = null, tab: 'catalogue' | 'tracker' | 'profile' | 'settings' = 'catalogue') => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path)
    }
    setWorkspaceListing(listing)
    setCurrentTab(tab)
  }

  // Sync browser Back/Forward buttons and initial URL route
  useEffect(() => {
    const syncFromUrl = (allListings: ListingSummary[]) => {
      const path = window.location.pathname
      if (path === '/tracker') {
        setWorkspaceListing(null)
        setCurrentTab('tracker')
      } else if (path === '/profile') {
        setWorkspaceListing(null)
        setCurrentTab('profile')
      } else if (path === '/settings') {
        setWorkspaceListing(null)
        setCurrentTab('settings')
      } else if (path.startsWith('/workspace/')) {
        const slug = decodeURIComponent(path.replace('/workspace/', '')).replace(/\/$/, '')
        const match = allListings.find((l) => l.slug === slug)
        if (match) {
          setWorkspaceListing(match)
        }
      } else {
        setWorkspaceListing(null)
        setCurrentTab('catalogue')
      }
    }

    syncFromUrl(listings)

    const onPopState = () => syncFromUrl(listings)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [listings])

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState<CatalogueFilterMode>('all')
  const [methodFilter, setMethodFilter] = useState<'all' | 'email' | 'form'>('all')
  const [sortMode, setSortMode] = useState<'match_desc' | 'date_desc'>('match_desc')

  // Load config, profiles & initial listings
  const loadData = () => {
    setLoading(true)
    Promise.all([fetchConfig(), fetchListings(), fetchProfiles()])
      .then(([cfg, list, profRes]) => {
        setConfig(cfg)
        setListings(list)
        setProfiles(profRes.profiles || [])
        if (!cfg.onboarding_completed && (!cfg.gemini_configured || !cfg.has_profile)) {
          setShowOnboarding(true)
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  const handleSwitchProfile = async (profileId: string) => {
    try {
      await activateProfile(profileId)
      setSelectedDrawerListing(null)
      navigateTo('/', null, currentTab === 'tracker' || currentTab === 'profile' || currentTab === 'settings' ? currentTab : 'catalogue')
      loadData()
    } catch (err: any) {
      setError(err.message || 'Failed to switch profile')
    }
  }

  const handleDeleteProfile = async (profileId: string) => {
    try {
      await deleteProfile(profileId)
      setSelectedDrawerListing(null)
      navigateTo('/', null, currentTab === 'tracker' || currentTab === 'profile' || currentTab === 'settings' ? currentTab : 'catalogue')
      loadData()
    } catch (err: any) {
      setError(err.message || 'Failed to delete profile')
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Trigger Sync & listen to SSE stream (open EventSource first to avoid race)
  const handleTriggerSync = async () => {
    try {
      setIsSyncing(true)
      const eventSource = new EventSource('/api/sync/stream')

      eventSource.onmessage = (event) => {
        try {
          const data: SyncProgressEvent & { had_error?: boolean } = JSON.parse(event.data)
          if (data.step === 'done') {
            eventSource.close()
            setIsSyncing(false)
            setSyncProgress((prev) => ({
              ...(prev || data),
              step: 'done',
              progress_pct: 100,
              had_error: data.had_error || prev?.step === 'error',
            }))
            fetchListings().then(setListings).catch(() => {})
          } else {
            setSyncProgress(data)
          }
        } catch (e) {
          console.error('SSE parse error:', e)
        }
      }

      eventSource.onerror = () => {
        eventSource.close()
        setIsSyncing(false)
        fetchListings().then(setListings).catch(() => {})
      }

      await triggerSync()
    } catch (err: any) {
      setError(err.message || 'Failed to start sync')
      setIsSyncing(false)
    }
  }

  // Filtered and Sorted Listings
  const filteredListings = useMemo(() => {
    return listings
      .filter((item) => {
        // Archived exclusion: unless in 'archived' filter mode, skip archived companies
        const isArchived = item.application_status === 'archived'
        if (filterMode === 'archived') {
          return isArchived
        }
        if (isArchived) {
          return false
        }

        // Method filter (orthogonal)
        if (methodFilter === 'email' && item.apply_method !== 'email') {
          return false
        }
        if (methodFilter === 'form' && item.apply_method !== 'form' && item.apply_method !== 'portal_link') {
          return false
        }

        // Search filter: company name, slug, location, categories, or tags
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase()
          const nameMatch = item.company_name.toLowerCase().includes(q)
          const slugMatch = item.slug.toLowerCase().includes(q)
          const locMatch = item.location ? item.location.toLowerCase().includes(q) : false
          const catMatch = item.categories ? item.categories.some((c) => c.toLowerCase().includes(q)) : false
          const tagMatch = item.tags ? item.tags.some((t) => t.toLowerCase().includes(q)) : false
          if (!nameMatch && !slugMatch && !locMatch && !catMatch && !tagMatch) return false
        }

        // Category / status filter
        if (filterMode === 'high_match') {
          return (item.best_match_score || 0) >= 65
        }
        if (filterMode === 'applied') {
          return (
            item.application_status !== null &&
            item.application_status !== 'archived' &&
            item.application_status !== 'new'
          )
        }
        if (filterMode === 'untouched') {
          return item.application_status === null || item.application_status === 'new'
        }
        if (filterMode === 'uploaded') {
          return item.wp_post_id < 0
        }

        return true
      })
      .sort((a, b) => {
        if (sortMode === 'match_desc') {
          const scoreA = a.best_match_score ?? -1
          const scoreB = b.best_match_score ?? -1
          if (scoreB !== scoreA) return scoreB - scoreA
        }
        // Fallback to published date
        const dateA = a.published_at ? new Date(a.published_at).getTime() : 0
        const dateB = b.published_at ? new Date(b.published_at).getTime() : 0
        return dateB - dateA
      })
  }, [listings, searchQuery, filterMode, methodFilter, sortMode])

  // Stats calculation
  const totalListings = listings.filter((l) => l.application_status !== 'archived').length
  const archivedCount = listings.filter((l) => l.application_status === 'archived').length
  const extractedCount = listings.filter((l) => l.sync_status === 'extracted' && l.application_status !== 'archived').length
  const highMatchCount = listings.filter((l) => (l.best_match_score || 0) >= 65 && l.application_status !== 'archived').length
  const appliedCount = listings.filter((l) => l.application_status !== null && l.application_status !== 'archived' && l.application_status !== 'new').length
  const untouchedCount = listings.filter((l) => l.application_status === null || l.application_status === 'new').length
  const uploadedCount = listings.filter((l) => l.wp_post_id < 0 && l.application_status !== 'archived').length

  const handleToggleArchive = async (listing: ListingSummary) => {
    const isArchived = listing.application_status === 'archived'
    try {
      await archiveListing(listing.id, !isArchived)
      setListings((prev) =>
        prev.map((item) =>
          item.id === listing.id
            ? { ...item, application_status: !isArchived ? 'archived' : null }
            : item
        )
      )
    } catch (err: any) {
      setError(err.message || 'Failed to archive company')
    }
  }

  const handleDeleteUploadedListing = async (listing: ListingSummary) => {
    if (!window.confirm(`Delete custom uploaded book "${listing.company_name}"?`)) return
    try {
      await deleteListing(listing.id)
      setListings((prev) => prev.filter((item) => item.id !== listing.id))
      if (selectedDrawerListing?.id === listing.id) {
        setSelectedDrawerListing(null)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete listing')
    }
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Left Navigation Sidebar */}
      <Sidebar
        config={config}
        currentTab={currentTab}
        onSelectTab={(tab) => {
          const routeMap = {
            catalogue: '/',
            tracker: '/tracker',
            profile: '/profile',
            settings: '/settings',
          }
          navigateTo(routeMap[tab], null, tab)
        }}
        onNavigateHome={() => {
          navigateTo('/', null, 'catalogue')
        }}
        workspaceListing={workspaceListing}
        filterMode={filterMode}
        onSelectFilterMode={(mode) => setFilterMode(mode)}
        counts={{
          total: totalListings,
          highMatch: highMatchCount,
          untouched: untouchedCount,
          applied: appliedCount,
          uploaded: uploadedCount,
          archived: archivedCount,
        }}
        onSync={handleTriggerSync}
        isSyncing={isSyncing}
        onOpenUploadBook={() => setShowUploadModal(true)}
        onOpenDocuments={() => setShowDocumentsModal(true)}
        onOpenProfile={() => navigateTo('/profile', null, 'profile')}
        trackedCount={appliedCount}
        profiles={profiles}
        onSwitchProfile={handleSwitchProfile}
        onOpenCreateProfile={() => setShowCreateProfileModal(true)}
        onDeleteProfile={handleDeleteProfile}
        onOpenOnboarding={() => setShowOnboarding(true)}
      />

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* Real-time Sync Progress Banner */}
        <SyncProgressBanner
          progress={syncProgress}
          onDismiss={() => setSyncProgress(null)}
        />

        {error && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 w-full">
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Main View Router */}
        <main className="flex-1">
          {workspaceListing ? (
            <ApplicationWorkspace
              key={`${config?.active_profile_id || 'default'}:${workspaceListing.id}`}
              listing={workspaceListing}
              initialSubjectRefs={workspaceSubjectRefs}
              candidateName={config?.candidate_name}
              candidateEmail={config?.candidate_email}
              activeProfileId={config?.active_profile_id}
              availableLanguages={config?.available_languages}
              baselineUrlPrefix={config?.baseline_url_prefix}
              onBack={() => navigateTo(currentTab === 'tracker' ? '/tracker' : (currentTab === 'profile' ? '/profile' : '/'), null, currentTab)}
              onStatusChanged={() => {
                fetchListings().then(setListings).catch(() => {})
              }}
            />
          ) : currentTab === 'profile' ? (
            <ProfileBuilderPage
              config={config}
              onRefreshConfig={loadData}
            />
          ) : currentTab === 'settings' ? (
            <SettingsPage
              onRefreshConfig={() => {
                fetchConfig().then(setConfig).catch(() => {})
              }}
            />
          ) : currentTab === 'tracker' ? (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <TrackerDashboard
                key={config?.active_profile_id || 'default'}
                onStatusChanged={() => {
                  fetchListings().then(setListings).catch(() => {})
                }}
                onOpenWorkspace={(listingId) => {
                  const target = listings.find((l) => l.id === listingId)
                  if (target) {
                    setWorkspaceSubjectRefs([])
                    navigateTo(`/workspace/${target.slug}`, target, 'tracker')
                  }
                }}
              />
            </div>
          ) : (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
              {/* Interactive Top KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div
                  onClick={() => setFilterMode('all')}
                  className={`bg-white rounded-xl border p-4 shadow-xs cursor-pointer transition-all hover:border-indigo-300 ${
                    filterMode === 'all'
                      ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                      : 'border-slate-200'
                  }`}
                  title="Click to view all listings"
                >
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                    Total Listings
                  </span>
                  <span className="text-2xl font-bold text-slate-900 mt-1 block">
                    {totalListings}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-0.5 block">
                    Catalogue 2026–2027
                  </span>
                </div>

                <div
                  onClick={() => setFilterMode('all')}
                  className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs"
                >
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                    Extracted &amp; Scored
                  </span>
                  <span className="text-2xl font-bold text-indigo-600 mt-1 block">
                    {extractedCount}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-0.5 block">
                    Structured PDF items
                  </span>
                </div>

                <div
                  onClick={() => setFilterMode('high_match')}
                  className={`bg-white rounded-xl border p-4 shadow-xs cursor-pointer transition-all hover:border-emerald-300 ${
                    filterMode === 'high_match'
                      ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                      : 'border-slate-200'
                  }`}
                  title="Click to filter high fit (≥ 65%)"
                >
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                    High Fit (≥ 65%)
                  </span>
                  <span className="text-2xl font-bold text-emerald-600 mt-1 block">
                    {highMatchCount}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-0.5 block">
                    Matched to your profile
                  </span>
                </div>

                <div
                  onClick={() => setFilterMode('applied')}
                  className={`bg-white rounded-xl border p-4 shadow-xs cursor-pointer transition-all hover:border-violet-300 ${
                    filterMode === 'applied'
                      ? 'border-violet-500 ring-2 ring-violet-500/20'
                      : 'border-slate-200'
                  }`}
                  title="Click to filter drafted or sent applications"
                >
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                    Applications
                  </span>
                  <span className="text-2xl font-bold text-violet-600 mt-1 block">
                    {appliedCount}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-0.5 block">
                    Drafted or Sent
                  </span>
                </div>
              </div>

              {/* Clean 1-Line Search & Method Toolbar */}
              <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Search input */}
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search company, tech tag, location, domain..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex items-center gap-2.5 shrink-0 flex-wrap sm:flex-nowrap">
                  {/* Method Segmented Control */}
                  <div className="flex items-center rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs font-semibold">
                    <button
                      onClick={() => setMethodFilter('all')}
                      className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                        methodFilter === 'all'
                          ? 'bg-white text-indigo-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      All Methods
                    </button>
                    <button
                      onClick={() => setMethodFilter('email')}
                      className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                        methodFilter === 'email'
                          ? 'bg-white text-indigo-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Email
                    </button>
                    <button
                      onClick={() => setMethodFilter('form')}
                      className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                        methodFilter === 'form'
                          ? 'bg-white text-indigo-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Online Form
                    </button>
                  </div>

                  {/* Sort Selector */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                    <select
                      value={sortMode}
                      onChange={(e: any) => setSortMode(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 cursor-pointer"
                    >
                      <option value="match_desc">Sort: Best Match Score</option>
                      <option value="date_desc">Sort: Date Published</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Listings Grid */}
              {loading ? (
                <div className="py-24 text-center">
                  <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-2" />
                  <p className="text-xs text-slate-500 font-medium">
                    Loading 2026–2027 PFE Book listings...
                  </p>
                </div>
              ) : listings.length === 0 ? (
                <div className="py-16 text-center bg-white rounded-2xl border border-dashed border-slate-300 p-8 space-y-4">
                  <Inbox className="w-12 h-12 text-indigo-300 mx-auto" />
                  <div>
                    <h3 className="text-base font-bold text-slate-800">
                      Your PFE Books catalogue is empty
                    </h3>
                    <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                      Sync the 2026–2027 PFE Books catalogue or upload any company&apos;s PFE Book PDF to extract topics and rank them against your CV.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-1 flex-wrap">
                    {config?.enable_pfebooks_sync !== false && (
                      <button
                        type="button"
                        onClick={handleTriggerSync}
                        disabled={isSyncing}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs disabled:opacity-50 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                        <span>{isSyncing ? 'Syncing PFE Books...' : 'Sync PFE Books (2026–2027)'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowUploadModal(true)}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs cursor-pointer"
                    >
                      <span>Upload PFE Book PDF</span>
                    </button>
                  </div>
                </div>
              ) : filteredListings.length === 0 ? (
                <div className="py-20 text-center bg-white rounded-2xl border border-dashed border-slate-300 p-8">
                  <Inbox className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <h3 className="text-sm font-bold text-slate-700 mb-1">
                    No listings found
                  </h3>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    Try adjusting your search query or select another filter view from the sidebar.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filteredListings.map((item) => (
                    <ListingCard
                      key={item.id}
                      listing={item}
                      onSelect={(l) => {
                        setWorkspaceSubjectRefs([])
                        setSelectedDrawerListing(l)
                      }}
                      onDirectApply={(l) => {
                        setWorkspaceSubjectRefs([])
                        navigateTo(`/workspace/${l.slug}`, l, 'catalogue')
                      }}
                      onToggleArchive={handleToggleArchive}
                      onDeleteUploaded={handleDeleteUploadedListing}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Modals & Drawers */}
      {selectedDrawerListing && (
        <ListingDetailDrawer
          listing={selectedDrawerListing}
          onClose={() => {
            setSelectedDrawerListing(null)
          }}
          onListingUpdated={() => {
            fetchListings().then(setListings).catch(() => {})
          }}
          onDraftWithSubjects={(l, refs) => {
            setSelectedDrawerListing(null)
            setWorkspaceSubjectRefs(refs)
            navigateTo(`/workspace/${l.slug}`, l, 'catalogue')
          }}
        />
      )}

      {showDocumentsModal && (
        <DocumentsModal onClose={() => setShowDocumentsModal(false)} />
      )}

      {showProfileModal && (
        <ProfilePreviewModal
          baselineUrlPrefix={config?.baseline_url_prefix}
          onClose={() => setShowProfileModal(false)}
        />
      )}

      {showUploadModal && (
        <UploadPfeBookModal
          geminiConfigured={Boolean(config?.gemini_configured)}
          onClose={() => setShowUploadModal(false)}
          onUploaded={(newListing) => {
            setShowUploadModal(false)
            setListings((prev) => {
              const filtered = prev.filter((item) => item.id !== newListing.id)
              return [newListing, ...filtered]
            })
            setSelectedDrawerListing(newListing)
          }}
        />
      )}

      {showOnboarding && (
        <OnboardingModal
          onComplete={() => {
            setShowOnboarding(false)
            loadData()
          }}
          onSkipToProfileStudio={() => {
            setShowOnboarding(false)
            loadData()
            navigateTo('/profile', null, 'profile')
          }}
        />
      )}

      {showCreateProfileModal && (
        <CreateProfileModal
          geminiConfigured={Boolean(config?.gemini_configured)}
          onClose={() => setShowCreateProfileModal(false)}
          onCreated={() => {
            setShowCreateProfileModal(false)
            setWorkspaceListing(null)
            setSelectedDrawerListing(null)
            loadData()
            navigateTo('/profile', null, 'profile')
          }}
        />
      )}
    </div>
  )
}

export default App
