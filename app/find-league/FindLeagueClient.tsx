"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, Inbox, Search, ShieldAlert, SlidersHorizontal } from "lucide-react"
import { FindLeagueCard } from "@/components/discovery/FindLeagueCard"
import { DiscoveryRailSkeleton } from "@/components/find-league/DiscoveryRail"
import { getDiscoverySports } from "@/lib/public-discovery/discovery-sports"
import type { FindLeagueRail } from "@/lib/public-discovery/findLeagueRails"
import type {
  DiscoveryCard,
  DiscoverySort,
  EntryFeeFilter,
  LeagueStyleFilter,
  VisibilityFilter,
  DraftTypeFilter,
  DraftStatusFilter,
  DraftWhenFilter,
  RankBandFilter,
  TimeZoneRegionFilter,
} from "@/lib/public-discovery/types"
import {
  DRAFT_WHEN_LABELS,
  RANK_BAND_HINTS,
  RANK_BAND_LABELS,
  TIME_ZONE_REGION_LABELS,
  parseLeagueSearch,
  resolveViewerTimeZone,
  type ParsedLeagueSearch,
} from "@/lib/public-discovery/findLeagueFilters"
import { useUserTimezone } from "@/hooks/useUserTimezone"

type RecsStatus = 'ok' | 'anonymous' | 'empty' | 'error'

/**
 * "Picked for you" rows: at your level, step up, drafting this week, filling fast.
 * Built server-side from the same discovery list as the grid (lib/public-discovery/findLeagueRails.ts).
 */
