'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import StandingsTable, { type StandingsRow } from '@/components/standings/StandingsTable'

/**
 * Standings 9a.
 *
 * ⚠ WHAT THE HANDOFF SPECIFIES BUT THIS SCREEN DOES NOT SHIP, AND WHY.
 * The playoff-odds column, the "What clinches it" checklist, the Chimmy headline, the
 * "eliminated" state and the last-3 difficulty tags are all outputs of a season simulation
 * ("3% of sims" in the handoff's own copy). No such engine exists in this repo — `lib/` has no
 * playoff-odds code — and a hand-waved 81% would read to a manager as knowledge while being
 * decoration. Omitted until something real backs it, rather than shipped hollow.
 *
 * ⚠ WHAT PREDATES THE HANDOFF AND IS KEPT. Season selector + `?season=` sync (past seasons are
 * otherwise unreachable), manual refresh, the category-mode CAT column, ties, the Matchups link,
 * and the loading / error / "run weekly scoring processing" states. The handoff is silent on
 * these rather than removing them.
 *
 * ⚠ ONE DELIBERATE DEVIATION FROM THE SCREENSHOT. Its search field reads "Search players"; on a
 * standings screen the actionable filter is over TEAMS, and a player search here would be a
 * control that does nothing. It filters teams and says so.
 */

type Tab = 'overall' | 'power' | 'allplay' | 'playoff'

/** Tabs whose ordering this screen can actually compute today. */
const TAB_DEFS: { id: Tab; label: string; enabled: boolean; why?: string }[] = [
  { id: 'overall', label: 'Overall', enabled: true },
  { id: 'allplay', label: 'All-play', enabled: true },
  {
    id: 'power',
    label: 'Power',
    enabled: false,
    why: 'Power rating needs a weighting model this league does not have yet.',
  },
  {
    id: 'playoff',
    label: 'Playoff picture',
    enabled: false,
    why: 'Needs the season simulation that playoff odds come from.',
  },
]

/** "92-29" / "92-29-1" → win percentage, for the All-play ordering. */
function allPlayPct(v: string | undefined): number {
  if (!v) return -1
  const parts = v.split('-').map((n) => Number.parseInt(n, 10))
  if (parts.some((n) => !Number.isFinite(n))) return -1
  const [w = 0, l = 0, t = 0] = parts
  const total = w + l + t
  return total === 0 ? -1 : (w + t / 2) / total
}

