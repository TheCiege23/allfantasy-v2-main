/**
 * Everything the portfolio screen DERIVES from the stored insights, under the reader's filters.
 *
 * CLIENT-SAFE AND PURE: no imports beyond types, no clock. The screen is a client island, and
 * every chart on it answers "…for the leagues I have filtered to". Recounting in memory keeps a
 * filter tap instant, and it keeps one rule per number — the server stores facts once, and this
 * module is the only place any of them is aggregated.
 *
 * ⚠ THE DENOMINATOR IS "LEAGUES WITH A ROSTER WE COULD READ", NEVER "LEAGUES". A league whose
 * roster did not import cannot hold anybody, and counting it would understate every exposure
 * share. The screen states the difference where it matters.
 */

import type {
  CompetitiveStatus,
  FormatFamily,
  LeagueRisk,
  PortfolioInsights,
  PortfolioLeagueFacts,
  PortfolioPlayer,
  PortfolioStage,
  RecordedValueDay,
  SlotCode,
} from './portfolioInsightsTypes'

// ── view ────────────────────────────────────────────────────────────────────────────────────

export type PortfolioViewKey = 'overview' | 'exposure' | 'risk' | 'value' | 'leagues'

export const VIEW_PARAM = 'pf_view'

const VIEW_KEYS: readonly PortfolioViewKey[] = ['overview', 'exposure', 'risk', 'value', 'leagues']

/**
 * The tab to open on. Here rather than beside the tabs because the server page parses it, and a
 * function exported from a `'use client'` module cannot be called on the server.
 */
export function parseView(raw: unknown): PortfolioViewKey {
  return typeof raw === 'string' && (VIEW_KEYS as readonly string[]).includes(raw) ? (raw as PortfolioViewKey) : 'overview'
}

// ── filters ─────────────────────────────────────────────────────────────────────────────────

export type FormatModifier = 'best_ball' | 'idp' | 'superflex'
export type Importance = 'favorite' | 'commissioner' | 'paid'

export type PortfolioFilter = {
  status: CompetitiveStatus[]
  families: FormatFamily[]
  /** Every chosen modifier must hold — "best ball" and "IDP" together means both. */
  modifiers: FormatModifier[]
  importance: Importance[]
  platforms: string[]
  sports: string[]
  stages: PortfolioStage[]
}

export const EMPTY_FILTER: PortfolioFilter = {
  status: [],
  families: [],
  modifiers: [],
  importance: [],
  platforms: [],
  sports: [],
  stages: [],
}

/** Request-scoped facts that are never cached with the insights (favorites live in a cookie). */
export type PortfolioExtras = {
  favoriteIds: readonly string[]
  paidIds: readonly string[]
}

export function isEmptyFilter(f: PortfolioFilter): boolean {
  return Object.values(f).every((v) => (v as unknown[]).length === 0)
}

/**
 * The URL form. One param per group, values joined by `.` — short enough to share, and prefixed
 * `pf_` so no other /core screen's params can collide (`sport`, `platform` and `view` are all taken
 * elsewhere in the catch-all). `league` is deliberately never used: it is the page's auth boundary.
 */
export const FILTER_PARAMS: Record<keyof PortfolioFilter, string> = {
  status: 'pf_st',
  families: 'pf_fmt',
  modifiers: 'pf_mod',
  importance: 'pf_imp',
  platforms: 'pf_plat',
  sports: 'pf_sport',
  stages: 'pf_stage',
}

const ALLOWED: { [K in keyof PortfolioFilter]?: readonly string[] } = {
  status: ['contender', 'middle', 'rebuild', 'unknown'],
  families: ['dynasty', 'keeper', 'redraft', 'other'],
  modifiers: ['best_ball', 'idp', 'superflex'],
  importance: ['favorite', 'commissioner', 'paid'],
  stages: ['drafting', 'pre_draft', 'in_season', 'complete', 'unknown'],
}

/** Parse from a record of search params. Unknown values are dropped, never guessed. */
export function parseFilter(read: (param: string) => string | null | undefined): PortfolioFilter {
  const out: PortfolioFilter = { ...EMPTY_FILTER }
  for (const key of Object.keys(FILTER_PARAMS) as Array<keyof PortfolioFilter>) {
    const raw = read(FILTER_PARAMS[key])
    if (!raw) continue
    const allowed = ALLOWED[key]
    const values = [...new Set(String(raw).split('.').map((v) => v.trim()).filter(Boolean))]
      .filter((v) => v.length <= 32 && (!allowed || allowed.includes(v)))
      .slice(0, 12)
    ;(out as Record<string, string[]>)[key] = key === 'sports' ? values.map((v) => v.toUpperCase()) : values.map((v) => v.toLowerCase())
  }
  return out
}

