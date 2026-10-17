"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, Inbox, Search, ShieldAlert, SlidersHorizontal } from "lucide-react"
import { FindLeagueCard } from "@/components/discovery/FindLeagueCard"
import { DiscoveryRail, DiscoveryRailSkeleton } from "@/components/find-league/DiscoveryRail"
import { getDiscoverySports } from "@/lib/public-discovery/discovery-sports"
import type { DiscoveryRail as DiscoveryRailDTO } from "@/lib/matchmaking"
import type {
  DiscoveryCard,
  DiscoverySort,
  EntryFeeFilter,
  LeagueStyleFilter,
  VisibilityFilter,
  DraftTypeFilter,
  DraftStatusFilter,
} from "@/lib/public-discovery/types"

type RecsStatus = 'ok' | 'no-snapshot' | 'anonymous' | 'empty' | 'error'

function SmartDiscoverySection({ sport }: { sport: string }) {
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<RecsStatus | null>(null)
  const [rails, setRails] = useState<DiscoveryRailDTO[]>([])
  const telemetryFiredRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    telemetryFiredRef.current = false
    setLoading(true)
    setRails([])
    setStatus(null)

    const params = new URLSearchParams()
    if (sport) params.set("sport", sport)
    params.set("limit", "5")

    fetch(`/api/find-league/recommendations?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setStatus(d.status ?? "error")
        setRails(Array.isArray(d.rails) ? d.rails : [])
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setStatus("error")
        setRails([])
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [sport])

  useEffect(() => {
    if (loading || telemetryFiredRef.current || rails.length === 0) return
    telemetryFiredRef.current = true
    for (const rail of rails) {
      fetch("/api/find-league/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "recommendation_viewed", railKind: rail.kind }),
      }).catch(() => {})
    }
  }, [loading, rails])

  if (loading) {
    return (
      <div className="space-y-8">
        <DiscoveryRailSkeleton />
        <DiscoveryRailSkeleton />
      </div>
    )
  }

  if (status === "anonymous") {
    return (
      <div
        className="rounded-xl border border-dashed p-5 text-center"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
          Sign in to see personalized league recommendations
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          Matchmaking uses your fantasy resume to surface leagues where you&apos;ll thrive.
        </p>
      </div>
    )
  }

  if (status === "no-snapshot") {
    return (
      <div
        className="rounded-xl border border-dashed p-5 text-center"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
          Complete your fantasy resume to get personalized picks
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          Personalized recommendations need a profile snapshot to score league fit.
        </p>
      </div>
    )
  }

  if (rails.length === 0) return null

  return (
    <div className="space-y-8">
      {rails.map((rail) => (
        <DiscoveryRail
          key={rail.kind}
          rail={rail}
          buildHref={(id) => `/league/${id}`}
        />
      ))}
    </div>
  )
}

const SPORT_LABELS: Record<string, string> = {
  NFL: "NFL",
  NHL: "NHL",
  NBA: "NBA",
  MLB: "MLB",
  NCAAB: "NCAA Basketball",
  NCAAF: "NCAA Football",
  SOCCER: "Soccer",
}

const LEAGUE_TYPE_OPTIONS: { value: LeagueStyleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "redraft", label: "Redraft" },
  { value: "dynasty", label: "Dynasty" },
  { value: "best_ball", label: "Best Ball" },
  { value: "keeper", label: "Keeper" },
  { value: "survivor", label: "Survivor" },
  { value: "bracket", label: "Bracket" },
  { value: "community", label: "Community" },
]

const DRAFT_TYPE_OPTIONS: { value: DraftTypeFilter; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "snake", label: "Snake" },
  { value: "linear", label: "Linear" },
  { value: "auction", label: "Auction" },
]

const DRAFT_STATUS_OPTIONS: { value: DraftStatusFilter; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "pre_draft", label: "Pre-draft" },
  { value: "in_progress", label: "In progress" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
]

const ENTRY_FEE_OPTIONS: { value: EntryFeeFilter; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
]

const SORT_OPTIONS: { value: DiscoverySort; label: string }[] = [
  { value: "ranking_match", label: "Best rank match" },
  { value: "popularity", label: "Popularity" },
  { value: "newest", label: "Newest" },
  { value: "filling_fast", label: "Filling fast" },
]

const VISIBILITY_OPTIONS: { value: VisibilityFilter; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "all", label: "Public & private" },
]

export function FindLeagueClient() {
  const searchParams = useSearchParams()
  const hasInitializedFiltersRef = useRef(false)
  const skipNextFilterFetchRef = useRef(false)
  const [query, setQuery] = useState("")
  const [appliedQuery, setAppliedQuery] = useState("")
  const [sport, setSport] = useState("")
  const [leagueType, setLeagueType] = useState<LeagueStyleFilter>("all")
  const [draftType, setDraftType] = useState<DraftTypeFilter>("all")
  const [teamCountMin, setTeamCountMin] = useState("")
  const [teamCountMax, setTeamCountMax] = useState("")
  const [draftStatus, setDraftStatus] = useState<DraftStatusFilter>("all")
  const [entryFee, setEntryFee] = useState<EntryFeeFilter>("all")
  const [aiEnabled, setAiEnabled] = useState(false)
  const [visibility, setVisibility] = useState<VisibilityFilter>("public")
  const [sort, setSort] = useState<DiscoverySort>("ranking_match")
  const [page, setPage] = useState(1)
  const [leagues, setLeagues] = useState<DiscoveryCard[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [viewerTier, setViewerTier] = useState<number | null>(null)
  const [viewerTierName, setViewerTierName] = useState<string | null>(null)
  const [hiddenByTierPolicy, setHiddenByTierPolicy] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showFilters, setShowFilters] = useState(false)

  const activeFilterCount = [
    sport !== '',
    leagueType !== 'all',
    draftType !== 'all',
    draftStatus !== 'all',
    entryFee !== 'all',
    aiEnabled,
    teamCountMin !== '',
    teamCountMax !== '',
  ].filter(Boolean).length

  const buildParams = useCallback(
    (p: number) => {
      const params = new URLSearchParams()
      if (appliedQuery.trim()) params.set("q", appliedQuery.trim())
      if (sport) params.set("sport", sport)
      if (leagueType !== "all") params.set("style", leagueType)
      if (draftType !== "all") params.set("draftType", draftType)
      if (draftStatus !== "all") params.set("draftStatus", draftStatus)
      params.set("sort", sort)
      params.set("entryFee", entryFee)
      params.set("visibility", visibility)
      const tMin = teamCountMin.trim() ? parseInt(teamCountMin, 10) : undefined
      const tMax = teamCountMax.trim() ? parseInt(teamCountMax, 10) : undefined
      if (tMin != null && !Number.isNaN(tMin)) params.set("teamCountMin", String(tMin))
      if (tMax != null && !Number.isNaN(tMax)) params.set("teamCountMax", String(tMax))
      if (aiEnabled) params.set("aiEnabled", "true")
      params.set("page", String(p))
      params.set("limit", "12")
      return params
    },
    [
      appliedQuery,
      sport,
      leagueType,
      draftType,
      draftStatus,
      sort,
      entryFee,
      visibility,
      teamCountMin,
      teamCountMax,
      aiEnabled,
    ]
  )

  const fetchLeagues = useCallback(
    (p: number) => {
      setLoading(true)
      const params = buildParams(p)
      fetch(`/api/discover/leagues?${params.toString()}`)
        .then((r) => r.json())
        .then((d) => {
          setLeagues(d.leagues ?? [])
          setTotal(d.total ?? 0)
          setTotalPages(d.totalPages ?? 1)
          setViewerTier(typeof d.viewerTier === "number" ? d.viewerTier : null)
          setViewerTierName(typeof d.viewerTierName === "string" ? d.viewerTierName : null)
          setHiddenByTierPolicy(typeof d.hiddenByTierPolicy === "number" ? d.hiddenByTierPolicy : 0)
        })
        .catch(() => {
          setLeagues([])
          setTotal(0)
          setTotalPages(0)
          setViewerTier(null)
          setViewerTierName(null)
          setHiddenByTierPolicy(0)
        })
        .finally(() => setLoading(false))
    },
    [buildParams]
  )

  useEffect(() => {
    fetchLeagues(page)
  }, [page, fetchLeagues])

  useEffect(() => {
    const s = searchParams?.get("sport") ?? ""
    const styleParam = (searchParams?.get("style") as LeagueStyleFilter) ?? "all"
    const q = searchParams?.get("q") ?? ""
    if (s) setSport(s)
    if (styleParam !== "all") setLeagueType(styleParam)
    if (q.trim()) {
      setQuery(q)
      setAppliedQuery(q.trim())
    }
    hasInitializedFiltersRef.current = true
  }, [searchParams])

  useEffect(() => {
    if (!hasInitializedFiltersRef.current) return
    if (skipNextFilterFetchRef.current) {
      skipNextFilterFetchRef.current = false
      return
    }
    if (page !== 1) {
      setPage(1)
      return
    }
    fetchLeagues(1)
  }, [sport, leagueType, draftType, draftStatus, teamCountMin, teamCountMax, entryFee, aiEnabled, visibility, sort, fetchLeagues])

  const handleSearch = () => {
    const nextQuery = query.trim()
    skipNextFilterFetchRef.current = true
    setAppliedQuery(nextQuery)
    if (page === 1) {
      fetchLeagues(1)
      return
    }
    setPage(1)
  }

  const sports = getDiscoverySports().map((s) => ({
    value: s.value,
    label: SPORT_LABELS[s.value] ?? s.label,
  }))

  return (
    <div className="space-y-8">
      <section
        className="rounded-2xl border p-4 sm:p-5"
        style={{
          borderColor: "var(--border)",
          background:
            "linear-gradient(145deg, color-mix(in srgb, var(--accent) 8%, var(--panel)) 0%, color-mix(in srgb, var(--panel2) 15%, var(--panel)) 100%)",
        }}
        data-testid="find-league-ranking-banner"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--muted)" }}>
              Rankings effect enabled
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--text)" }}>
              Discovery prioritizes leagues closest to your current tier so recommendations stay competitive and relevant.
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              {viewerTierName
                ? `Current tier: ${viewerTier ?? "—"} (${viewerTierName}).`
                : "Sign in to personalize tier matching even more."}
            </p>
          </div>
          {hiddenByTierPolicy > 0 ? (
            <div
              className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold"
              style={{
                borderColor: "rgba(251, 146, 60, 0.35)",
                background: "rgba(251, 146, 60, 0.12)",
                color: "rgb(251, 146, 60)",
              }}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              {hiddenByTierPolicy} leagues require commissioner invite
            </div>
          ) : null}
        </div>
      </section>
      <SmartDiscoverySection sport={sport} />
      {/* Search — mobile first */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            type="search"
            placeholder="Search leagues…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            data-testid="find-league-search-input"
            className="flex-1 rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/40 focus:border-cyan-500/40 transition-[box-shadow,border-color]"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel)",
              color: "var(--text)",
            }}
            aria-label="Search leagues"
          />
          <button
            type="button"
            onClick={handleSearch}
            data-testid="find-league-search-submit"
            className="rounded-lg px-4 py-2.5 text-sm font-medium flex items-center gap-2"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            <Search className="h-4 w-4" />
            Search
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="text-sm font-medium flex items-center gap-2 sm:hidden"
          style={{ color: "var(--accent)" }}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>{showFilters ? 'Hide filters' : 'Filters'}</span>
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-cyan-500/80 px-1.5 py-0.5 text-[11px] font-bold text-white leading-none">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Filters — collapsible on mobile */}
      <div
        className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${showFilters ? "block" : "hidden sm:grid"}`}
        role="group"
        aria-label="League filters"
      >
        <label className="block">
          <span className="text-xs font-medium mb-1 block" style={{ color: "var(--muted)" }}>
            Sport
          </span>
          <select
            value={sport}
            onChange={(e) => {
              setSport(e.target.value)
              setPage(1)
            }}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          >
            <option value="">All sports</option>
            {sports.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium mb-1 block" style={{ color: "var(--muted)" }}>
            League type
          </span>
          <select
            value={leagueType}
            onChange={(e) => {
              setLeagueType(e.target.value as LeagueStyleFilter)
            }}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          >
            {LEAGUE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium mb-1 block" style={{ color: "var(--muted)" }}>
            Draft type
          </span>
          <select
            value={draftType}
            onChange={(e) => {
              setDraftType(e.target.value as DraftTypeFilter)
            }}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          >
            {DRAFT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium mb-1 block" style={{ color: "var(--muted)" }}>
            Team count
          </span>
          <div className="flex gap-2">
            <input
              type="number"
              min={2}
              max={24}
              placeholder="Min"
              value={teamCountMin}
              onChange={(e) => {
                setTeamCountMin(e.target.value)
              }}
              className="w-20 rounded-lg border px-2 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
            />
            <input
              type="number"
              min={2}
              max={24}
              placeholder="Max"
              value={teamCountMax}
              onChange={(e) => {
                setTeamCountMax(e.target.value)
              }}
              className="w-20 rounded-lg border px-2 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
            />
          </div>
        </label>
        <label className="block">
          <span className="text-xs font-medium mb-1 block" style={{ color: "var(--muted)" }}>
            Draft status
          </span>
          <select
            value={draftStatus}
            onChange={(e) => {
              setDraftStatus(e.target.value as DraftStatusFilter)
            }}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          >
            {DRAFT_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium mb-1 block" style={{ color: "var(--muted)" }}>
            Entry fee
          </span>
          <select
            value={entryFee}
            onChange={(e) => {
              setEntryFee(e.target.value as EntryFeeFilter)
            }}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          >
            {ENTRY_FEE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium mb-1 block" style={{ color: "var(--muted)" }}>
            AI features
          </span>
          <label className="flex items-center gap-2 mt-1">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => {
                setAiEnabled(e.target.checked)
              }}
              className="rounded border"
              style={{ borderColor: "var(--border)" }}
            />
            <span className="text-sm" style={{ color: "var(--text)" }}>
              AI enabled
            </span>
          </label>
        </label>
        <label className="block">
          <span className="text-xs font-medium mb-1 block" style={{ color: "var(--muted)" }}>
            Visibility
          </span>
          <select
            value={visibility}
            onChange={(e) => {
              setVisibility(e.target.value as VisibilityFilter)
            }}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          >
            {VISIBILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium mb-1 block" style={{ color: "var(--muted)" }}>
            Sort
          </span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as DiscoverySort)
            }}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Results */}
      <section>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--muted)" }} />
          </div>
        ) : leagues.length === 0 ? (
          <div
            className="rounded-xl border border-dashed p-12 text-center"
            style={{ borderColor: "var(--border)" }}
          >
            <Inbox className="h-12 w-12 mx-auto mb-3" style={{ color: "var(--muted)" }} />
            <p className="font-medium" style={{ color: "var(--text)" }}>
              No leagues match your filters
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
              Try changing sport, league type, or search.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium mb-4" style={{ color: "var(--muted)" }}>
              {total} league{total !== 1 ? "s" : ""} found
              {sort === "ranking_match" ? " · sorted by rank fit" : ""}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {leagues.map((league) => (
                <FindLeagueCard key={`${league.source}-${league.id}`} league={league} />
              ))}
            </div>
            {totalPages > 1 && (
              <nav
                className="flex flex-wrap items-center justify-center gap-2 mt-8"
                aria-label="Pagination"
              >
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  Previous
                </button>
                <span className="px-3 py-2 text-sm" style={{ color: "var(--muted)" }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  )
}
