'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import type {
  PortfolioInsights,
  PortfolioLeagueFacts,
  PortfolioPlayer,
  RecordedValueDay,
} from '@/lib/core-app/portfolioInsightsTypes'
import {
  diversification,
  distribution,
  exposureRows,
  filterLeagues,
  isEmptyFilter,
  isUrgent,
  leagueMovesOn,
  leagueValueChanges,
  rankActions,
  readableRosterCount,
  riskRows,
  serializeFilter,
  toggleValue,
  valueTotals,
  EMPTY_FILTER,
  FILTER_PARAMS,
  type ActionKind,
  type DistributionDimension,
  type FormatModifier,
  type Importance,
  type LineupSignal,
  type PortfolioExtras,
  type PortfolioFilter,
  type PortfolioViewKey,
  VIEW_PARAM,
} from '@/lib/core-app/portfolioView'
import type { ImpactSlot, PlayerLeagueImpact } from '@/lib/core-app/playerLeagueImpact'
import { impactText, SLOT_LABEL } from '@/components/core-app/screens/ExposureImpact'
import {
  BarList,
  ChartScroll,
  Heatmap,
  Legend,
  LevelSwatch,
  LineChart,
  LineKey,
  Sparkline,
  formatCompact,
  formatValue,
} from './PortfolioCharts'

/**
 * `/core/portfolio` — the cross-league board: filters, then five views over the same leagues.
 *
 * ⚠ ONE FILTER SCOPES EVERY VIEW. The numbers on the Overview, the exposure shares, the risk grid,
 * the value line and the league list are all recounted from the same filtered league set, so a
 * reader who filters to "dynasty contenders" never sees an exposure share computed over redraft
 * leagues beside a value line that includes them.
 *
 * ⚠ FILTERS AND VIEW LIVE IN THE URL, WRITTEN WITH `history.replaceState`. Shareable and refresh-
 * proof like every other /core filter, without a server round trip — the whole portfolio is
 * already in memory, and re-rendering it on the server to change a chip would be a page load.
 *
 * ⚠ DRILL-DOWNS ARE INLINE, NOT OVERLAYS. Every bar, cell and row opens the exact leagues or
 * players it counts in the list printed directly under its chart — the "supporting list" a phone
 * reader needs anyway. The shell owns the only overlay stack; a second one is how focus traps
 * fight on WebKit.
 */

const VIEWS: Array<{ key: PortfolioViewKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'exposure', label: 'Exposure' },
  { key: 'risk', label: 'Risk' },
  { key: 'value', label: 'Value' },
  { key: 'leagues', label: 'Leagues' },
]

export type PortfolioBoardProps = {
  insights: PortfolioInsights
  recorded: RecordedValueDay[]
  /** Now-facts from the home loader, per league id. Null when that read failed. */
  lineup: Record<string, LineupSignal> | null
  extras: PortfolioExtras
  initialFilter: PortfolioFilter
  initialView: PortfolioViewKey
  /** When the insights were built, and whether we are serving a copy while it rebuilds. */
  builtAt: string | null
  servedStale: boolean
  /**
   * The inventory list, rendered by the screen for the leagues in the filter. `filtered` is false
   * when no filter is set, so the list can show rows the insights did not cover rather than hide them.
   */
  renderLeagues: (leagueIds: ReadonlySet<string>, filtered: boolean) => ReactNode
}

const PLATFORM_LABEL: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  fantrax: 'Fantrax',
  mfl: 'MyFantasyLeague',
  fleaflicker: 'Fleaflicker',
  manual: 'Manual',
  native: 'AllFantasy',
}

const FAMILY_LABEL: Record<string, string> = {
  dynasty: 'Dynasty',
  keeper: 'Keeper',
  redraft: 'Redraft',
  other: 'Other formats',
}
const SCORING_LABEL: Record<string, string> = {
  ppr: 'PPR',
  half_ppr: 'Half PPR',
  standard: 'Standard',
  unknown: 'Rulebook not stored',
}
const STATUS_LABEL: Record<string, string> = {
  contender: 'Contending',
  middle: 'Middle of the pack',
  rebuild: 'Rebuilding',
  unknown: 'Not enough to say',
}
const STAGE_LABEL: Record<string, string> = {
  drafting: 'Drafting',
  pre_draft: 'Pre-draft',
  in_season: 'In season',
  complete: 'Season over',
  unknown: 'Stage unknown',
}
const STATUS_SOURCE_LABEL: Record<string, string> = {
  you: 'you told Chimmy',
  standings: 'from the standings',
  roster_value: 'from roster value',
  standings_and_value: 'from standings and roster value',
}
const MODIFIER_LABEL: Record<FormatModifier, string> = { best_ball: 'Best ball', idp: 'IDP', superflex: 'Superflex' }
const IMPORTANCE_LABEL: Record<Importance, string> = { favorite: 'Favorites', commissioner: 'You commish', paid: 'Paid' }
const ACTION_LABEL: Record<ActionKind, string> = { lineup: 'Lineup', waiver: 'Waivers', trade: 'Trades', draft: 'Draft' }
const ACTION_CTA: Record<ActionKind, string> = {
  lineup: 'Set lineup',
  waiver: 'Open waivers',
  trade: 'Open trades',
  draft: 'Open Draft HQ',
}

const DIMENSIONS: Array<{ key: DistributionDimension; label: string; filter?: keyof PortfolioFilter }> = [
  { key: 'platform', label: 'Platform', filter: 'platforms' },
  { key: 'family', label: 'Format', filter: 'families' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'sport', label: 'Sport', filter: 'sports' },
  { key: 'status', label: 'Competitive status', filter: 'status' },
  { key: 'stage', label: 'Season stage', filter: 'stages' },
]

