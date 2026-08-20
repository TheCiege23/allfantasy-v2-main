'use client'

/**
 * Cross-League Player Intelligence phase — Parts 12-13.
 *
 * A real, authenticated "My Players" workspace — not a broad dashboard
 * redesign, reuses the same dark/opacity Tailwind convention already
 * established in `LeagueHubClient.tsx`/`CommissionerOsActionsSummary.tsx`.
 * Fetches from `/api/player-portfolio` (server-derives the user, never
 * trusts a client-supplied id) and renders a filterable/sortable grid plus
 * an inline detail drawer per player, distinguishing loading/empty/
 * no-matches/error states honestly rather than collapsing them into one.
 */
import { useEffect, useMemo, useState } from 'react'
import ExposureAudit from '@/components/exposure/ExposureAudit'
import type { ExposureRow } from '@/components/exposure/ExposureTable'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-commish.css'

interface LeagueRecommendationLite {
  id: string
  domain: string
  type: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  title: string
  summary: string
}

interface CrossLeaguePlayerAppearance {
  canonicalLeagueId: string
  leagueName: string
  provider: string
  sport: string
  season: number
  teamName: string | null
  rosterStatus: string
  record: string | null
  standing: number | null
  recommendation: LeagueRecommendationLite | null
  executionCapability: string
  syncFreshness: { state: string; lastSyncedAt: string | null }
}

interface CrossLeaguePlayerPortfolioItem {
  canonicalPlayerId: string
  displayName: string
  sport: string
  position: string | null
  professionalTeam: string | null
  identityConfidence: 'verified' | 'mapped' | 'ambiguous' | 'unresolved'
  headshotUrl: string | null
  injury: { status: string; freshness: { state: string } } | null
  schedule: { byeWeek: number | null; nextOpponent: string | null; nextGameAt: string | null } | null
  exposure: {
    leagueCount: number
    rosterCount: number
    starterCount: number
    benchCount: number
    injuredReserveCount: number
    taxiCount: number
    percentageOfUserLeagues: number
  }
  leagueAppearances: CrossLeaguePlayerAppearance[]
  actionSummary: { criticalCount: number; highCount: number; topAction: LeagueRecommendationLite | null }
}

interface PortfolioApiResponse {
  items: CrossLeaguePlayerPortfolioItem[]
  totalCount: number
  connectedLeagueCount: number
  unsupportedSports: string[]
  generatedAt: string
}

const INJURY_LABEL: Record<string, string> = {
  healthy: 'Healthy',
  questionable: 'Questionable',
  doubtful: 'Doubtful',
  out: 'Out',
  ir: 'IR',
  suspended: 'Suspended',
  day_to_day: 'Day-to-day',
  unknown: 'Unknown',
}

const INJURY_COLOR: Record<string, string> = {
  healthy: 'text-emerald-400',
  questionable: 'text-amber-400',
  doubtful: 'text-amber-400',
  out: 'text-red-400',
  ir: 'text-red-400',
  suspended: 'text-red-400',
  day_to_day: 'text-amber-400',
  unknown: 'text-white/40',
}

const ROSTER_STATUS_LABEL: Record<string, string> = {
  starter: 'Starting',
  bench: 'Bench',
  ir: 'IR',
  taxi: 'Taxi',
  reserve: 'Reserve',
  minor: 'Minors',
  inactive: 'Inactive',
  unknown: 'Unknown',
}

type SortKey = 'action_urgency' | 'exposure' | 'name' | 'injury_severity' | 'bye_week' | 'league_count'

/**
 * Portfolio item -> 12b audit row.
 *
 * ⚠ `identityConfidence` DECIDES WHETHER A NAME IS SHOWN. 'unresolved' means the
 * roster carries an id we could not map to a player, and the audit's footer
 * promises we show the slot rather than a guess. `displayName` is often a
 * best-effort placeholder in that state, so it must not be trusted as a name.
 */
function toExposureRow(item: CrossLeaguePlayerPortfolioItem): ExposureRow {
  const e = item.exposure
  return {
    playerId: item.canonicalPlayerId,
    name: item.displayName || null,
    position: item.position,
    team: item.professionalTeam,
    leagueCount: e.leagueCount,
    leagueNames: item.leagueAppearances.map((a) => a.leagueName).filter(Boolean),
    startingCount: e.starterCount,
    benchCount: e.benchCount,
    // The design's bar has three segments; taxi is a reserve slot, so it rides with IR.
    irTaxiCount: e.injuredReserveCount + e.taxiCount,
    // 0-1: `leagueIds.size / connectedLeagueIds.size` in crossLeaguePlayerPortfolio.
    exposurePercent: e.percentageOfUserLeagues,
    injuryStatus: item.injury?.status ?? null,
    identityResolved: item.identityConfidence !== 'unresolved',
  }
}