export function serializeFilter(f: PortfolioFilter): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const key of Object.keys(FILTER_PARAMS) as Array<keyof PortfolioFilter>) {
    const values = f[key] as string[]
    if (values.length > 0) out.push([FILTER_PARAMS[key], values.join('.')])
  }
  return out
}

export function toggleValue<K extends keyof PortfolioFilter>(
  f: PortfolioFilter,
  key: K,
  value: PortfolioFilter[K][number],
): PortfolioFilter {
  const current = f[key] as string[]
  const next = current.includes(value as string)
    ? current.filter((v) => v !== value)
    : [...current, value as string]
  return { ...f, [key]: next }
}

function importanceOf(league: PortfolioLeagueFacts, favorites: Set<string>, paid: Set<string>): Importance[] {
  const out: Importance[] = []
  if (favorites.has(league.id)) out.push('favorite')
  if (league.commissioner) out.push('commissioner')
  if (paid.has(league.id)) out.push('paid')
  return out
}

export function leagueMatches(
  league: PortfolioLeagueFacts,
  f: PortfolioFilter,
  favorites: Set<string>,
  paid: Set<string>,
): boolean {
  if (f.status.length && !f.status.includes(league.status)) return false
  if (f.families.length && !f.families.includes(league.family)) return false
  for (const m of f.modifiers) {
    if (m === 'best_ball' && !league.bestBall) return false
    if (m === 'idp' && !league.idp) return false
    if (m === 'superflex' && !league.superflex) return false
  }
  if (f.importance.length) {
    const held = importanceOf(league, favorites, paid)
    if (!f.importance.some((i) => held.includes(i))) return false
  }
  if (f.platforms.length && !f.platforms.includes(league.platform)) return false
  if (f.sports.length && !f.sports.includes(league.sport.toUpperCase())) return false
  if (f.stages.length && !f.stages.includes(league.stage)) return false
  return true
}

/** League indexes that pass the filter, in the insights' own order. */
export function filterLeagues(
  insights: Pick<PortfolioInsights, 'leagues'>,
  f: PortfolioFilter,
  extras: PortfolioExtras,
): number[] {
  const favorites = new Set(extras.favoriteIds)
  const paid = new Set(extras.paidIds)
  const out: number[] = []
  insights.leagues.forEach((league, i) => {
    if (leagueMatches(league, f, favorites, paid)) out.push(i)
  })
  return out
}

// ── exposure ────────────────────────────────────────────────────────────────────────────────

export type ExposureView = {
  player: PortfolioPlayer
  /** Rosters of yours (in the filter) holding him. */
  count: number
  /** Of those, how many start him. */
  starts: number
  /** Rosters in the filter we could read — the share's denominator. */
  of: number
  share: number
  leagues: Array<{ index: number; slot: SlotCode }>
}

export function readableRosterCount(insights: Pick<PortfolioInsights, 'leagues'>, indexes: readonly number[]): number {
  return indexes.filter((i) => insights.leagues[i]?.hasRoster).length
}

export function exposureRows(
  insights: Pick<PortfolioInsights, 'leagues' | 'players'>,
  indexes: readonly number[],
): ExposureView[] {
  const inSet = new Set(indexes)
  const of = readableRosterCount(insights, indexes)
  const rows: ExposureView[] = []
  for (const player of insights.players) {
    const leagues = player.held.filter(([i]) => inSet.has(i)).map(([index, slot]) => ({ index, slot }))
    if (leagues.length === 0) continue
    const starts = leagues.filter((l) => l.slot === 'S').length
    rows.push({ player, count: leagues.length, starts, of, share: of > 0 ? leagues.length / of : 0, leagues })
  }
  /*
   * Most-held first; then most-started, because a player you start in four leagues is more of
   * your week than one you bench in four; then value, then name so ties never reshuffle.
   */
  rows.sort(
    (a, b) =>
      b.count - a.count ||
      b.starts - a.starts ||
      (b.player.value ?? -1) - (a.player.value ?? -1) ||
      a.player.name.localeCompare(b.player.name),
  )
  return rows
}