function bucketLabel(dimension: DistributionDimension, key: string): string {
  if (dimension === 'platform') return PLATFORM_LABEL[key] ?? key
  if (dimension === 'family') return FAMILY_LABEL[key] ?? key
  if (dimension === 'scoring') return SCORING_LABEL[key] ?? key
  if (dimension === 'status') return STATUS_LABEL[key] ?? key
  if (dimension === 'stage') return STAGE_LABEL[key] ?? key
  return key
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const pct = (x: number) => `${Math.round(x * 100)}%`

/** "Sep 3" from a capture day. UTC, because the key is a UTC midnight — Eastern would print Sep 2. */
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function signed(n: number): string {
  const r = Math.round(n)
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${formatCompact(Math.abs(r))}`
}

function useRelativeTime(iso: string | null): string | null {
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    if (!iso) return
    const at = Date.parse(iso)
    if (Number.isNaN(at)) return
    const tick = () => {
      const min = Math.max(0, Math.round((Date.now() - at) / 60_000))
      setLabel(min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`)
    }
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [iso])
  return label
}

function leagueHref(id: string) {
  return `/core?league=${encodeURIComponent(id)}`
}

function PlayerLine({ p, extra }: { p: PortfolioPlayer; extra?: ReactNode }) {
  return (
    <span className="af-pfb-player">
      <span className="af-pfb-player-name">{p.name}</span>
      <span className="af-pfb-player-meta">
        {[p.position, p.team].filter(Boolean).join(' · ') || p.sport}
        {p.byeWeek != null ? ` · bye wk ${p.byeWeek}` : ''}
      </span>
      {p.injury ? (
        <span className="af-pfb-badge" data-tone={p.injury.kind === 'out' ? 'bad' : 'warn'}>
          {p.injury.status}
        </span>
      ) : null}
      {extra}
    </span>
  )
}

function LeagueChip({ league }: { league: PortfolioLeagueFacts }) {
  return (
    <Link href={leagueHref(league.id)} className="af-pfb-league-chip">
      <span className="af-pfb-plat" data-platform={league.platform}>
        {PLATFORM_LABEL[league.platform] ?? league.platform}
      </span>
      {league.name}
    </Link>
  )
}

/** "If he sits" for one player — the home card's breakdown, fetched on demand from the same route. */
function IfHeSits({ playerId }: { playerId: string }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: PlayerLeagueImpact }>({
    kind: 'loading',
  })
  useEffect(() => {
    let live = true
    fetch(`/api/core/player-card?sport=NFL&sleeperId=${encodeURIComponent(playerId)}&impact=1`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as { impact?: PlayerLeagueImpact }
        if (!body.impact) throw new Error('no impact')
        if (live) setState({ kind: 'ready', data: body.impact })
      })
      .catch(() => live && setState({ kind: 'error' }))
    return () => {
      live = false
    }
  }, [playerId])

  if (state.kind === 'loading') return <p className="af-pfb-note">Pricing this week’s matchups…</p>
  if (state.kind === 'error') return <p className="af-pfb-note">Couldn’t price his matchups just now.</p>
  const starting = state.data.rows.filter((r) => r.slot === 'starter')
  if (starting.length === 0) return <p className="af-pfb-note">He isn’t in any of your lineups this week, so benching him changes nothing.</p>
  return (
    <div className="af-pfb-impact">
      <p className="af-pfb-note">This week’s win chance — now → if he scores 0 from here.</p>
      <ul>
        {starting.map((r) => {
          const t = impactText(r)
          return (
            <li key={r.leagueId} data-big={t.drop != null && t.drop >= 15 ? 'true' : undefined}>
              <span>{r.leagueName}</span>
              <span className="af-pfb-muted">{SLOT_LABEL[r.slot as ImpactSlot]}</span>
              <span className="af-num" title={t.title}>
                {t.text}
              </span>
            </li>
          )
        })}
      </ul>
      {state.data.notPriced > 0 ? (
        <p className="af-pfb-note">{plural(state.data.notPriced, 'more league')} not priced here — open Matchup for those.</p>
      ) : null}
    </div>
  )
}

