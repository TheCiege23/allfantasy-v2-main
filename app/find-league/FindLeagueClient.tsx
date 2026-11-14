"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Bell, ChevronDown, Loader2, Inbox, Search, X } from "lucide-react"
import { useMessages } from "@/components/i18n/useMessages"
import { findLeagueGuideMessages } from "@/lib/core-app/messages/findLeagueGuide"
import { FIND_LEAGUE_PAGE_SIZE, moreFilterCount, showPickedRows } from "@/lib/public-discovery/findLeagueGuide"
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
import { LEAGUE_VIBES, vibeLabel, type LeagueVibeFilter } from "@/lib/public-discovery/vibes"

type RecsStatus = 'ok' | 'anonymous' | 'empty' | 'error'
type GuideCopy = typeof findLeagueGuideMessages.en

/** A row's heading and note in the reader's language; the server's English is the fallback. */
function railCopy(rail: FindLeagueRail, m: GuideCopy): { title: string; description: string } {
  switch (rail.kind) {
    case "your_level":
      return { title: m.railYourLevel, description: m.railYourLevelNote }
    case "step_up":
      return { title: m.railStepUp, description: m.railStepUpNote }
    case "drafting_soon":
      return { title: m.railDraftingSoon, description: m.railDraftingSoonNote }
    case "filling_fast":
      return { title: m.railFillingFast, description: m.railFillingFastNote }
    default:
      return { title: rail.title, description: rail.description }
  }
}

/**
 * "Picked for you" rows: at your level, step up, drafting this week, filling fast.
 * Built server-side from the same discovery list as the grid (lib/public-discovery/findLeagueRails.ts).
 * Mounted only when the grid has more than one page (showPickedRows): with every league already on
 * screen, the rows only showed the same leagues a second time.
 */
function SmartDiscoverySection({ sport, m }: { sport: string; m: GuideCopy }) {
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
        <section key={rail.kind} aria-label={railCopy(rail, m).title} data-testid={`find-league-rail-${rail.kind}`}>
          <h2 className="text-base font-bold" style={{ color: "var(--text)" }}>
            {railCopy(rail, m).title}
          </h2>
          <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
            {railCopy(rail, m).description}
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
          {m.signInForLevel}
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
  { value: "guillotine", label: "Guilly" },
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

const sortOptions = (m: GuideCopy): { value: DiscoverySort; label: string }[] => [
  { value: "ranking_match", label: m.sortRank },
  { value: "popularity", label: m.sortPopular },
  { value: "newest", label: m.sortNewest },
  { value: "filling_fast", label: m.sortFilling },
]

const DRAFT_WHEN_OPTIONS = (Object.keys(DRAFT_WHEN_LABELS) as DraftWhenFilter[]).map((value) => ({
  value,
  label: DRAFT_WHEN_LABELS[value],
}))

const TZ_REGION_OPTIONS = (Object.keys(TIME_ZONE_REGION_LABELS) as TimeZoneRegionFilter[]).map((value) => ({
  value,
  label: TIME_ZONE_REGION_LABELS[value],
}))

const rankBandOptions = (m: GuideCopy): { value: RankBandFilter; label: string }[] => [
  { value: "all", label: m.levelsAll },
  { value: "step_up", label: m.levelsStepUp },
  { value: "your_level", label: m.levelsYourLevel },
  { value: "chill", label: m.levelsChill },
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
  if (parsed.vibe) parts.push(vibeLabel(parsed.vibe).toLowerCase())
  if (parsed.text) parts.push(`"${parsed.text}"`)
  return parts
}

const VISIBILITY_OPTIONS: { value: VisibilityFilter; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "all", label: "Public & private" },
]

/** Filters the page opens with, read from the URL once (?sport=, ?style=, ?q=). */
/**
 * Filters the page opens with, read from the URL once. Every filter key is read, so a link from
 * a saved-search alert (`/find-league?<the saved query>`) reopens exactly that search. A plain
 * English `q` (from the home page) is parsed; a parsed word wins over an explicit key.
 */