function SmartDiscoverySection({ sport }: { sport: string }) {
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<RecsStatus | null>(null)
  const [rails, setRails] = useState<FindLeagueRail[]>([])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)

    const params = new URLSearchParams()
    if (sport) params.set("sport", sport)

    fetch(`/api/find-league/recommendations?${params.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        setStatus(d.status ?? "error")
        setRails(Array.isArray(d.rails) ? d.rails : [])
        setLoading(false)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setStatus("error")
        setRails([])
        setLoading(false)
      })

    return () => controller.abort()
  }, [sport])

  if (loading) {
    return (
      <div className="space-y-8">
        <DiscoveryRailSkeleton />
      </div>
    )
  }

  if (rails.length === 0) return null

  return (
    <div className="space-y-8" data-testid="find-league-rails">
      {rails.map((rail) => (
        <section key={rail.kind} aria-label={rail.title} data-testid={`find-league-rail-${rail.kind}`}>
          <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>
            {rail.title}
          </h2>
          <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
            {rail.description}
          </p>
          <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {rail.leagues.map((league) => (
              <div key={`${league.source}-${league.id}`} className="w-[85%] max-w-sm shrink-0 snap-start sm:w-80">
                <FindLeagueCard league={league} />
              </div>
            ))}
          </div>
        </section>
      ))}
      {status === "anonymous" ? (
        <p className="text-xs" style={{ color: "var(--muted)" }} data-testid="find-league-rails-signin">
          Sign in to see leagues at your level and ones that would stretch you.
        </p>
      ) : null}
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

const DRAFT_WHEN_OPTIONS = (Object.keys(DRAFT_WHEN_LABELS) as DraftWhenFilter[]).map((value) => ({
  value,
  label: DRAFT_WHEN_LABELS[value],
}))

const TZ_REGION_OPTIONS = (Object.keys(TIME_ZONE_REGION_LABELS) as TimeZoneRegionFilter[]).map((value) => ({
  value,
  label: TIME_ZONE_REGION_LABELS[value],
}))

const RANK_BAND_OPTIONS: { value: RankBandFilter; label: string }[] = [
  { value: "all", label: "All levels" },
  { value: "step_up", label: RANK_BAND_LABELS.step_up },
  { value: "your_level", label: RANK_BAND_LABELS.your_level },
  { value: "chill", label: RANK_BAND_LABELS.chill },
]

/** "NFL · Dynasty · 12 teams · Snake" — what the search box was read as, so a person can see and undo it. */
function describeParsedSearch(parsed: ParsedLeagueSearch): string[] {
  const parts: string[] = []
  if (parsed.sport) parts.push(parsed.sport)
  if (parsed.style) parts.push(parsed.style.replace(/_/g, " "))
  if (parsed.teamCount) parts.push(`${parsed.teamCount} teams`)
  if (parsed.draftType) parts.push(parsed.draftType)
  if (parsed.entryFee) parts.push(parsed.entryFee)
  if (parsed.draftWhen) parts.push(DRAFT_WHEN_LABELS[parsed.draftWhen].toLowerCase())
  if (parsed.tzRegion) parts.push(`${TIME_ZONE_REGION_LABELS[parsed.tzRegion]} time`)
  if (parsed.text) parts.push(`"${parsed.text}"`)
  return parts
}

const VISIBILITY_OPTIONS: { value: VisibilityFilter; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "all", label: "Public & private" },
]

/** Filters the page opens with, read from the URL once (?sport=, ?style=, ?q=). */
function initialFiltersFrom(searchParams: { get(name: string): string | null } | null) {
  const q = searchParams?.get("q") ?? ""
  const parsed = q.trim() ? parseLeagueSearch(q) : null
  const styleParam = (searchParams?.get("style") as LeagueStyleFilter | null) ?? null
  const readAs = parsed ? describeParsedSearch(parsed) : []
  return {
    query: q,
    appliedQuery: parsed ? parsed.text : "",
    sport: parsed?.sport ?? searchParams?.get("sport") ?? "",
    leagueType: (parsed?.style ?? (styleParam && styleParam !== "all" ? styleParam : "all")) as LeagueStyleFilter,
    draftType: parsed?.draftType ?? ("all" as DraftTypeFilter),
    entryFee: parsed?.entryFee ?? ("all" as EntryFeeFilter),
    draftWhen: parsed?.draftWhen ?? ("any" as DraftWhenFilter),
    tzRegion: parsed?.tzRegion ?? ("any" as TimeZoneRegionFilter),
    teamCount: parsed?.teamCount ? String(parsed.teamCount) : "",
    searchReadAs:
      parsed && (readAs.length > 1 || (readAs.length === 1 && !parsed.text)) ? readAs : [],
  }
}

export function FindLeagueClient() {
  const searchParams = useSearchParams()
  const [initial] = useState(() => initialFiltersFrom(searchParams))
  const { timezone: profileTimeZone } = useUserTimezone()
  const [query, setQuery] = useState(initial.query)
  const [appliedQuery, setAppliedQuery] = useState(initial.appliedQuery)
  const [sport, setSport] = useState(initial.sport)
  const [leagueType, setLeagueType] = useState<LeagueStyleFilter>(initial.leagueType)
  const [draftType, setDraftType] = useState<DraftTypeFilter>(initial.draftType)
  const [teamCountMin, setTeamCountMin] = useState(initial.teamCount)
  const [teamCountMax, setTeamCountMax] = useState(initial.teamCount)
  const [draftStatus, setDraftStatus] = useState<DraftStatusFilter>("all")
  const [entryFee, setEntryFee] = useState<EntryFeeFilter>(initial.entryFee)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [draftWhen, setDraftWhen] = useState<DraftWhenFilter>(initial.draftWhen)
  const [tzRegion, setTzRegion] = useState<TimeZoneRegionFilter>(initial.tzRegion)
  const [rankBand, setRankBand] = useState<RankBandFilter>("all")
  const [searchReadAs, setSearchReadAs] = useState<string[]>(initial.searchReadAs)
  const [visibility, setVisibility] = useState<VisibilityFilter>("public")
  const [sort, setSort] = useState<DiscoverySort>("ranking_match")
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
    draftWhen !== 'any',
    tzRegion !== 'any',
  ].filter(Boolean).length

  /**
   * Every filter, as the query string the server sees — without the page. One string, so one
   * effect can fetch exactly once per change. This used to be three effects over a callback
   * whose identity moved with every filter, and every search and every filter change fetched
   * twice (measured on allfantasy.ai, 2026-10-30).
   */
  const filterKey = (() => {
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
    if (draftWhen !== "any") params.set("draftWhen", draftWhen)
    if (tzRegion !== "any") params.set("tzRegion", tzRegion)
    if (rankBand !== "all") params.set("rankBand", rankBand)
    // Same zone the cards print draft times in (FindLeagueCard), so a filter and the time it is
    // filtering on can never disagree. Only the weeknight/weekend windows read it, so it is sent
    // only for those — otherwise the profile zone arriving after mount would refetch for nothing.
    if (draftWhen === "weeknight" || draftWhen === "weekend") {
      const tz = resolveViewerTimeZone(profileTimeZone)
      if (tz) params.set("viewerTz", tz)
    }
    return params.toString()
  })()

  // The page belongs to the filters it was chosen under: change a filter and it reads as page 1
  // without a second render-and-fetch to reset it.
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 })
  const page = pageState.key === filterKey ? pageState.page : 1
  const setPage = (next: number | ((p: number) => number)) =>
    setPageState({ key: filterKey, page: typeof next === "function" ? next(page) : next })

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/discover/leagues?${filterKey}&page=${page}&limit=12`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        setLeagues(d.leagues ?? [])
        setTotal(d.total ?? 0)
        setTotalPages(d.totalPages ?? 1)
        setViewerTier(typeof d.viewerTier === "number" ? d.viewerTier : null)
        setViewerTierName(typeof d.viewerTierName === "string" ? d.viewerTierName : null)
        setHiddenByTierPolicy(typeof d.hiddenByTierPolicy === "number" ? d.hiddenByTierPolicy : 0)
        setLoading(false)
      })
      .catch(() => {
        // A newer request replaced this one; its answer is the one to show.
        if (controller.signal.aborted) return
        setLeagues([])
        setTotal(0)
        setTotalPages(0)
        setViewerTier(null)
        setViewerTierName(null)
        setHiddenByTierPolicy(0)
        setLoading(false)
      })
    return () => controller.abort()
  }, [filterKey, page])

  /**
   * The search box takes plain English: "12 team dynasty snake, free, weeknights".
   * Recognised words set the filter controls below it, so the person can see and undo
   * each one, and only the leftover words are searched against league names.
   */
  function applyParsedSearch(parsed: ParsedLeagueSearch) {
    if (parsed.sport) setSport(parsed.sport)
    if (parsed.style) setLeagueType(parsed.style)
    if (parsed.draftType) setDraftType(parsed.draftType)
    if (parsed.entryFee) setEntryFee(parsed.entryFee)
    if (parsed.draftWhen) setDraftWhen(parsed.draftWhen)
    if (parsed.tzRegion) setTzRegion(parsed.tzRegion)
    if (parsed.teamCount) {
      setTeamCountMin(String(parsed.teamCount))
      setTeamCountMax(String(parsed.teamCount))
    }
    setAppliedQuery(parsed.text)
    const readAs = describeParsedSearch(parsed)
    // Only worth saying when something was recognised; a plain name search reads as itself.
    setSearchReadAs(readAs.length > 1 || (readAs.length === 1 && !parsed.text) ? readAs : [])
  }

  const handleSearch = () => {
    applyParsedSearch(parseLeagueSearch(query))
  }

  // Bands exist only for a viewer with an established Class against rated leagues, so
  // the chips appear once there is something for them to split (or one is selected).
  const showRankBands = rankBand !== "all" || leagues.some((l) => l.rankBand != null)

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
            placeholder='Try "12 team dynasty snake, free, weeknights"'
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
        {searchReadAs.length > 0 ? (
          <p className="text-xs" style={{ color: "var(--muted)" }} data-testid="find-league-search-read-as">
            Searching for <span style={{ color: "var(--text)" }}>{searchReadAs.join(" · ")}</span>. Change any of it in
            the filters below.
          </p>
        ) : null}
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
            Draft time (your clock)
          </span>
          <select
            value={draftWhen}
            onChange={(e) => {
              setDraftWhen(e.target.value as DraftWhenFilter)
            }}
            data-testid="find-league-draft-when"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          >
            {DRAFT_WHEN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium mb-1 block" style={{ color: "var(--muted)" }}>
            League time zone
          </span>
          <select
            value={tzRegion}
            onChange={(e) => {
              setTzRegion(e.target.value as TimeZoneRegionFilter)
            }}
            data-testid="find-league-tz-region"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          >
            {TZ_REGION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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
        {showRankBands ? (
          <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Rank level" data-testid="find-league-rank-bands">
            {RANK_BAND_OPTIONS.map((o) => {
              const active = rankBand === o.value
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={active}
                  title={o.value === "all" ? undefined : RANK_BAND_HINTS[o.value]}
                  onClick={() => setRankBand(o.value)}
                  className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    borderColor: active ? "var(--accent)" : "var(--border)",
                    background: active ? "color-mix(in srgb, var(--accent) 16%, var(--panel))" : "var(--panel)",
                    color: active ? "var(--text)" : "var(--muted)",
                  }}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        ) : null}
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
              {draftWhen !== "any"
                ? "Only leagues with a scheduled draft can match a draft time. Try \"Any time\"."
                : "Try changing sport, league type, or search."}
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