// ── risk ────────────────────────────────────────────────────────────────────────────────────

export type RiskLevel = 0 | 1 | 2 | 3

export type RiskCell = {
  level: RiskLevel
  /** The number printed in the cell — never colour alone. */
  count: number
  players: string[]
  /** Why the cell cannot be judged, when it cannot. */
  unknown?: string
}

export type RiskColumn = { id: string; label: string; factor: 'injury' | 'bye' | 'fragile' | 'stack'; week?: number }

export type RiskRow = { index: number; cells: RiskCell[]; score: number }

export function injuryLevel(out: number, atRisk: number): RiskLevel {
  const score = out * 2 + atRisk
  return score === 0 ? 0 : score <= 1 ? 1 : score <= 3 ? 2 : 3
}

export function byeLevel(count: number): RiskLevel {
  return count <= 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3
}

export function fragileLevel(positions: number): RiskLevel {
  return positions <= 0 ? 0 : positions === 1 ? 1 : positions === 2 ? 2 : 3
}

/** Two starters from one club is ordinary; three is a stack; four is a bet. */
export function stackLevel(count: number): RiskLevel {
  return count <= 1 ? 0 : count === 2 ? 1 : count === 3 ? 2 : 3
}

export function riskColumns(insights: Pick<PortfolioInsights, 'byeWeeks'>): RiskColumn[] {
  return [
    { id: 'injury', label: 'Injuries', factor: 'injury' },
    ...insights.byeWeeks.map((week) => ({ id: `bye-${week}`, label: `Wk ${week} bye`, factor: 'bye' as const, week })),
    { id: 'fragile', label: 'Thin spots', factor: 'fragile' },
    { id: 'stack', label: 'Team stack', factor: 'stack' },
  ]
}

function cellFor(risk: LeagueRisk, column: RiskColumn, league: PortfolioLeagueFacts): RiskCell {
  if (!league.hasRoster) return { level: 0, count: 0, players: [], unknown: 'no roster players imported' }
  if (column.factor === 'injury') {
    const players = [...risk.out, ...risk.atRisk]
    return { level: injuryLevel(risk.out.length, risk.atRisk.length), count: players.length, players }
  }
  if (column.factor === 'bye') {
    const players = risk.byes[String(column.week)] ?? []
    return { level: byeLevel(players.length), count: players.length, players }
  }
  if (column.factor === 'fragile') {
    if (!rosterSettled(league.stage)) return { level: 0, count: 0, players: [], unknown: 'draft not finished' }
    if (risk.fragile == null) return { level: 0, count: 0, players: [], unknown: 'lineup slots not stored' }
    const players = risk.fragile.flatMap((f) => f.players)
    return { level: fragileLevel(risk.fragile.length), count: risk.fragile.length, players }
  }
  const players = risk.stack?.players ?? []
  return { level: stackLevel(players.length), count: players.length, players }
}

/**
 * NFL leagues only — the injury feed, the bye schedule and club identity are all NFL facts here,
 * and a basketball row full of zeros would read as "safe" rather than "not measured".
 */
export function riskRows(
  insights: Pick<PortfolioInsights, 'leagues' | 'risk' | 'byeWeeks'>,
  indexes: readonly number[],
): { columns: RiskColumn[]; rows: RiskRow[] } {
  const columns = riskColumns(insights)
  const byIndex = new Map(insights.risk.map((r) => [r.leagueIndex, r]))
  const rows: RiskRow[] = []
  for (const index of indexes) {
    const league = insights.leagues[index]
    const risk = byIndex.get(index)
    if (!league || !risk || league.sport.toUpperCase() !== 'NFL') continue
    const cells = columns.map((c) => cellFor(risk, c, league))
    rows.push({ index, cells, score: cells.reduce((s, c) => s + c.level, 0) })
  }
  rows.sort(
    (a, b) =>
      b.score - a.score ||
      insights.leagues[a.index].name.localeCompare(insights.leagues[b.index].name),
  )
  return { columns, rows }
}

// ── distribution ────────────────────────────────────────────────────────────────────────────

export type DistributionDimension = 'platform' | 'family' | 'scoring' | 'sport' | 'status' | 'stage'

export type DistributionBucket = { key: string; count: number; indexes: number[] }