export function MyPlayersClient() {
  const [data, setData] = useState<PortfolioApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sport, setSport] = useState<string>('all')
  const [injuryFilter, setInjuryFilter] = useState<string>('all')
  const [rosterFilter, setRosterFilter] = useState<string>('all')
  const [actionOnly, setActionOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('action_urgency')
  const [selected, setSelected] = useState<CrossLeaguePlayerPortfolioItem | null>(null)
  /*
   * 12b. `/my-players` is the destination DashboardV2 already labels "Full
   * exposure audit"; until now it only had the card list. Both views read the
   * one payload below, so they cannot disagree about a player's league count.
   */
  const [view, setView] = useState<'players' | 'audit'>('players')

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError(null)
    const params = new URLSearchParams({ sort })
    if (sport !== 'all') params.set('sport', sport)
    fetch(`/api/player-portfolio?${params.toString()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load player portfolio'))))
      .then((payload: PortfolioApiResponse) => {
        if (!active) return
        setData(payload)
      })
      .catch(() => {
        if (!active) return
        setError('Could not load your players right now.')
      })
      .finally(() => {
        if (!active) return
        setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [sport, sort])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.items.filter((item) => {
      if (search && !item.displayName.toLowerCase().includes(search.toLowerCase())) return false
      if (injuryFilter !== 'all' && item.injury?.status !== injuryFilter) return false
      if (rosterFilter !== 'all' && !item.leagueAppearances.some((a) => a.rosterStatus === rosterFilter)) return false
      if (actionOnly && item.actionSummary.criticalCount === 0 && item.actionSummary.highCount === 0) return false
      return true
    })
  }, [data, search, injuryFilter, rosterFilter, actionOnly])

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold text-white">My Players</h1>
      <p className="mt-1 text-sm text-white/50">Every player you roster across every connected league, in one place.</p>

      <div className="mt-4 flex gap-2" role="tablist" aria-label="My players views">
        {([
          { id: 'players' as const, label: 'Players' },
          { id: 'audit' as const, label: 'Exposure audit' },
        ]).map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={
              view === v.id
                ? 'rounded-full border border-cyan-400/40 bg-cyan-400/15 px-3.5 py-1.5 text-sm font-bold text-cyan-200'
                : 'rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-sm font-semibold text-white/60'
            }
          >
            {v.label}
          </button>
        ))}
      </div>

      {data && data.unsupportedSports.length > 0 ? (
        <p className="mt-3 text-xs text-white/40">
          Schedule/bye data isn&apos;t available yet for: {data.unsupportedSports.join(', ')}.
        </p>
      ) : null}

      {/*
        ⚠ CONDITIONAL RENDER, NOT THE `hidden` ATTRIBUTE. `[hidden]` sets
        `display:none` at low specificity and Tailwind's `flex` utility overrides
        it — the players filter bar stayed on screen over the audit table.
      */}
      <div className="mt-6 flex flex-wrap items-center gap-2" style={{ display: view === 'players' ? undefined : 'none' }}>
        <input
          type="text"
          placeholder="Search players..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-cyan-400/40 focus:outline-none"
        />
        <select
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white/80"
        >
          <option value="all">All sports</option>
          <option value="NFL">NFL</option>
          <option value="NBA">NBA</option>
          <option value="MLB">MLB</option>
          <option value="NHL">NHL</option>
        </select>
        <select
          value={injuryFilter}
          onChange={(e) => setInjuryFilter(e.target.value)}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white/80"
        >
          <option value="all">Any injury status</option>
          {Object.entries(INJURY_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={rosterFilter}
          onChange={(e) => setRosterFilter(e.target.value)}
          className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white/80"
        >
          <option value="all">Any roster status</option>
          {Object.entries(ROSTER_STATUS_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-white/70">
          <input type="checkbox" checked={actionOnly} onChange={(e) => setActionOnly(e.target.checked)} />
          Needs action
        </label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="ml-auto rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white/80"
        >
          <option value="action_urgency">Sort: Action urgency</option>
          <option value="exposure">Sort: Exposure</option>
          <option value="name">Sort: Name</option>
          <option value="injury_severity">Sort: Injury severity</option>
          <option value="bye_week">Sort: Bye week</option>
          <option value="league_count">Sort: League count</option>
        </select>
      </div>

      {view === 'audit' ? (
        <div className="mt-5">
          {isLoading ? (
            <p className="text-sm text-white/50">Loading your rosters…</p>
          ) : error ? (
            <p className="text-sm text-red-300">{error}</p>
          ) : !data || data.items.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/50">
              No connected leagues found yet. Import or create a league to see your exposure here.
            </p>
          ) : (
            <ExposureAudit
              rows={data.items.map(toExposureRow)}
              connectedLeagueCount={data.connectedLeagueCount}
            />
          )}
        </div>
      ) : null}

      <div className="mt-4" style={{ display: view === 'players' ? undefined : 'none' }}>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl border border-white/10 bg-white/5" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-red-300">{error}</p>
        ) : !data || data.items.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/50">
            No connected leagues found yet. Import or create a league to see your players here.
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/50">
            No players match these filters.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="my-players-grid">
            {filtered.map((item) => (
              <PlayerCard key={item.canonicalPlayerId} item={item} onSelect={() => setSelected(item)} />
            ))}
          </div>
        )}
      </div>

      {selected && view === 'players' ? (
        <PlayerDetailDrawer item={selected} onClose={() => setSelected(null)} />
      ) : null}
    </main>
  )
}

function PlayerCard({ item, onSelect }: { item: CrossLeaguePlayerPortfolioItem; onSelect: () => void }) {
  const urgent = item.actionSummary.criticalCount > 0 || item.actionSummary.highCount > 0
  return (
    <button
      type="button"
      onClick={onSelect}
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.05]"
    >
      <div className="flex items-center gap-3">
        {item.headshotUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.headshotUrl} alt="" className="h-9 w-9 flex-shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white/60">
            {item.displayName.charAt(0)}
          </span>
        )}
        <div className="flex flex-1 items-center justify-between">
          <span className="text-sm font-semibold text-white">{item.displayName}</span>
          {urgent ? <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-300">Action</span> : null}
        </div>
      </div>
      <p className="mt-0.5 text-xs text-white/50">
        {item.position ?? '—'} · {item.professionalTeam ?? 'Free Agent'}
      </p>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className={INJURY_COLOR[item.injury?.status ?? 'unknown']}>{INJURY_LABEL[item.injury?.status ?? 'unknown']}</span>
        {item.schedule?.byeWeek ? <span className="text-white/40">Bye {item.schedule.byeWeek}</span> : null}
      </div>
      <p className="mt-2 text-[11px] text-white/40">
        {item.exposure.leagueCount} league{item.exposure.leagueCount === 1 ? '' : 's'} · {item.exposure.starterCount} starting
      </p>
      {item.identityConfidence === 'ambiguous' || item.identityConfidence === 'unresolved' ? (
        <p className="mt-1 text-[10px] text-amber-400/70">Identity {item.identityConfidence}</p>
      ) : null}
    </button>
  )
}

function PlayerDetailDrawer({ item, onClose }: { item: CrossLeaguePlayerPortfolioItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-[#0b0b0f] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{item.displayName}</h2>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white">
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm text-white/50">
          {item.position ?? '—'} · {item.professionalTeam ?? 'Free Agent'} · {item.sport}
        </p>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full border border-white/10 px-2 py-1 ${INJURY_COLOR[item.injury?.status ?? 'unknown']}`}>
            {INJURY_LABEL[item.injury?.status ?? 'unknown']}
          </span>
          {item.schedule?.byeWeek ? (
            <span className="rounded-full border border-white/10 px-2 py-1 text-white/70">Bye week {item.schedule.byeWeek}</span>
          ) : null}
          {item.schedule?.nextOpponent ? (
            <span className="rounded-full border border-white/10 px-2 py-1 text-white/70">Next: {item.schedule.nextOpponent}</span>
          ) : null}
        </div>

        <h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-white/40">
          League appearances ({item.leagueAppearances.length})
        </h3>
        <div className="mt-2 flex flex-col gap-2">
          {item.leagueAppearances.map((a) => (
            <div key={a.canonicalLeagueId} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">{a.leagueName}</span>
                <span className="text-[10px] uppercase text-white/30">{a.provider}</span>
              </div>
              <p className="mt-0.5 text-xs text-white/50">
                {a.teamName ?? 'Your team'} · {ROSTER_STATUS_LABEL[a.rosterStatus] ?? a.rosterStatus}
                {a.record ? ` · ${a.record}` : ''}
              </p>
              {a.recommendation ? (
                <div className="mt-2 rounded-md border border-white/10 bg-black/20 p-2">
                  <p className="text-xs font-medium text-white">{a.recommendation.title}</p>
                  <p className="mt-0.5 text-[11px] text-white/50">{a.recommendation.summary}</p>
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-white/30">No action needed in this league.</p>
              )}
              <p className="mt-1 text-[10px] text-white/30">
                {a.executionCapability === 'native_execute'
                  ? 'Executable in AllFantasy'
                  : a.executionCapability === 'copy_action'
                    ? 'Copy action to provider'
                    : 'Recommendation only — open provider to act'}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