function initialFiltersFrom(searchParams: { get(name: string): string | null } | null) {
  const get = (key: string) => searchParams?.get(key)?.trim() || ""
  const q = get("q")
  const parsed = q ? parseLeagueSearch(q) : null
  const readAs = parsed ? describeParsedSearch(parsed) : []
  const teamCount = parsed?.teamCount ? String(parsed.teamCount) : ""
  return {
    query: q,
    appliedQuery: parsed ? parsed.text : "",
    sport: parsed?.sport ?? get("sport"),
    leagueType: (parsed?.style ?? (get("style") || "all")) as LeagueStyleFilter,
    draftType: (parsed?.draftType ?? (get("draftType") || "all")) as DraftTypeFilter,
    draftStatus: (get("draftStatus") || "all") as DraftStatusFilter,
    entryFee: (parsed?.entryFee ?? (get("entryFee") || "all")) as EntryFeeFilter,
    draftWhen: (parsed?.draftWhen ?? (get("draftWhen") || "any")) as DraftWhenFilter,
    tzRegion: (parsed?.tzRegion ?? (get("tzRegion") || "any")) as TimeZoneRegionFilter,
    rankBand: (get("rankBand") || "all") as RankBandFilter,
    vibe: (parsed?.vibe ?? (get("vibe") || "all")) as LeagueVibeFilter,
    aiEnabled: get("aiEnabled") === "true",
    // Public unless the link asks for both: a saved search for "Public & private" reopens as one.
    visibility: (get("visibility") === "all" ? "all" : "public") as VisibilityFilter,
    teamCountMin: teamCount || get("teamCountMin"),
    teamCountMax: teamCount || get("teamCountMax"),
    searchReadAs:
      parsed && (readAs.length > 1 || (readAs.length === 1 && !parsed.text)) ? readAs : [],
  }
}