export function PortfolioBoard({
  insights,
  recorded,
  lineup,
  extras,
  initialFilter,
  initialView,
  builtAt,
  servedStale,
  renderLeagues,
}: PortfolioBoardProps) {
  const [filter, setFilter] = useState<PortfolioFilter>(initialFilter)
  const [view, setView] = useState<PortfolioViewKey>(initialView)
  const [dist, setDist] = useState<{ dimension: DistributionDimension; key: string } | null>(null)
  const [openPlayer, setOpenPlayer] = useState<string | null>(null)
  const [event, setEvent] = useState<string | null>(null)
  const [cell, setCell] = useState<{ row: string; column: string } | null>(null)
  const [valueLeague, setValueLeague] = useState<number | null>(null)
  const [valueDay, setValueDay] = useState<string | null>(null)
  const [exposureQuery, setExposureQuery] = useState('')
  const [exposureLimit, setExposureLimit] = useState(40)
  const [multiOnly, setMultiOnly] = useState(true)
  const builtLabel = useRelativeTime(builtAt)

  /* URL sync — replaceState, never a navigation. Other params on the URL are kept as they are. */
  useEffect(() => {
    const url = new URL(window.location.href)
    for (const p of Object.values(FILTER_PARAMS)) url.searchParams.delete(p)
    for (const [k, v] of serializeFilter(filter)) url.searchParams.set(k, v)
    if (view === 'overview') url.searchParams.delete(VIEW_PARAM)
    else url.searchParams.set(VIEW_PARAM, view)
    const next = `${url.pathname}${url.search}${url.hash}`
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', next)
    }
  }, [filter, view])

  const all = useMemo(() => insights.leagues.map((_, i) => i), [insights])
  const indexes = useMemo(() => filterLeagues(insights, filter, extras), [insights, filter, extras])
  const idSet = useMemo(() => new Set(indexes.map((i) => insights.leagues[i].id)), [indexes, insights])
  const playerByKey = useMemo(() => new Map(insights.players.map((p) => [p.key, p])), [insights])
  const exposure = useMemo(() => exposureRows(insights, indexes), [insights, indexes])
  const risk = useMemo(() => riskRows(insights, indexes), [insights, indexes])
  const div = useMemo(() => diversification(insights, indexes), [insights, indexes])
  const actions = useMemo(() => rankActions(insights, indexes, lineup ?? {}, extras), [insights, indexes, lineup, extras])
  const valueIndexes = useMemo(
    () => (valueLeague != null && indexes.includes(valueLeague) ? [valueLeague] : indexes),
    [valueLeague, indexes],
  )
  const totals = useMemo(() => valueTotals(insights, valueIndexes, recorded), [insights, valueIndexes, recorded])
  const changes = useMemo(() => leagueValueChanges(insights, indexes), [insights, indexes])
  const readable = readableRosterCount(insights, indexes)
  const urgentCount = actions.filter(isUrgent).length

  /* Counts on each chip are over the WHOLE portfolio, so a chip never reads 0 because of another chip. */
  const favorites = useMemo(() => new Set(extras.favoriteIds), [extras])
  const paid = useMemo(() => new Set(extras.paidIds), [extras])
  const countWhere = (pred: (l: PortfolioLeagueFacts) => boolean) => insights.leagues.filter(pred).length
  const platforms = distribution(insights, all, 'platform')
  const sports = distribution(insights, all, 'sport')

  function chip<K extends keyof PortfolioFilter>(key: K, value: PortfolioFilter[K][number], label: string, count: number) {
    const on = (filter[key] as string[]).includes(value as string)
    if (count === 0 && !on) return null
    return (
      <button
        key={`${String(key)}:${String(value)}`}
        type="button"
        className="af-pfb-chip"
        aria-pressed={on}
        onClick={() => {
          setFilter((f) => toggleValue(f, key, value))
          setDist(null)
          setCell(null)
          setEvent(null)
        }}
      >
        {label} <span className="af-num">{count}</span>
      </button>
    )
  }

  const filtered = !isEmptyFilter(filter)

  // ── overview pieces ──
  const topExposure = exposure.find((r) => r.count >= 2) ?? null
  const pricedTotals = totals.filter((t) => t.total != null)
  const firstTotal = pricedTotals[0] ?? null
  const lastTotal = pricedTotals[pricedTotals.length - 1] ?? null
  const valueDelta =
    firstTotal && lastTotal && pricedTotals.length >= 2 && firstTotal.total && lastTotal.total != null
      ? { delta: lastTotal.total - firstTotal.total, pct: (lastTotal.total - firstTotal.total) / firstTotal.total }
      : null
  const contenders = indexes.filter((i) => insights.leagues[i].status === 'contender').length
  const rebuilds = indexes.filter((i) => insights.leagues[i].status === 'rebuild').length

  const distSelected = dist ? distribution(insights, indexes, dist.dimension).find((b) => b.key === dist.key) ?? null : null
  const distFilterKey = dist ? DIMENSIONS.find((d) => d.key === dist.dimension)?.filter : undefined

  // ── exposure pieces ──
  const q = exposureQuery.trim().toLowerCase()
  const exposureShown = exposure.filter(
    (r) => (!multiOnly || r.count >= 2) && (!q || r.player.name.toLowerCase().includes(q) || (r.player.team ?? '').toLowerCase() === q),
  )
  const teamBars = (() => {
    const agg = new Map<string, { starters: number; leagues: Set<number> }>()
    for (const r of exposure) {
      if (!r.player.team || r.player.sport !== 'NFL' || r.starts === 0) continue
      const a = agg.get(r.player.team) ?? { starters: 0, leagues: new Set<number>() }
      a.starters += r.starts
      for (const l of r.leagues) if (l.slot === 'S') a.leagues.add(l.index)
      agg.set(r.player.team, a)
    }
    return [...agg.entries()]
      .sort((a, b) => b[1].starters - a[1].starters || a[0].localeCompare(b[0]))
      .slice(0, 10)
  })()
  const selectedEvent = event ? div.events.find((e) => e.key === event) ?? null : null
  const selectedTeam = event?.startsWith('teambar:') ? event.slice('teambar:'.length) : null

  // ── risk pieces ──
  const selectedRiskRow = cell ? risk.rows.find((r) => String(r.index) === cell.row) ?? null : null
  const selectedRiskColumnIndex = cell ? risk.columns.findIndex((c) => c.id === cell.column) : -1
  const selectedRiskCell =
    selectedRiskRow && selectedRiskColumnIndex >= 0 ? selectedRiskRow.cells[selectedRiskColumnIndex] : null

  const dayMoves = valueDay ? leagueMovesOn(insights, valueIndexes, recorded, valueDay) : []

  const valuePoints = totals.map((t) => ({
    key: t.date,
    label: dayLabel(t.date),
    value: t.total,
    estimated: t.estimated,
    note: `${plural(t.leagues, 'league')} priced`,
  }))

  return (
    <div className="af-pfb">
      {/* ── filters: one row above everything they scope ── */}
      <div className="af-pfb-filters" role="group" aria-label="Filter your leagues">
        <div className="af-pfb-chiprow">
          <span className="af-pfb-group">Status</span>
          {chip('status', 'contender', 'Contender', countWhere((l) => l.status === 'contender'))}
          {chip('status', 'middle', 'Middle', countWhere((l) => l.status === 'middle'))}
          {chip('status', 'rebuild', 'Rebuild', countWhere((l) => l.status === 'rebuild'))}
          <span className="af-pfb-group">Format</span>
          {chip('families', 'dynasty', 'Dynasty', countWhere((l) => l.family === 'dynasty'))}
          {chip('families', 'redraft', 'Redraft', countWhere((l) => l.family === 'redraft'))}
          {chip('families', 'keeper', 'Keeper', countWhere((l) => l.family === 'keeper'))}
          {(['best_ball', 'idp', 'superflex'] as FormatModifier[]).map((m) =>
            chip(
              'modifiers',
              m,
              MODIFIER_LABEL[m],
              countWhere((l) => (m === 'best_ball' ? l.bestBall : m === 'idp' ? l.idp : l.superflex)),
            ),
          )}
          <span className="af-pfb-group">Importance</span>
          {chip('importance', 'favorite', IMPORTANCE_LABEL.favorite, countWhere((l) => favorites.has(l.id)))}
          {chip('importance', 'commissioner', IMPORTANCE_LABEL.commissioner, countWhere((l) => l.commissioner))}
          {chip('importance', 'paid', IMPORTANCE_LABEL.paid, countWhere((l) => paid.has(l.id)))}
          {platforms.length > 1 ? <span className="af-pfb-group">Platform</span> : null}
          {platforms.length > 1
            ? platforms.map((b) => chip('platforms', b.key, PLATFORM_LABEL[b.key] ?? b.key, b.count))
            : null}
          {sports.length > 1 ? <span className="af-pfb-group">Sport</span> : null}
          {sports.length > 1 ? sports.map((b) => chip('sports', b.key, b.key, b.count)) : null}
        </div>
        <p className="af-pfb-scope" aria-live="polite">
          Showing <strong className="af-num">{indexes.length}</strong> of {insights.leagues.length} leagues
          {readable < indexes.length ? ` · ${plural(indexes.length - readable, 'league')} with no roster players yet` : ''}
          {filtered ? (
            <button type="button" className="af-pfb-clear" onClick={() => setFilter(EMPTY_FILTER)}>
              Clear filters
            </button>
          ) : null}
          {builtLabel ? (
            <span className="af-pfb-built">
              · built {builtLabel}
              {servedStale ? ', refreshing' : ''}
            </span>
          ) : null}
        </p>
      </div>

      <div className="af-bd-tabs" role="tablist" aria-label="Portfolio views">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            className="af-bd-tab"
            aria-selected={view === v.key}
            aria-current={view === v.key ? 'page' : undefined}
            onClick={() => setView(v.key)}
          >
            {v.label}
            {v.key === 'overview' && urgentCount > 0 ? <span className="af-bd-tab-n">{urgentCount}</span> : null}
            {v.key === 'leagues' ? <span className="af-bd-tab-n">{indexes.length}</span> : null}
          </button>
        ))}
      </div>

      {indexes.length === 0 ? (
        <div className="af-pf-empty">
          <p className="af-pf-empty-title">No league matches every filter.</p>
          <div className="af-pf-empty-actions">
            <button type="button" className="af-pf-btn" onClick={() => setFilter(EMPTY_FILTER)}>
              Clear filters
            </button>
          </div>
        </div>
      ) : null}

      {/* ────────────────────────── OVERVIEW ────────────────────────── */}
      {view === 'overview' && indexes.length > 0 ? (
        <>
          <div className="af-pfb-kpis">
            <button type="button" className="af-pfb-kpi" onClick={() => setView('leagues')}>
              <span className="af-pfb-kpi-label">Leagues in view</span>
              <strong className="af-pfb-kpi-value">{indexes.length}</strong>
              <span className="af-pfb-kpi-sub">
                {contenders} contending · {rebuilds} rebuilding
              </span>
            </button>
            <button type="button" className="af-pfb-kpi" onClick={() => setView('exposure')}>
              <span className="af-pfb-kpi-label">Players held</span>
              <strong className="af-pfb-kpi-value">{exposure.length}</strong>
              <span className="af-pfb-kpi-sub">
                {plural(exposure.filter((r) => r.count >= 2).length, 'player')} on 2+ rosters
              </span>
            </button>
            <button
              type="button"
              className="af-pfb-kpi"
              disabled={!topExposure}
              onClick={() => {
                if (!topExposure) return
                setView('exposure')
                setExposureQuery(topExposure.player.name)
                setOpenPlayer(topExposure.player.key)
              }}
            >
              <span className="af-pfb-kpi-label">Biggest single bet</span>
              <strong className="af-pfb-kpi-value">{topExposure ? pct(topExposure.share) : '—'}</strong>
              <span className="af-pfb-kpi-sub">
                {topExposure
                  ? `${topExposure.player.name} · ${topExposure.count} of ${topExposure.of} rosters`
                  : 'No player is on two of your rosters'}
              </span>
            </button>
            <button type="button" className="af-pfb-kpi" onClick={() => setView('value')}>
              <span className="af-pfb-kpi-label">Roster value, {pricedTotals.length > 1 ? `${pricedTotals.length} days` : 'window'}</span>
              <strong className="af-pfb-kpi-value" data-dir={valueDelta ? (valueDelta.delta >= 0 ? 'up' : 'down') : undefined}>
                {valueDelta ? `${valueDelta.pct >= 0 ? '+' : '−'}${Math.abs(valueDelta.pct * 100).toFixed(1)}%` : '—'}
              </strong>
              <span className="af-pfb-kpi-sub">
                {valueDelta ? `${signed(valueDelta.delta)} since ${dayLabel(firstTotal!.date)}` : 'No priced history for these leagues'}
              </span>
            </button>
          </div>

          <section className="af-pfb-card" aria-labelledby="af-pfb-actions">
            <header className="af-pfb-card-head">
              <div>
                <p className="af-pf-kicker">Do these first</p>
                <h2 id="af-pfb-actions" className="af-pfb-h2">
                  Leagues that need you
                </h2>
              </div>
              {lineup == null ? <span className="af-pfb-muted">Lineup counts unavailable just now</span> : null}
            </header>
            {actions.length === 0 ? (
              <p className="af-pfb-note">Nothing flagged across these leagues — lineups set, no thin spots, no big value drops.</p>
            ) : (
              <ol className="af-pfb-actions">
                {actions.slice(0, 8).map((a) => {
                  const l = insights.leagues[a.index]
                  return (
                    <li key={l.id} className="af-pfb-action">
                      <span className="af-pfb-action-kind" data-kind={a.primary}>
                        {ACTION_LABEL[a.primary]}
                      </span>
                      <span className="af-pfb-action-main">
                        <Link href={leagueHref(l.id)} className="af-pfb-action-name">
                          {favorites.has(l.id) ? <span aria-label="favorite">☆ </span> : null}
                          {l.name}
                        </Link>
                        <span className="af-pfb-action-why">
                          {a.reasons
                            .slice(0, 3)
                            .map((r) => r.text)
                            .join(' · ')}
                        </span>
                      </span>
                      <Link href={a.href} className="af-pf-btn af-pfb-action-cta">
                        {ACTION_CTA[a.primary]}
                      </Link>
                    </li>
                  )
                })}
              </ol>
            )}
            {actions.length > 8 ? <p className="af-pfb-note">{plural(actions.length - 8, 'more league')} with smaller issues.</p> : null}
          </section>

          <section className="af-pfb-card" aria-labelledby="af-pfb-dist">
            <header className="af-pfb-card-head">
              <div>
                <p className="af-pf-kicker">League mix</p>
                <h2 id="af-pfb-dist" className="af-pfb-h2">
                  Where your leagues sit
                </h2>
              </div>
              <span className="af-pfb-muted">Tap a bar to list its leagues</span>
            </header>
            <div className="af-pfb-dist-grid">
              {DIMENSIONS.map((d) => {
                const buckets = distribution(insights, indexes, d.key)
                return (
                  <div key={d.key} className="af-pfb-dist">
                    <h3 className="af-pfb-h3">{d.label}</h3>
                    <BarList
                      ariaLabel={`Leagues by ${d.label.toLowerCase()}`}
                      max={indexes.length}
                      items={buckets.slice(0, 6).map((b) => ({ key: b.key, label: bucketLabel(d.key, b.key), value: b.count }))}
                      selected={dist?.dimension === d.key ? dist.key : null}
                      onSelect={(key) =>
                        setDist((cur) => (cur?.dimension === d.key && cur.key === key ? null : { dimension: d.key, key }))
                      }
                      unit={(n) => String(n)}
                    />
                    {buckets.length > 6 ? (
                      <p className="af-pfb-note">+{buckets.length - 6} smaller groups</p>
                    ) : null}
                  </div>
                )
              })}
            </div>
            {dist && distSelected ? (
              <div className="af-pfb-drill" aria-live="polite">
                <div className="af-pfb-drill-head">
                  <strong>
                    {bucketLabel(dist.dimension, dist.key)} · {plural(distSelected.count, 'league')}
                  </strong>
                  {distFilterKey && dist.key !== 'unknown' && dist.dimension !== 'scoring' ? (
                    <button
                      type="button"
                      className="af-pfb-clear"
                      onClick={() => {
                        setFilter((f) =>
                          (f[distFilterKey] as string[]).includes(dist.key)
                            ? f
                            : toggleValue(f, distFilterKey, dist.key as never),
                        )
                        setDist(null)
                      }}
                    >
                      Filter to these
                    </button>
                  ) : null}
                  <button type="button" className="af-pfb-clear" onClick={() => setDist(null)}>
                    Close
                  </button>
                </div>
                <ul className="af-pfb-drill-list">
                  {distSelected.indexes.map((i) => {
                    const l = insights.leagues[i]
                    return (
                      <li key={l.id}>
                        <LeagueChip league={l} />
                        <span className="af-pfb-muted">
                          {STATUS_LABEL[l.status]}
                          {l.statusSource ? ` (${STATUS_SOURCE_LABEL[l.statusSource]})` : ''}
                          {l.record ? ` · ${l.record.wins}-${l.record.losses}${l.record.ties ? `-${l.record.ties}` : ''}` : ''}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {/* ────────────────────────── EXPOSURE ────────────────────────── */}
      {view === 'exposure' && indexes.length > 0 ? (
        <>
          <section className="af-pfb-card" aria-labelledby="af-pfb-div">
            <header className="af-pfb-card-head">
              <div>
                <p className="af-pf-kicker">Diversification</p>
                <h2 id="af-pfb-div" className="af-pfb-h2">
                  One bad Sunday, several teams
                </h2>
              </div>
              <span className="af-pfb-muted">
                {plural(div.lineups, 'lineup')} · {plural(div.starterSlots, 'starting slot')}
              </span>
            </header>
            {div.topTeam && div.topTeamShare != null ? (
              <p className="af-pfb-copy">
                <strong>{div.topTeam}</strong> fills {pct(div.topTeamShare)} of your NFL starting slots. An even spread
                across 32 clubs would be about 3%.
              </p>
            ) : null}
            {div.events.length === 0 ? (
              <p className="af-pfb-note">No single player, club or bye week reaches two of these lineups.</p>
            ) : (
              <BarList
                ariaLabel="Events that would hit several lineups at once"
                max={Math.max(1, readable)}
                items={div.events.map((e) => ({
                  key: e.key,
                  label:
                    e.kind === 'player'
                      ? `If ${e.label} is ruled out`
                      : e.kind === 'team'
                        ? `If ${e.label} has a bad day`
                        : e.label,
                  hint:
                    e.kind === 'player'
                      ? `on ${plural(e.lineups, 'roster')} · starts in ${e.starters}`
                      : e.kind === 'bye'
                        ? `${plural(e.starters, 'starter')} off, 2+ in each of these lineups`
                        : `${plural(e.starters, 'starter')} across these lineups`,
                  value: e.lineups,
                }))}
                selected={event}
                onSelect={(key) => setEvent((cur) => (cur === key ? null : key))}
                unit={(n) => `${n} of ${readable}`}
              />
            )}
            {selectedEvent ? (
              <div className="af-pfb-drill" aria-live="polite">
                <div className="af-pfb-drill-head">
                  <strong>{selectedEvent.kind === 'player' ? selectedEvent.label : `${selectedEvent.label} — who and where`}</strong>
                  <button type="button" className="af-pfb-clear" onClick={() => setEvent(null)}>
                    Close
                  </button>
                </div>
                <ul className="af-pfb-drill-list">
                  {selectedEvent.players
                    .map((k) => playerByKey.get(k))
                    .filter((p): p is PortfolioPlayer => Boolean(p))
                    .map((p) => (
                      <li key={p.key}>
                        <PlayerLine p={p} />
                      </li>
                    ))}
                </ul>
                <div className="af-pfb-chips">
                  {selectedEvent.indexes.map((i) => (
                    <LeagueChip key={i} league={insights.leagues[i]} />
                  ))}
                </div>
              </div>
            ) : null}

            {teamBars.length > 0 ? (
              <>
                <h3 className="af-pfb-h3">Starters by NFL club</h3>
                <BarList
                  ariaLabel="Your starters by NFL club"
                  items={teamBars.map(([team, a]) => ({
                    key: `teambar:${team}`,
                    label: team,
                    hint: plural(a.leagues.size, 'lineup'),
                    value: a.starters,
                  }))}
                  selected={event}
                  onSelect={(key) => setEvent((cur) => (cur === key ? null : key))}
                  unit={(n) => plural(n, 'starter')}
                />
                {selectedTeam ? (
                  <div className="af-pfb-drill" aria-live="polite">
                    <div className="af-pfb-drill-head">
                      <strong>{selectedTeam} starters</strong>
                      <button type="button" className="af-pfb-clear" onClick={() => setEvent(null)}>
                        Close
                      </button>
                    </div>
                    <ul className="af-pfb-drill-list">
                      {exposure
                        .filter((r) => r.player.team === selectedTeam && r.starts > 0)
                        .map((r) => (
                          <li key={r.player.key}>
                            <PlayerLine p={r.player} extra={<span className="af-pfb-muted">starts in {r.starts}</span>} />
                            <span className="af-pfb-chips">
                              {r.leagues
                                .filter((l) => l.slot === 'S')
                                .map((l) => (
                                  <LeagueChip key={l.index} league={insights.leagues[l.index]} />
                                ))}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : null}
          </section>

          <section className="af-pfb-card" aria-labelledby="af-pfb-exp">
            <header className="af-pfb-card-head">
              <div>
                <p className="af-pf-kicker">Player exposure</p>
                <h2 id="af-pfb-exp" className="af-pfb-h2">
                  How often each player appears
                </h2>
              </div>
              <span className="af-pfb-muted">Values: {insights.playerValueBook}</span>
            </header>
            <div className="af-pfb-toolbar">
              <input
                type="search"
                className="af-pfb-search"
                placeholder="Find a player or club"
                aria-label="Find a player or club"
                value={exposureQuery}
                onChange={(e) => setExposureQuery(e.target.value)}
              />
              <label className="af-pfb-toggle">
                <input type="checkbox" checked={multiOnly} onChange={(e) => setMultiOnly(e.target.checked)} /> On 2+ rosters only
              </label>
            </div>
            {exposureShown.length === 0 ? (
              <p className="af-pfb-note">{multiOnly ? 'No player is on two of these rosters.' : 'No player matches.'}</p>
            ) : (
              <ul className="af-pfb-exposure">
                {exposureShown.slice(0, exposureLimit).map((r) => {
                  const open = openPlayer === r.player.key
                  return (
                    <li key={r.player.key} data-open={open || undefined}>
                      <button
                        type="button"
                        className="af-pfb-exp-row"
                        aria-expanded={open}
                        onClick={() => setOpenPlayer(open ? null : r.player.key)}
                      >
                        <PlayerLine p={r.player} />
                        <span className="af-pfb-exp-meter" aria-hidden="true">
                          <span style={{ width: pct(r.share) }} />
                        </span>
                        <span className="af-pfb-exp-count af-num">
                          {r.count}/{r.of}
                          <small>{r.starts > 0 ? ` · starts ${r.starts}` : ' · bench'}</small>
                        </span>
                        <span className="af-pfb-exp-value af-num">
                          {r.player.value != null ? formatCompact(r.player.value) : '—'}
                          {r.player.valueDelta != null && r.player.valueDelta !== 0 ? (
                            <small data-dir={r.player.valueDelta > 0 ? 'up' : 'down'}> {signed(r.player.valueDelta)}</small>
                          ) : null}
                        </span>
                      </button>
                      {open ? (
                        <div className="af-pfb-drill">
                          <ul className="af-pfb-drill-list">
                            {r.leagues.map((l) => (
                              <li key={l.index}>
                                <LeagueChip league={insights.leagues[l.index]} />
                                <span className="af-pfb-muted">
                                  {l.slot === 'S' ? 'starting' : l.slot === 'I' ? 'IR' : l.slot === 'T' ? 'taxi' : 'bench'}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {r.player.sport === 'NFL' && r.starts > 0 ? <IfHeSits playerId={r.player.id} /> : null}
                          <Link
                            className="af-pfb-clear"
                            href={`/core/players?q=${encodeURIComponent(r.player.name)}&player=${encodeURIComponent(r.player.id)}`}
                          >
                            Open player →
                          </Link>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
            {exposureShown.length > exposureLimit ? (
              <button type="button" className="af-pf-btn" onClick={() => setExposureLimit((n) => n + 40)}>
                Show {Math.min(40, exposureShown.length - exposureLimit)} more of {exposureShown.length}
              </button>
            ) : null}
            {insights.notes.unmatchedPlayers ? (
              <p className="af-pfb-note">
                {plural(insights.notes.unmatchedPlayers, 'roster id')} could not be matched to a player and are listed as
                “Unmatched player”.
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      {/* ────────────────────────── RISK ────────────────────────── */}
      {view === 'risk' && indexes.length > 0 ? (
        <section className="af-pfb-card" aria-labelledby="af-pfb-risk">
          <header className="af-pfb-card-head">
            <div>
              <p className="af-pf-kicker">Risk heatmap</p>
              <h2 id="af-pfb-risk" className="af-pfb-h2">
                Injuries, byes, thin spots and stacks
              </h2>
            </div>
            <Legend
              items={[
                { key: '0', label: 'None', swatch: <LevelSwatch level={0} /> },
                { key: '1', label: 'Low', swatch: <LevelSwatch level={1} /> },
                { key: '2', label: 'Medium', swatch: <LevelSwatch level={2} /> },
                { key: '3', label: 'High', swatch: <LevelSwatch level={3} /> },
              ]}
            />
          </header>
          <p className="af-pfb-copy">
            Counts are your current starters, NFL leagues only.
            {insights.byeWeeks.length === 0 ? ' Bye weeks need a complete stored schedule, and none is stored for the weeks ahead.' : ''}
            {insights.injuryFeedStale ? ' The injury feed has not updated in over a day, so injury counts may be behind.' : ''}
            {' '}Thin spots are dedicated slots with no healthy backup; a stack is two or more starters from one club.
          </p>
          {risk.rows.length === 0 ? (
            <p className="af-pfb-note">None of these leagues is an NFL league with a roster we could read.</p>
          ) : (
            <ChartScroll minWidth={170 + risk.columns.length * 64} label="Risk heatmap, scrolls sideways">
              <Heatmap
                caption="Risk by league"
                columns={risk.columns}
                selected={cell}
                onSelect={(row, column) =>
                  setCell((cur) => (cur?.row === row && cur.column === column ? null : { row, column }))
                }
                rows={risk.rows.map((r) => ({
                  key: String(r.index),
                  label: (
                    <Link href={leagueHref(insights.leagues[r.index].id)} className="af-pfb-heat-league">
                      {insights.leagues[r.index].name}
                    </Link>
                  ),
                  cells: r.cells,
                }))}
              />
            </ChartScroll>
          )}
          {selectedRiskRow && selectedRiskCell ? (
            <div className="af-pfb-drill" aria-live="polite">
              <div className="af-pfb-drill-head">
                <strong>
                  {insights.leagues[selectedRiskRow.index].name} · {risk.columns[selectedRiskColumnIndex].label}
                </strong>
                <Link href={leagueHref(insights.leagues[selectedRiskRow.index].id)} className="af-pfb-clear">
                  Open league →
                </Link>
                <button type="button" className="af-pfb-clear" onClick={() => setCell(null)}>
                  Close
                </button>
              </div>
              {risk.columns[selectedRiskColumnIndex].factor === 'fragile' ? (
                <ul className="af-pfb-drill-list">
                  {(insights.risk.find((x) => x.leagueIndex === selectedRiskRow.index)?.fragile ?? []).map((f) => (
                    <li key={f.position}>
                      <strong>{f.position}</strong>
                      <span className="af-pfb-muted">
                        {f.starters} starting · {f.healthy} healthy on the roster
                      </span>
                      <span className="af-pfb-chips">
                        {f.players.map((k) => (
                          <span key={k} className="af-pfb-tag">
                            {playerByKey.get(k)?.name ?? 'Unmatched player'}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="af-pfb-drill-list">
                  {selectedRiskCell.players
                    .map((k) => playerByKey.get(k))
                    .filter((p): p is PortfolioPlayer => Boolean(p))
                    .map((p) => (
                      <li key={p.key}>
                        <PlayerLine p={p} />
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ) : null}
          {/* The supporting list: every league with any flag, in words. */}
          <ul className="af-pfb-risk-list">
            {risk.rows
              .filter((r) => r.score > 0)
              .slice(0, 12)
              .map((r) => {
                const l = insights.leagues[r.index]
                const parts = r.cells
                  .map((c, ci) => (c.count > 0 ? `${risk.columns[ci].label.toLowerCase()} ${c.count}` : null))
                  .filter(Boolean)
                return (
                  <li key={l.id}>
                    <LeagueChip league={l} />
                    <span className="af-pfb-muted">{parts.join(' · ')}</span>
                  </li>
                )
              })}
          </ul>
        </section>
      ) : null}

      {/* ────────────────────────── VALUE ────────────────────────── */}
      {view === 'value' && indexes.length > 0 ? (
        <>
          <section className="af-pfb-card" aria-labelledby="af-pfb-value">
            <header className="af-pfb-card-head">
              <div>
                <p className="af-pf-kicker">Value movement</p>
                <h2 id="af-pfb-value" className="af-pfb-h2">
                  {valueLeague != null && indexes.includes(valueLeague)
                    ? `${insights.leagues[valueLeague].name} — roster value`
                    : 'Roster value across these leagues'}
                </h2>
              </div>
              <Legend
                items={[
                  { key: 'rec', label: 'Recorded that day', swatch: <LineKey /> },
                  { key: 'est', label: 'Today’s roster at that day’s prices', swatch: <LineKey dashed /> },
                ]}
              />
            </header>
            <p className="af-pfb-copy">
              Each league is priced in its own book (dynasty or redraft, 1QB or superflex) from FantasyCalc’s daily
              capture. A recorded day is the roster you actually held; an estimated day shows how the market moved on
              the roster you hold now.
            </p>
            {valueLeague != null && indexes.includes(valueLeague) ? (
              <button type="button" className="af-pfb-clear" onClick={() => setValueLeague(null)}>
                ← Back to all {indexes.length} leagues
              </button>
            ) : null}
            <ChartScroll minWidth={520} label="Roster value chart, scrolls sideways">
              <LineChart
                points={valuePoints}
                ariaLabel="Roster value by day. Press Enter on a day to list each league’s move."
                valueLabel={(n) => formatValue(Math.round(n))}
                selected={valueDay}
                onSelect={(key) => setValueDay((cur) => (cur === key ? null : key))}
              />
            </ChartScroll>
            {valueDay ? (
              <div className="af-pfb-drill" aria-live="polite">
                <div className="af-pfb-drill-head">
                  <strong>{dayLabel(valueDay)} — each league against the day before</strong>
                  <button type="button" className="af-pfb-clear" onClick={() => setValueDay(null)}>
                    Close
                  </button>
                </div>
                {dayMoves.length === 0 ? (
                  <p className="af-pfb-note">No league here was priced that day.</p>
                ) : (
                  <ul className="af-pfb-drill-list">
                    {dayMoves.slice(0, 12).map((m) => (
                      <li key={m.index}>
                        <LeagueChip league={insights.leagues[m.index]} />
                        <span className="af-num">{formatValue(m.value)}</span>
                        <span className="af-num" data-dir={m.delta == null ? undefined : m.delta >= 0 ? 'up' : 'down'}>
                          {m.delta != null ? signed(m.delta) : 'first priced day'}
                        </span>
                        <span className="af-pfb-muted">{m.estimated ? 'estimated' : 'recorded'}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {dayMoves.length > 12 ? <p className="af-pfb-note">+{dayMoves.length - 12} smaller moves</p> : null}
              </div>
            ) : (
              <p className="af-pfb-note">Tap a day on the chart to list each league’s move that day.</p>
            )}
            <h3 className="af-pfb-h3">Leagues by change</h3>
            {changes.length === 0 ? (
              <p className="af-pfb-note">No NFL league here has a priced roster yet.</p>
            ) : (
              <ul className="af-pfb-changes">
                {changes.slice(0, 15).map((c) => {
                  const l = insights.leagues[c.index]
                  const s = insights.valueSeries.find((x) => x.leagueIndex === c.index)
                  return (
                    <li key={l.id}>
                      <button
                        type="button"
                        className="af-pfb-change"
                        aria-pressed={valueLeague === c.index}
                        onClick={() => setValueLeague((cur) => (cur === c.index ? null : c.index))}
                      >
                        <span className="af-pfb-change-name">{l.name}</span>
                        <Sparkline values={s?.values ?? []} label={`${l.name} roster value trend`} />
                        <span className="af-num">{c.last != null ? formatCompact(c.last) : '—'}</span>
                        <span className="af-num" data-dir={c.delta == null ? undefined : c.delta >= 0 ? 'up' : 'down'}>
                          {c.pct != null ? `${c.pct >= 0 ? '+' : '−'}${Math.abs(c.pct * 100).toFixed(1)}%` : '—'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="af-pfb-card" aria-labelledby="af-pfb-movers">
            <header className="af-pfb-card-head">
              <div>
                <p className="af-pf-kicker">Your players</p>
                <h2 id="af-pfb-movers" className="af-pfb-h2">
                  Biggest value moves
                </h2>
              </div>
              <span className="af-pfb-muted">{insights.playerValueBook}</span>
            </header>
            {insights.movers.length === 0 ? (
              <p className="af-pfb-note">No player you hold has moved across two priced days yet.</p>
            ) : (
              <ul className="af-pfb-changes">
                {insights.movers
                  .map((m) => ({ m, p: playerByKey.get(m.key) }))
                  .filter((x): x is { m: typeof x.m; p: PortfolioPlayer } =>
                    Boolean(x.p && x.p.held.some(([i]) => indexes.includes(i))),
                  )
                  .map(({ m, p }) => (
                    <li key={m.key}>
                      <button
                        type="button"
                        className="af-pfb-change"
                        onClick={() => {
                          setView('exposure')
                          setMultiOnly(false)
                          setExposureQuery(p.name)
                          setOpenPlayer(p.key)
                        }}
                      >
                        <span className="af-pfb-change-name">
                          {p.name}
                          <small className="af-pfb-muted"> {[p.position, p.team].filter(Boolean).join(' · ')}</small>
                        </span>
                        <Sparkline values={m.values} label={`${p.name} value trend`} />
                        <span className="af-num">{p.value != null ? formatCompact(p.value) : '—'}</span>
                        <span className="af-num" data-dir={(p.valueDelta ?? 0) >= 0 ? 'up' : 'down'}>
                          {p.valueDelta != null ? signed(p.valueDelta) : '—'}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {/* ────────────────────────── LEAGUES ────────────────────────── */}
      {view === 'leagues' && indexes.length > 0 ? renderLeagues(idSet, filtered) : null}

      {insights.injuryGaps.length > 0 ? (
        <p className="af-pfb-note">
          No injury feed for {insights.injuryGaps.map((g) => g.sport).join(', ')} — players there show no injury
          status because we cannot know it, not because they are healthy.
        </p>
      ) : null}
    </div>
  )
}

export type { PortfolioViewKey }

export default PortfolioBoard