export default function StandingsPage({
  leagueId,
  initialSeason,
}: {
  leagueId: string
  initialSeason: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [season, setSeason] = useState(initialSeason)
  const [rows, setRows] = useState<StandingsRow[]>([])
  const [scoringMode, setScoringMode] = useState<'points' | 'h2h_category' | 'roto'>('points')
  const [viewerRosterId, setViewerRosterId] = useState<string | null>(null)
  const [playoffCut, setPlayoffCut] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overall')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/leagues/${leagueId}/scoring/standings?season=${season}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load')
      const list = Array.isArray(data.standings) ? data.standings : []
      const mode =
        data.scoringMode === 'h2h_category' || data.scoringMode === 'roto'
          ? data.scoringMode
          : 'points'
      setScoringMode(mode)
      setViewerRosterId(typeof data.viewerRosterId === 'string' ? data.viewerRosterId : null)
      setPlayoffCut(typeof data.playoffCut === 'number' ? data.playoffCut : null)
      setRows(
        list.map(
          (r: StandingsRow & Record<string, unknown>): StandingsRow => ({
            rosterId: r.rosterId,
            teamName: r.teamName,
            wins: r.wins,
            losses: r.losses,
            ties: r.ties,
            pointsFor: r.pointsFor,
            pointsAgainst: r.pointsAgainst,
            rank: r.rank,
            categoryWinsFor: r.categoryWinsFor ?? 0,
            categoryLossesFor: r.categoryLossesFor ?? 0,
            categoryTiesFor: r.categoryTiesFor ?? 0,
            streak: typeof r.streak === 'string' ? r.streak : undefined,
            allPlay: typeof r.allPlay === 'string' ? r.allPlay : undefined,
          }),
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [leagueId, season])

  useEffect(() => {
    void load()
  }, [load])

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? rows.filter((r) => r.teamName.toLowerCase().includes(q)) : rows
    if (tab !== 'allplay') return filtered
    return [...filtered].sort((a, b) => allPlayPct(b.allPlay) - allPlayPct(a.allPlay))
  }, [rows, query, tab])

  /*
   * The cut divider marks a position in the STANDINGS order. Once the table is re-sorted by
   * all-play or narrowed by a filter, that position no longer means anything, so it is withheld
   * rather than drawn in a place it does not belong.
   */
  const cutForView = tab === 'overall' && !query.trim() ? playoffCut : null

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black tracking-[-0.02em] text-white">Standings</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter teams"
            aria-label="Filter teams"
            data-testid="standings-filter"
            className="w-56 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-cyan-400/60 focus:outline-none focus:ring-[3px] focus:ring-cyan-400/15"
          />
          <span className="rounded-lg border border-white/10 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
            Read-only
          </span>
        </div>
      </div>

      {/* Tabs + legend */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1"
          role="tablist"
          aria-label="Standings view"
        >
          {TAB_DEFS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              disabled={!t.enabled}
              title={t.why}
              onClick={() => t.enabled && setTab(t.id)}
              data-testid={`standings-tab-${t.id}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                tab === t.id
                  ? 'bg-cyan-400/15 text-cyan-300'
                  : t.enabled
                    ? 'text-white/70 hover:text-white'
                    : 'cursor-not-allowed text-white/25'
              }`}
            >
              {t.label}
              {!t.enabled ? (
                <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/25">
                  soon
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 font-mono text-[10px] uppercase tracking-[0.1em] text-white/45">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-cyan-400" /> you
          </span>
          {cutForView != null ? (
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 bg-amber-400" /> playoff cut · top {cutForView}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-12 text-cyan-300">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : null}
          {error ? (
            <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}
          {!loading && rows.length === 0 && !error ? (
            <p className="py-10 text-center text-sm text-white/50">
              No standings yet — run weekly scoring processing.
            </p>
          ) : null}
          {!loading && rows.length > 0 && visibleRows.length === 0 ? (
            <p className="py-10 text-center text-sm text-white/50">No team matches “{query}”.</p>
          ) : null}
          {visibleRows.length > 0 ? (
            <StandingsTable
              rows={visibleRows}
              scoringMode={scoringMode}
              viewerRosterId={viewerRosterId}
              playoffCut={cutForView}
            />
          ) : null}
        </div>

        {/* Right column */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
              Season
            </h2>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="number"
                aria-label="Season"
                className="w-24 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
                value={season}
                onChange={(e) => {
                  const next = Number(e.target.value) || initialSeason
                  setSeason(next)
                  const params = new URLSearchParams(searchParams?.toString() ?? '')
                  params.set('season', String(next))
                  router.push(`${pathname}?${params.toString()}`)
                }}
              />
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-bold text-cyan-100"
              >
                Refresh
              </button>
            </div>
            <Link
              href={`/league/${leagueId}/matchups`}
              className="mt-3 inline-block text-xs font-bold text-cyan-300 hover:text-cyan-200"
            >
              Matchups →
            </Link>
          </div>

          {/*
           * Handoff build rule 5: the source note must always disclose which numbers mirror the
           * platform and which are AllFantasy's own. Streak and all-play are ours (derived from
           * weekly results); everything else mirrors the source.
           */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
              Standings source
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-white/60">
              Record, points for and points against mirror your league&apos;s platform. Streak and
              all-play are AllFantasy&apos;s own math, derived from the same weekly results.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-white/40">
              Playoff odds and clinching scenarios aren&apos;t computed yet — we&apos;d rather show
              nothing than a number we can&apos;t stand behind.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