export function FindLeagueClient() {
  const m = useMessages(findLeagueGuideMessages)
  const searchParams = useSearchParams()
  const [initial] = useState(() => initialFiltersFrom(searchParams))
  const { timezone: profileTimeZone } = useUserTimezone()
  const [query, setQuery] = useState(initial.query)
  const [appliedQuery, setAppliedQuery] = useState(initial.appliedQuery)
  const [sport, setSport] = useState(initial.sport)
  const [leagueType, setLeagueType] = useState<LeagueStyleFilter>(initial.leagueType)
  const [draftType, setDraftType] = useState<DraftTypeFilter>(initial.draftType)
  const [teamCountMin, setTeamCountMin] = useState(initial.teamCountMin)
  const [teamCountMax, setTeamCountMax] = useState(initial.teamCountMax)
  const [draftStatus, setDraftStatus] = useState<DraftStatusFilter>(initial.draftStatus)
  const [entryFee, setEntryFee] = useState<EntryFeeFilter>(initial.entryFee)
  const [aiEnabled, setAiEnabled] = useState(initial.aiEnabled)
  const [draftWhen, setDraftWhen] = useState<DraftWhenFilter>(initial.draftWhen)
  const [tzRegion, setTzRegion] = useState<TimeZoneRegionFilter>(initial.tzRegion)
  const [rankBand, setRankBand] = useState<RankBandFilter>(initial.rankBand)
  const [vibe, setVibe] = useState<LeagueVibeFilter>(initial.vibe)
  const [searchReadAs, setSearchReadAs] = useState<string[]>(initial.searchReadAs)
  // Public leagues by default — the leagues anyone can join straight away (owner's call, 2026-11-10:
  // on production 10 of 12 cards were private). "Public & private" adds private leagues as "Ask to
  // join" cards (lib/public-discovery/privateLeagueRequests.ts).
  const [visibility, setVisibility] = useState<VisibilityFilter>(initial.visibility)
  const [sort, setSort] = useState<DiscoverySort>("ranking_match")
  const [leagues, setLeagues] = useState<DiscoveryCard[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [hiddenByTierPolicy, setHiddenByTierPolicy] = useState(0)
  const [paidHiddenMessage, setPaidHiddenMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Everything but Sport and Sort lives in "More filters". It opens when a link or a search set one
  // of them, so a filter in force is never hidden behind a closed fold.
  const moreCount = moreFilterCount({
    leagueType, draftType, draftStatus, entryFee, aiEnabled, teamCountMin, teamCountMax, draftWhen, tzRegion, vibe, visibility,
  })
  const [moreOpen, setMoreOpen] = useState(moreCount > 0)
  const activeFilterCount = (sport !== '' ? 1 : 0) + moreCount

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
    if (vibe !== "all") params.set("vibe", vibe)
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
    fetch(`/api/discover/leagues?${filterKey}&page=${page}&limit=${FIND_LEAGUE_PAGE_SIZE}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        setLeagues(d.leagues ?? [])
        setTotal(d.total ?? 0)
        setTotalPages(d.totalPages ?? 1)
        setHiddenByTierPolicy(typeof d.hiddenByTierPolicy === "number" ? d.hiddenByTierPolicy : 0)
        setPaidHiddenMessage(typeof d.paidLeaguesHidden?.message === "string" ? d.paidLeaguesHidden.message : null)
        setLoading(false)
      })
      .catch(() => {
        // A newer request replaced this one; its answer is the one to show.
        if (controller.signal.aborted) return
        setLeagues([])
        setTotal(0)
        setTotalPages(0)
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
    if (parsed.vibe) setVibe(parsed.vibe)
    if (parsed.teamCount) {
      setTeamCountMin(String(parsed.teamCount))
      setTeamCountMax(String(parsed.teamCount))
    }
    setAppliedQuery(parsed.text)
    if (parsed.style || parsed.draftType || parsed.entryFee || parsed.draftWhen || parsed.tzRegion || parsed.vibe || parsed.teamCount) {
      setMoreOpen(true)
    }
    const readAs = describeParsedSearch(parsed)
    // Only worth saying when something was recognised; a plain name search reads as itself.
    setSearchReadAs(readAs.length > 1 || (readAs.length === 1 && !parsed.text) ? readAs : [])
  }

  /** "NFL · dynasty · 12 teams · casual" — how a saved search is named in the list and its alert. */
  function currentSearchLabel(): string {
    const parts: string[] = []
    if (sport) parts.push(SPORT_LABELS[sport] ?? sport)
    if (leagueType !== "all") parts.push(leagueType.replace(/_/g, " "))
    if (teamCountMin && teamCountMin === teamCountMax) parts.push(`${teamCountMin} teams`)
    if (draftType !== "all") parts.push(draftType)
    if (entryFee !== "all") parts.push(entryFee)
    if (draftWhen !== "any") parts.push(DRAFT_WHEN_LABELS[draftWhen].toLowerCase())
    if (tzRegion !== "any") parts.push(`${TIME_ZONE_REGION_LABELS[tzRegion]} time`)
    if (vibe !== "all") parts.push(vibeLabel(vibe).toLowerCase())
    if (rankBand !== "all") parts.push(RANK_BAND_LABELS[rankBand].toLowerCase())
    if (appliedQuery.trim()) parts.push(`"${appliedQuery.trim()}"`)
    return parts.join(" · ") || "Any league"
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
    <div className="space-y-6">
      {/* The Career Level rule, said once, under the header (it had its own box with "Class Division"). */}
      <div className="-mt-2 space-y-1 text-sm" style={{ color: "var(--muted)" }} data-testid="find-league-career-rule">
        <p>{m.careerRule}</p>
        {hiddenByTierPolicy > 0 ? (
          <p className="font-semibold" style={{ color: "rgb(251, 146, 60)" }} data-testid="find-league-invite-needed">
            {m.inviteNeeded(hiddenByTierPolicy)}
          </p>
        ) : null}
      </div>
      {paidHiddenMessage ? (
        <p
          className="rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: "rgba(234, 179, 8, 0.35)", background: "rgba(234, 179, 8, 0.08)", color: "var(--text)" }}
          data-testid="find-league-paid-hidden"
        >
          {paidHiddenMessage}
        </p>
      ) : null}

      {/* Search first: it is what the page is for. Sport and Sort beside it; the rest folded. */}
      <div className="flex flex-col gap-3" data-testid="find-league-search">
        <div className="flex gap-2">
          <input
            type="search"
            placeholder={m.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            data-testid="find-league-search-input"
            className="min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/40 focus:border-cyan-500/40 transition-[box-shadow,border-color]"
            style={{
              borderColor: "var(--border)",
              background: "var(--panel)",
              color: "var(--text)",
            }}
            aria-label={m.searchLabel}
          />
          <button
            type="button"
            onClick={handleSearch}
            data-testid="find-league-search-submit"
            className="rounded-lg px-4 py-2.5 text-sm font-medium flex items-center gap-2"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            <Search className="h-4 w-4" />
            {m.search}
          </button>
        </div>
        {searchReadAs.length > 0 ? (
          <p className="text-xs" style={{ color: "var(--muted)" }} data-testid="find-league-search-read-as">
            {m.readAs} <span style={{ color: "var(--text)" }}>{searchReadAs.join(" · ")}</span>. {m.readAsAfter}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
          <label className="block sm:w-48">
            <span className="text-xs font-medium mb-1 block" style={{ color: "var(--muted)" }}>
              {m.sport}
            </span>
            <select
              value={sport}
              onChange={(e) => {
                setSport(e.target.value)
                setPage(1)
              }}
              data-testid="find-league-sport"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
            >
              <option value="">{m.allSports}</option>
              {sports.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:w-48">
            <span className="text-xs font-medium mb-1 block" style={{ color: "var(--muted)" }}>
              {m.sort}
            </span>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as DiscoverySort)
              }}
              data-testid="find-league-sort"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
            >
              {sortOptions(m).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-controls="find-league-more"
            data-testid="find-league-more-toggle"
            className="col-span-2 inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium sm:col-span-1"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {m.moreFilters}
            {moreCount > 0 ? (
              <span
                className="rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none"
                style={{ background: "var(--accent)", color: "var(--bg)" }}
                data-testid="find-league-more-count"
              >
                {m.moreFiltersOn(moreCount)}
              </span>
            ) : null}
            <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {moreOpen ? (
        <div id="find-league-more" className="space-y-4 rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--border)" }} data-testid="find-league-more">
          {/* What the league is like — the one thing the format filters can't say. */}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="League vibe" data-testid="find-league-vibes">
            {(["all", ...LEAGUE_VIBES.map((v) => v.id)] as LeagueVibeFilter[]).map((value) => {
              const active = vibe === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setVibe(value)}
                  className="min-h-[36px] rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    borderColor: active ? "var(--accent)" : "var(--border)",
                    background: active ? "color-mix(in srgb, var(--accent) 16%, var(--panel))" : "var(--panel)",
                    color: active ? "var(--text)" : "var(--muted)",
                  }}
                >
                  {value === "all" ? "Any vibe" : vibeLabel(value)}
                </button>
              )
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="group" aria-label="League filters">
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
          </div>
        </div>
      ) : null}

      {showPickedRows(total, loading) ? <SmartDiscoverySection sport={sport} m={m} /> : null}

      {/* Results */}
      <section>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          {!loading && leagues.length > 0 ? (
            <p className="pt-2 text-sm font-medium" style={{ color: "var(--muted)" }} data-testid="find-league-found">
              {m.found(total)}
            </p>
          ) : (
            <span />
          )}
          <SavedSearches filterKey={filterKey} label={currentSearchLabel()} hasFilters={activeFilterCount > 0 || appliedQuery.trim() !== ""} m={m} />
        </div>
        {showRankBands ? (
          <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Rank level" data-testid="find-league-rank-bands">
            {rankBandOptions(m).map((o) => {
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
              {m.noMatch}
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
              {draftWhen !== "any" ? m.noMatchDraftTime : m.noMatchHint}
            </p>
          </div>
        ) : (
          <>
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
                  {m.previous}
                </button>
                <span className="px-3 py-2 text-sm" style={{ color: "var(--muted)" }}>
                  {m.pageOf(page, totalPages)}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  {m.next}
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  )
}

type SavedSearch = { id: string; label: string; query: string; lastAlertedAt: string | null }

/**
 * "Alert me when new leagues match", plus the searches already saved. Alerts arrive as in-app
 * notifications from the daily check (lib/public-discovery/runSavedSearchAlerts.ts). A saved
 * search opens with a full page load so every filter is read back from its URL.
 */
function SavedSearches({ filterKey, label, hasFilters, m }: { filterKey: string; label: string; hasFilters: boolean; m: GuideCopy }) {
  const [searches, setSearches] = useState<SavedSearch[]>([])
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/find-league/saved-searches", { credentials: "include", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { searches?: SavedSearch[] } | null) => setSearches(Array.isArray(d?.searches) ? d!.searches! : []))
      .catch(() => {})
    return () => controller.abort()
  }, [])

  const save = async () => {
    setBusy(true)
    setStatus("")
    try {
      const r = await fetch("/api/find-league/saved-searches", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: filterKey, label }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string; search?: SavedSearch; alreadySaved?: boolean }
      if (r.status === 401) {
        window.location.href = `/login?callbackUrl=${encodeURIComponent(`/find-league?${filterKey}`)}`
        return
      }
      if (!r.ok || !body.search) throw new Error(body.error || "")
      const saved = body.search
      setSearches((prev) => (prev.some((s) => s.id === saved.id) ? prev : [saved, ...prev]))
      setStatus(body.alreadySaved ? "Already saved." : "Saved. We'll tell you when new leagues match.")
    } catch (e) {
      setStatus(e instanceof Error && e.message ? e.message : "That didn't save. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setSearches((prev) => prev.filter((s) => s.id !== id))
    await fetch(`/api/find-league/saved-searches?id=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" }).catch(() => {})
  }

  return (
    <div className="flex flex-col items-end gap-2" data-testid="find-league-saved-searches">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !hasFilters}
          title={hasFilters ? undefined : m.alertNeedsFilter}
          data-testid="find-league-save-search"
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold disabled:opacity-50"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          <Bell className="h-3.5 w-3.5" />
          {m.alert}
        </button>
        {searches.map((s) => (
          <span
            key={s.id}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-full px-3 text-xs"
            style={{ background: "var(--panel2)", color: "var(--text)" }}
            data-testid={`find-league-saved-${s.id}`}
          >
            <a href={`/find-league?${s.query}`} className="hover:underline">
              {s.label}
            </a>
            <button
              type="button"
              onClick={() => void remove(s.id)}
              aria-label={`Stop alerts for ${s.label}`}
              className="ml-1 grid h-6 w-6 place-items-center rounded-full"
              style={{ color: "var(--muted)" }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>
      {status ? (
        <p role="status" className="text-xs" style={{ color: "var(--muted)" }}>
          {status}
        </p>
      ) : null}
    </div>
  )
}