export function distribution(
  insights: Pick<PortfolioInsights, 'leagues'>,
  indexes: readonly number[],
  dimension: DistributionDimension,
): DistributionBucket[] {
  const by = new Map<string, number[]>()
  for (const i of indexes) {
    const l = insights.leagues[i]
    if (!l) continue
    const key =
      dimension === 'platform'
        ? l.platform
        : dimension === 'family'
          ? l.family
          : dimension === 'scoring'
            ? (l.scoring ?? 'unknown')
            : dimension === 'sport'
              ? l.sport.toUpperCase()
              : dimension === 'status'
                ? l.status
                : l.stage
    const bucket = by.get(key)
    if (bucket) bucket.push(i)
    else by.set(key, [i])
  }
  return [...by.entries()]
    .map(([key, idx]) => ({ key, count: idx.length, indexes: idx }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

// ── diversification ─────────────────────────────────────────────────────────────────────────

export type ExposureEvent = {
  kind: 'player' | 'team' | 'bye'
  key: string
  label: string
  /** Lineups (leagues with a readable roster) the event reaches. */
  lineups: number
  /** Starters the event takes out, summed across those lineups. */
  starters: number
  indexes: number[]
  players: string[]
}

export type DiversificationView = {
  /** Leagues in the filter with a starting lineup we could read. */
  lineups: number
  /** Starting slots filled across them. */
  starterSlots: number
  events: ExposureEvent[]
  /** Share of all your starting slots held by the single most-used NFL club. */
  topTeamShare: number | null
  topTeam: string | null
}

/**
 * "Where could ONE real-world event hurt several of my teams?"
 *
 * Three kinds of event, each a thing that actually happens on a Sunday: one player getting hurt,
 * one club having a bad day (every starter from it is exposed together), and one bye week landing
 * on several lineups at once. Ranked by how many lineups they reach, then by starters lost.
 *
 * ⚠ STARTERS ONLY FOR TEAM AND BYE EVENTS. A benched player on a club that gets shut out costs
 * nothing that week; counting him would inflate exactly the number this view exists to state.
 */
export function diversification(
  insights: Pick<PortfolioInsights, 'leagues' | 'players' | 'byeWeeks'>,
  indexes: readonly number[],
  limit = 8,
): DiversificationView {
  const inSet = new Set(indexes.filter((i) => insights.leagues[i]?.hasRoster && insights.leagues[i]?.sport.toUpperCase() === 'NFL'))
  const playerEvents: ExposureEvent[] = []
  const teamAgg = new Map<string, { indexes: Set<number>; starters: number; players: Set<string> }>()
  const byeAgg = new Map<number, { indexes: Map<number, number>; players: Set<string> }>()
  const lineupLeagues = new Set<number>()
  let starterSlots = 0

  for (const p of insights.players) {
    if (p.sport.toUpperCase() !== 'NFL') continue
    const held = p.held.filter(([i]) => inSet.has(i))
    if (held.length === 0) continue
    const starting = held.filter(([, s]) => s === 'S').map(([i]) => i)
    for (const i of starting) lineupLeagues.add(i)
    starterSlots += starting.length
    if (held.length >= 2) {
      playerEvents.push({
        kind: 'player',
        key: p.key,
        label: p.name,
        lineups: held.length,
        starters: starting.length,
        indexes: held.map(([i]) => i),
        players: [p.key],
      })
    }
    if (starting.length > 0 && p.team) {
      const agg = teamAgg.get(p.team) ?? { indexes: new Set<number>(), starters: 0, players: new Set<string>() }
      for (const i of starting) agg.indexes.add(i)
      agg.starters += starting.length
      agg.players.add(p.key)
      teamAgg.set(p.team, agg)
    }
    if (starting.length > 0 && p.byeWeek != null && insights.byeWeeks.includes(p.byeWeek)) {
      const agg = byeAgg.get(p.byeWeek) ?? { indexes: new Map<number, number>(), players: new Set<string>() }
      for (const i of starting) agg.indexes.set(i, (agg.indexes.get(i) ?? 0) + 1)
      agg.players.add(p.key)
      byeAgg.set(p.byeWeek, agg)
    }
  }

  const teamEvents: ExposureEvent[] = [...teamAgg.entries()]
    .filter(([, a]) => a.indexes.size >= 2)
    .map(([team, a]) => ({
      kind: 'team' as const,
      key: `team:${team}`,
      label: team,
      lineups: a.indexes.size,
      starters: a.starters,
      indexes: [...a.indexes],
      players: [...a.players],
    }))

  /* A bye only matters where it takes two or more starters at once — one is a normal Tuesday fix. */
  const byeEvents: ExposureEvent[] = [...byeAgg.entries()]
    .map(([week, a]) => {
      const heavy = [...a.indexes.entries()].filter(([, n]) => n >= 2)
      return {
        kind: 'bye' as const,
        key: `bye:${week}`,
        label: `Week ${week} byes`,
        lineups: heavy.length,
        starters: heavy.reduce((s, [, n]) => s + n, 0),
        indexes: heavy.map(([i]) => i),
        players: [...a.players],
      }
    })
    .filter((e) => e.lineups >= 2)

  const events = [...playerEvents, ...teamEvents, ...byeEvents]
    .sort((a, b) => b.lineups - a.lineups || b.starters - a.starters || a.label.localeCompare(b.label))
    .slice(0, limit)

  let topTeam: string | null = null
  let topStarters = 0
  for (const [team, a] of teamAgg) {
    if (a.starters > topStarters || (a.starters === topStarters && topTeam != null && team < topTeam)) {
      topTeam = team
      topStarters = a.starters
    }
  }

  return {
    lineups: lineupLeagues.size,
    starterSlots,
    events,
    topTeam,
    topTeamShare: starterSlots > 0 && topTeam ? topStarters / starterSlots : null,
  }
}

// ── value movement ──────────────────────────────────────────────────────────────────────────

export type ValuePoint = {
  date: string
  total: number | null
  /** True when this day is today's roster priced at that day's values, not a stored day. */
  estimated: boolean
  /** Leagues contributing to `total`. */
  leagues: number
}

/**
 * The portfolio's roster value, day by day, for the filtered leagues.
 *
 * ⚠ A STORED DAY BEATS A RECONSTRUCTION, AND THE CHART SAYS WHICH IS WHICH. A reconstruction
 * prices TODAY's roster at each past day's values — it answers "how has the market moved on what I
 * hold now", not "what did I hold then". A day the daily writer recorded holds the roster AS IT
 * WAS. Mixing them silently would draw a trade you made as a market move.
 *
 * ⚠ A LEAGUE MISSING FROM A STORED DAY FALLS BACK TO ITS RECONSTRUCTION FOR THAT DAY, and the day
 * is then marked estimated. Dropping it would draw a newly imported league as a sudden gain.
 */
export function valueTotals(
  insights: Pick<PortfolioInsights, 'leagues' | 'valueDates' | 'valueSeries'>,
  indexes: readonly number[],
  recorded: readonly RecordedValueDay[] = [],
): ValuePoint[] {
  const inSet = new Set(indexes)
  const series = insights.valueSeries.filter((s) => inSet.has(s.leagueIndex))
  const recordedBy = new Map(recorded.map((d) => [d.date, d.values]))
  const dates = [...new Set([...insights.valueDates, ...recorded.map((d) => d.date)])].sort()
  const dateIndex = new Map(insights.valueDates.map((d, i) => [d, i]))

  return dates.map((date) => {
    const stored = recordedBy.get(date)
    const at = dateIndex.get(date)
    let total = 0
    let leagues = 0
    let estimated = false
    for (const s of series) {
      const id = insights.leagues[s.leagueIndex]?.id
      const fromStore = stored && id != null ? stored[id] : undefined
      if (typeof fromStore === 'number') {
        total += fromStore
        leagues += 1
        continue
      }
      const rebuilt = at != null ? s.values[at] : null
      if (rebuilt != null) {
        total += rebuilt
        leagues += 1
        estimated = true
      }
    }
    return { date, total: leagues > 0 ? total : null, estimated, leagues }
  })
}

export type LeagueDayMove = {
  index: number
  value: number
  previous: number | null
  delta: number | null
  estimated: boolean
}

/**
 * One day on the value chart, opened: each filtered league's value that day and its move from the
 * chart's previous day, biggest move first. The same stored-beats-reconstructed rule as
 * `valueTotals`, per league, so the list always sums to the point that was clicked.
 */
export function leagueMovesOn(
  insights: Pick<PortfolioInsights, 'leagues' | 'valueDates' | 'valueSeries'>,
  indexes: readonly number[],
  recorded: readonly RecordedValueDay[],
  date: string,
): LeagueDayMove[] {
  const inSet = new Set(indexes)
  const dates = [...new Set([...insights.valueDates, ...recorded.map((d) => d.date)])].sort()
  const at = dates.indexOf(date)
  if (at < 0) return []
  const recordedBy = new Map(recorded.map((d) => [d.date, d.values]))
  const dateIndex = new Map(insights.valueDates.map((d, i) => [d, i]))
  const valueOn = (series: PortfolioInsights['valueSeries'][number], day: string | undefined) => {
    if (!day) return null
    const id = insights.leagues[series.leagueIndex]?.id
    const stored = id != null ? recordedBy.get(day)?.[id] : undefined
    if (typeof stored === 'number') return { value: stored, estimated: false }
    const i = dateIndex.get(day)
    const rebuilt = i != null ? series.values[i] : null
    return rebuilt != null ? { value: rebuilt, estimated: true } : null
  }
  const out: LeagueDayMove[] = []
  for (const s of insights.valueSeries) {
    if (!inSet.has(s.leagueIndex)) continue
    const now = valueOn(s, date)
    if (!now) continue
    const before = valueOn(s, dates[at - 1])
    out.push({
      index: s.leagueIndex,
      value: now.value,
      previous: before?.value ?? null,
      delta: before ? now.value - before.value : null,
      estimated: now.estimated,
    })
  }
  return out.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) || b.value - a.value)
}

export type LeagueValueChange = {
  index: number
  first: number | null
  last: number | null
  delta: number | null
  pct: number | null
}

/** First and last priced day of each filtered league's reconstruction — the "which league moved" list. */
export function leagueValueChanges(
  insights: Pick<PortfolioInsights, 'valueSeries'>,
  indexes: readonly number[],
): LeagueValueChange[] {
  const inSet = new Set(indexes)
  return insights.valueSeries
    .filter((s) => inSet.has(s.leagueIndex))
    .map((s) => {
      const priced = s.values.filter((v): v is number => v != null)
      const first = priced[0] ?? null
      const last = priced[priced.length - 1] ?? null
      const delta = first != null && last != null && priced.length >= 2 ? last - first : null
      return {
        index: s.leagueIndex,
        first,
        last,
        delta,
        pct: delta != null && first ? delta / first : null,
      }
    })
    .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
}

// ── actions ─────────────────────────────────────────────────────────────────────────────────

export type ActionKind = 'lineup' | 'waiver' | 'trade' | 'draft'

/** Now-facts the home loader already holds; passed per request, never cached with the insights. */
export type LineupSignal = { empty: number; hurt: number; drafting: boolean }

export type ActionReason = { kind: ActionKind; text: string; weight: number }

export type ActionItem = {
  index: number
  score: number
  primary: ActionKind
  reasons: ActionReason[]
  href: string
}

const ACTION_SCREEN: Record<ActionKind, string> = {
  lineup: 'my-team',
  waiver: 'waivers',
  trade: 'trades',
  draft: 'draft-hq',
}

export function actionHref(kind: ActionKind, leagueId: string): string {
  return `/core/${ACTION_SCREEN[kind]}?league=${encodeURIComponent(leagueId)}`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A cross-league-book value at which a player is a real asset, not a stash. */
export const KEY_PLAYER_VALUE = 1500
/** The fall, as a share of the window's first price, that counts as a market move. */
export const KEY_FALL = 0.15

/** Thin-spot checks only mean something once the draft is done — a half-drafted roster is thin everywhere. */
export function rosterSettled(stage: PortfolioStage): boolean {
  return stage === 'in_season' || stage === 'unknown'
}

/** Items the tab badge counts: the ones with a deadline attached. */
export function isUrgent(item: ActionItem): boolean {
  return item.primary === 'lineup' || item.primary === 'draft'
}

/**
 * Which leagues need you, and for what.
 *
 * ⚠ THE LINEUP COUNTS ARE THE HOME'S, NOT RECOMPUTED. Empty and unavailable starters come from
 * `dash34` exactly as the home and the tab badges show them — two screens disagreeing about how
 * many starters are out is worse than either being a few minutes old.
 *
 * ⚠ IMPORTANCE MULTIPLIES, IT NEVER CREATES WORK. A favourite with nothing to do stays off the
 * list; a favourite with one problem outranks a stranger with the same problem.
 */
export function rankActions(
  insights: Pick<PortfolioInsights, 'leagues' | 'risk' | 'players' | 'nflWeek'>,
  indexes: readonly number[],
  lineup: Readonly<Record<string, LineupSignal>>,
  extras: PortfolioExtras,
): ActionItem[] {
  const favorites = new Set(extras.favoriteIds)
  const paid = new Set(extras.paidIds)
  const riskBy = new Map(insights.risk.map((r) => [r.leagueIndex, r]))
  const inSet = new Set(indexes)

  /*
   * ⚠ ONLY PLAYERS WHO MATTER, AND ONLY A REAL FALL. Measured on a 65-league test account: counting
   * every 10% drop flagged 60 of 65 leagues, almost all for depth pieces worth a few hundred points,
   * which buried the three leagues with a live draft. A priced starter-calibre player (see
   * `KEY_PLAYER_VALUE`) losing 15% is worth a trade look; a 300-point stash drifting is not.
   */
  const fallers = new Map<number, number>()
  for (const p of insights.players) {
    if (p.value == null || p.valueDelta == null || p.value < KEY_PLAYER_VALUE) continue
    if (p.valueDelta / Math.max(1, p.value - p.valueDelta) > -KEY_FALL) continue
    for (const [i] of p.held) if (inSet.has(i)) fallers.set(i, (fallers.get(i) ?? 0) + 1)
  }

  const currentWeek = insights.nflWeek && !insights.nflWeek.preseason ? String(insights.nflWeek.week) : null
  const out: ActionItem[] = []

  for (const index of indexes) {
    const league = insights.leagues[index]
    if (!league || league.stage === 'complete') continue
    const reasons: ActionReason[] = []
    const now = lineup[league.id]
    const risk = riskBy.get(index)

    if (now?.drafting || league.stage === 'drafting') {
      reasons.push({ kind: 'draft', text: 'Your draft is live', weight: 8 })
    } else if (league.stage === 'pre_draft') {
      reasons.push({ kind: 'draft', text: 'Draft not yet held — prep your board', weight: 2 })
    }
    if (now && now.empty > 0) {
      reasons.push({ kind: 'lineup', text: `${plural(now.empty, 'empty starting slot')}`, weight: 4 * now.empty })
    }
    /*
     * The home's count when it has one; otherwise our own read of the same injury feed, so a
     * league the home could not rank still says a starter is out rather than saying nothing.
     */
    const hurt = now ? now.hurt : (risk?.out.length ?? 0)
    if (hurt > 0) {
      reasons.push({ kind: 'lineup', text: `${plural(hurt, 'starter')} ruled out`, weight: 3 * hurt })
    }
    const byeNow = currentWeek && risk ? (risk.byes[currentWeek] ?? []).length : 0
    if (byeNow > 0) {
      reasons.push({ kind: 'lineup', text: `${plural(byeNow, 'starter')} on bye this week`, weight: 3 * byeNow })
    }
    if (risk && risk.atRisk.length > 0) {
      reasons.push({ kind: 'lineup', text: `${plural(risk.atRisk.length, 'starter')} questionable`, weight: risk.atRisk.length })
    }
    const thin = rosterSettled(league.stage) && risk?.fragile ? risk.fragile : []
    if (thin.length > 0) {
      const names = thin.map((f) => f.position).join(', ')
      reasons.push({ kind: 'waiver', text: `No healthy backup at ${names}`, weight: 2 * thin.length })
    }
    const falling = fallers.get(index) ?? 0
    if (falling > 0) {
      reasons.push({
        kind: 'trade',
        text: `${plural(falling, 'key player')} down ${Math.round(KEY_FALL * 100)}%+ in value`,
        // Capped: a value slide is a "look when you can", never louder than a lineup hole.
        weight: Math.min(3, falling),
      })
    }
    if (league.status === 'contender' && thin.length > 0) {
      reasons.push({ kind: 'trade', text: 'Contending with a thin roster — shop for depth', weight: 1 })
    }
    if (reasons.length === 0) continue

    let multiplier = 1
    if (favorites.has(league.id)) multiplier *= 1.5
    if (paid.has(league.id)) multiplier *= 1.3
    if (league.commissioner) multiplier *= 1.1

    const byKind = new Map<ActionKind, number>()
    for (const r of reasons) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + r.weight)
    const primary = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const raw = reasons.reduce((s, r) => s + r.weight, 0)
    reasons.sort((a, b) => b.weight - a.weight)
    out.push({
      index,
      score: Math.round(raw * multiplier * 10) / 10,
      primary,
      reasons,
      href: actionHref(primary, league.id),
    })
  }

  return out.sort((a, b) => b.score - a.score || insights.leagues[a.index].name.localeCompare(insights.leagues[b.index].name))
}
