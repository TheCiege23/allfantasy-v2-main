/**
 * Rankings engine — the pure half of `/core/rankings`.
 *
 * Everything here is arithmetic over career-ledger rows (`lib/rank/careerLedger`).
 * No prisma and no `server-only`, so the whole method is unit-tested directly and
 * the FAQ, the board, the compare view and the share card all quote one set of
 * constants.
 *
 * ── WHAT "NORMALISED" MEANS HERE, AND WHAT IT CANNOT MEAN ─────────────────────
 *
 * A manager's score blends four components, each built so that a result is
 * judged against what that league made likely:
 *
 *   win rate   per GAME, so a 13-week and a 17-week season weigh by games played,
 *              shrunk toward .500 so ten games cannot outrank three hundred
 *   scoring    points per game against the average of every AllFantasy team in
 *              the same sport, season, scoring format, superflex/TE-premium
 *              setting and best-ball flag — so PPR inflation and schedule length
 *              both cancel out
 *   titles     championships against the 1-in-N chance each league offered, so a
 *              14-team title is worth more than an 8-team one
 *   playoffs   berths against each league's own playoff cut (4 of 12, 6 of 10…)
 *
 * Platform and league type do not reweight anything — a 12-team PPR league is
 * the same test on Sleeper and on ESPN — they are filters instead.
 *
 * ⚠ OPPONENT QUALITY IS NOT MEASURED, AND THE SCREEN SAYS SO. The ledger holds
 * only the importing manager's own roster for each league (1,139 of 1,165 legacy
 * leagues, measured 2026-09-16). Competition strength is therefore expressed as
 * field size and playoff selectivity — the two things one roster can honestly
 * report — never as a guess about who the other eleven teams were.
 */

import type { CareerLedgerRow } from '@/lib/rank/careerLedger'
import { computePrestige, winRateOf } from '@/lib/core-app/prestige'

/* ──────────────────────────────── constants ─────────────────────────────── */

export const SCORE_WEIGHTS = {
  winRate: 0.3,
  scoring: 0.2,
  titles: 0.25,
  playoffs: 0.25,
} as const

/** Pseudo-games at .500 blended into every win rate. */
export const WIN_RATE_PRIOR_GAMES = 14
/** Adjusted win rate that maps to 0 and to full credit. */
export const WIN_RATE_FLOOR = 0.35
export const WIN_RATE_CEILING = 0.65

/** A scoring cohort needs this many team-seasons before its average is used. */
export const SCORING_COHORT_MIN = 5
/** Pseudo-games at an index of 100 blended into every scoring index. */
export const SCORING_PRIOR_GAMES = 14
export const SCORING_INDEX_FLOOR = 85
export const SCORING_INDEX_CEILING = 115

/** Pseudo-expected titles added to both sides of the title ratio. */
export const TITLE_PRIOR = 1
/** A title ratio of this multiple (or its inverse) is full (or zero) credit. */
export const TITLE_RATIO_SPAN = 3
export const PLAYOFF_PRIOR = 2
export const PLAYOFF_RATIO_SPAN = 2

/** Minimum league-seasons with results to appear on a community board, by default. */
export const DEFAULT_MIN_SAMPLE = 3
export const MIN_SAMPLE_OPTIONS = [1, 3, 5, 10, 25] as const

/* ───────────────────────────────── filters ──────────────────────────────── */

export const LEAGUE_TYPE_FILTERS = ['redraft', 'keeper', 'dynasty', 'bestball', 'guillotine'] as const
export const FORMAT_FILTERS = ['ppr', 'half', 'standard', 'superflex', 'te_premium'] as const

export type LeagueTypeFilter = (typeof LEAGUE_TYPE_FILTERS)[number]
export type FormatFilter = (typeof FORMAT_FILTERS)[number]

export type RankingFilters = {
  platform: string | null
  sport: string | null
  type: LeagueTypeFilter | null
  format: FormatFilter | null
  season: number | null
  minSample: number
}

export const DEFAULT_FILTERS: RankingFilters = {
  platform: null,
  sport: null,
  type: null,
  format: null,
  season: null,
  minSample: DEFAULT_MIN_SAMPLE,
}

type Params = Record<string, string | string[] | undefined>

function one(sp: Params, key: string): string | null {
  const v = sp[key]
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' && s.trim() ? s.trim() : null
}

const SLUG = /^[a-z0-9_]{1,24}$/

/**
 * Filters from a query string. Anything not on a whitelist is dropped rather
 * than echoed, because these values are rendered back into links and headings.
 */
export function parseRankingFilters(sp: Params): RankingFilters {
  const platform = one(sp, 'platform')?.toLowerCase() ?? null
  const sport = one(sp, 'sport')?.toUpperCase() ?? null
  const type = one(sp, 'type')?.toLowerCase() ?? null
  const format = one(sp, 'format')?.toLowerCase() ?? null
  const season = Number(one(sp, 'season'))
  const min = Number(one(sp, 'min'))
  return {
    platform: platform && SLUG.test(platform) ? platform : null,
    sport: sport && SLUG.test(sport.toLowerCase()) ? sport : null,
    type: (LEAGUE_TYPE_FILTERS as readonly string[]).includes(type ?? '') ? (type as LeagueTypeFilter) : null,
    format: (FORMAT_FILTERS as readonly string[]).includes(format ?? '') ? (format as FormatFilter) : null,
    season: Number.isInteger(season) && season >= 1990 && season <= 2100 ? season : null,
    minSample: (MIN_SAMPLE_OPTIONS as readonly number[]).includes(min) ? min : DEFAULT_MIN_SAMPLE,
  }
}

/** Query-string pairs for the non-default filters, in a fixed order. */
export function filterParams(f: RankingFilters): Array<[string, string]> {
  const out: Array<[string, string]> = []
  if (f.platform) out.push(['platform', f.platform])
  if (f.sport) out.push(['sport', f.sport])
  if (f.type) out.push(['type', f.type])
  if (f.format) out.push(['format', f.format])
  if (f.season != null) out.push(['season', String(f.season)])
  if (f.minSample !== DEFAULT_MIN_SAMPLE) out.push(['min', String(f.minSample)])
  return out
}

export function isDefaultFilters(f: RankingFilters): boolean {
  return filterParams(f).length === 0
}

export function matchesFilters(r: CareerLedgerRow, f: RankingFilters): boolean {
  if (f.platform && r.platform !== f.platform) return false
  if (f.sport && r.sport !== f.sport) return false
  if (f.season != null && r.season !== f.season) return false
  if (f.type) {
    if (f.type === 'bestball' || f.type === 'guillotine') {
      if (r.specialty !== f.type) return false
    } else if (r.leagueType !== f.type) return false
  }
  if (f.format) {
    if (f.format === 'superflex') {
      if (r.superflex !== true) return false
    } else if (f.format === 'te_premium') {
      if (r.tePremium !== true) return false
    } else if (r.scoring !== f.format) return false
  }
  return true
}

export const TYPE_LABEL: Record<LeagueTypeFilter, string> = {
  redraft: 'Redraft',
  keeper: 'Keeper',
  dynasty: 'Dynasty',
  bestball: 'Best ball',
  guillotine: 'Guillotine',
}

export const FORMAT_LABEL: Record<FormatFilter, string> = {
  ppr: 'PPR',
  half: 'Half PPR',
  standard: 'Standard',
  superflex: 'Superflex',
  te_premium: 'TE premium',
}

export function platformLabel(key: string): string {
  const known: Record<string, string> = {
    sleeper: 'Sleeper',
    espn: 'ESPN',
    yahoo: 'Yahoo',
    mfl: 'MFL',
    fantrax: 'Fantrax',
    fleaflicker: 'Fleaflicker',
    allfantasy: 'AllFantasy',
    af: 'AllFantasy',
  }
  return known[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

/** A one-line human description of the active filters, for headings and the share card. */
export function describeFilters(f: RankingFilters): string {
  const parts: string[] = []
  if (f.sport) parts.push(f.sport)
  if (f.platform) parts.push(platformLabel(f.platform))
  if (f.type) parts.push(TYPE_LABEL[f.type])
  if (f.format) parts.push(FORMAT_LABEL[f.format])
  if (f.season != null) parts.push(String(f.season))
  return parts.length ? parts.join(' · ') : 'All leagues'
}

export type FilterOption<T extends string | number> = { value: T; label: string; count: number }

export type FilterOptions = {
  platforms: FilterOption<string>[]
  sports: FilterOption<string>[]
  types: FilterOption<LeagueTypeFilter>[]
  formats: FilterOption<FormatFilter>[]
  seasons: FilterOption<number>[]
}

/**
 * The options each filter can take, counted over the rows given — so a select
 * never offers a value that would empty the board.
 */
export function filterOptions(rows: CareerLedgerRow[]): FilterOptions {
  const count = <K extends string | number>(pick: (r: CareerLedgerRow) => K[] ) => {
    const m = new Map<K, number>()
    for (const r of rows) for (const k of pick(r)) m.set(k, (m.get(k) ?? 0) + 1)
    return m
  }
  const platforms = count((r) => [r.platform])
  const sports = count((r) => [r.sport])
  const types = count<LeagueTypeFilter>((r) => {
    const out: LeagueTypeFilter[] = []
    if (r.leagueType !== 'unknown') out.push(r.leagueType)
    if (r.specialty === 'bestball' || r.specialty === 'guillotine') out.push(r.specialty)
    return out
  })
  const formats = count<FormatFilter>((r) => {
    const out: FormatFilter[] = []
    if (r.scoring === 'ppr' || r.scoring === 'half' || r.scoring === 'standard') out.push(r.scoring)
    if (r.superflex === true) out.push('superflex')
    if (r.tePremium === true) out.push('te_premium')
    return out
  })
  const seasons = count((r) => [r.season])
  return {
    platforms: [...platforms].map(([value, n]) => ({ value, label: platformLabel(value), count: n })).sort((a, b) => b.count - a.count),
    sports: [...sports].map(([value, n]) => ({ value, label: value, count: n })).sort((a, b) => b.count - a.count),
    types: LEAGUE_TYPE_FILTERS.filter((t) => types.has(t)).map((t) => ({ value: t, label: TYPE_LABEL[t], count: types.get(t) ?? 0 })),
    formats: FORMAT_FILTERS.filter((t) => formats.has(t)).map((t) => ({ value: t, label: FORMAT_LABEL[t], count: formats.get(t) ?? 0 })),
    seasons: [...seasons].map(([value, n]) => ({ value, label: String(value), count: n })).sort((a, b) => b.value - a.value),
  }
}

/* ──────────────────────────────── scoring ───────────────────────────────── */

/**
 * A row that can say something about results. A draft-only league has no games,
 * and a season that has not kicked off has a record of 0-0 that is not a record.
 */
export function isResultRow(r: CareerLedgerRow): boolean {
  return r.gamesPlayed > 0 && r.specialty !== 'draft_only'
}

export type ScoringCohorts = Map<string, { mean: number; n: number }>

export function cohortKey(r: CareerLedgerRow): string {
  const flag = (v: boolean | null) => (v == null ? '?' : v ? 'y' : 'n')
  return [r.sport, r.season, r.scoring, `sf${flag(r.superflex)}`, `te${flag(r.tePremium)}`, r.specialty === 'bestball' ? 'bb' : 'h2h'].join('|')
}

/**
 * Average points per game for every scoring cohort with enough team-seasons.
 *
 * ⚠ BUILT FROM THE WHOLE COMMUNITY LEDGER, NEVER A FILTERED SLICE. Filtering to
 * one platform must not change what "average for a 2024 PPR superflex league"
 * means, or the same season would score differently depending on which tab it
 * was viewed from.
 */
export function buildScoringCohorts(rows: CareerLedgerRow[]): ScoringCohorts {
  const acc = new Map<string, { sum: number; n: number }>()
  for (const r of rows) {
    if (!isResultRow(r) || r.pointsFor == null) continue
    const k = cohortKey(r)
    const a = acc.get(k) ?? { sum: 0, n: 0 }
    a.sum += r.pointsFor / r.gamesPlayed
    a.n += 1
    acc.set(k, a)
  }
  const out: ScoringCohorts = new Map()
  for (const [k, a] of acc) if (a.n >= SCORING_COHORT_MIN) out.set(k, { mean: a.sum / a.n, n: a.n })
  return out
}

export type ComponentKey = keyof typeof SCORE_WEIGHTS

export type ScoreComponent = {
  key: ComponentKey
  label: string
  /** Nominal weight from `SCORE_WEIGHTS`. */
  weight: number
  /** Weight after unavailable components are removed; 0 when this one is unavailable. */
  appliedWeight: number
  /** 0..1 credit, or null when unavailable. */
  credit: number | null
  /** Points this component adds to the 0–100 score. */
  points: number
  /** The measured value, formatted. */
  value: string
  /** The same value in a few words, for sentences and the share card. */
  short: string
  /** What it was measured over. */
  basis: string
  /** One sentence on how the value became credit. */
  explain: string
  available: boolean
}

export type ManagerScore = {
  /** 0–100, or null when no row carries a result. */
  score: number | null
  components: ScoreComponent[]
  sample: {
    /** Every row after filters, results or not. */
    leagueSeasons: number
    /** Rows with games played. */
    resultSeasons: number
    /** Result rows whose season is decided — the only ones titles and berths are judged on. */
    completedSeasons: number
    games: number
    /** Distinct years among result rows. */
    seasons: number
  }
  totals: {
    wins: number
    losses: number
    ties: number
    titles: number
    expectedTitles: number
    playoffs: number
    expectedPlayoffs: number
    winRate: number | null
    adjWinRate: number | null
    scoringIndex: number | null
    pricedGames: number
    titleRatio: number | null
    playoffRatio: number | null
  }
  field: { avgSize: number | null; avgPlayoffShare: number | null }
  confidence: 'low' | 'medium' | 'high'
  /** GM prestige from the same rows, for the career page's own number. */
  prestige: number
  newestUpdate: string | null
  oldestUpdate: string | null
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const round1 = (n: number) => Math.round(n * 10) / 10
const pct1 = (n: number) => `${round1(n * 100).toFixed(1)}%`

function logCredit(ratio: number, span: number): number {
  return clamp01(0.5 + Math.log(ratio) / (2 * Math.log(span)))
}

export function scoreRows(rows: CareerLedgerRow[], cohorts: ScoringCohorts): ManagerScore {
  const results = rows.filter(isResultRow)
  const completed = results.filter((r) => r.completed)

  let wins = 0
  let losses = 0
  let ties = 0
  for (const r of results) {
    wins += r.wins
    losses += r.losses
    ties += r.ties
  }
  const games = wins + losses + ties
  const winRate = games > 0 ? (wins + ties / 2) / games : null
  const adjWinRate =
    games > 0 ? (wins + ties / 2 + WIN_RATE_PRIOR_GAMES / 2) / (games + WIN_RATE_PRIOR_GAMES) : null

  let idxWeighted = 0
  let pricedGames = 0
  for (const r of results) {
    if (r.pointsFor == null) continue
    const c = cohorts.get(cohortKey(r))
    if (!c || c.mean <= 0) continue
    idxWeighted += ((r.pointsFor / r.gamesPlayed / c.mean) * 100) * r.gamesPlayed
    pricedGames += r.gamesPlayed
  }
  const scoringIndex =
    pricedGames > 0 ? (idxWeighted + 100 * SCORING_PRIOR_GAMES) / (pricedGames + SCORING_PRIOR_GAMES) : null

  const titles = completed.filter((r) => r.wonChampionship).length
  const expectedTitles = completed.reduce((s, r) => s + 1 / Math.max(2, r.leagueSize), 0)
  const titleRatio = completed.length > 0 ? (titles + TITLE_PRIOR) / (expectedTitles + TITLE_PRIOR) : null

  const cutRows = completed.filter((r) => r.playoffTeams != null && r.playoffTeams > 0 && r.leagueSizeKnown)
  const playoffs = cutRows.filter((r) => r.madePlayoffs).length
  const expectedPlayoffs = cutRows.reduce(
    (s, r) => s + Math.min(1, (r.playoffTeams as number) / Math.max(2, r.leagueSize)),
    0,
  )
  const playoffRatio = cutRows.length > 0 ? (playoffs + PLAYOFF_PRIOR) / (expectedPlayoffs + PLAYOFF_PRIOR) : null

  const components: ScoreComponent[] = [
    {
      key: 'winRate',
      label: 'Win rate',
      weight: SCORE_WEIGHTS.winRate,
      appliedWeight: 0,
      credit: adjWinRate == null ? null : clamp01((adjWinRate - WIN_RATE_FLOOR) / (WIN_RATE_CEILING - WIN_RATE_FLOOR)),
      points: 0,
      value: winRate == null ? '—' : `${pct1(winRate)} (adjusted ${pct1(adjWinRate as number)})`,
      short: adjWinRate == null ? '—' : `${pct1(adjWinRate)} adjusted`,
      basis: `${games.toLocaleString()} games in ${results.length} league-seasons`,
      explain: `Counted per game, then blended with ${WIN_RATE_PRIOR_GAMES} games at .500 so a short record cannot outrank a long one. ${pct1(WIN_RATE_FLOOR)} earns nothing and ${pct1(WIN_RATE_CEILING)} earns full credit.`,
      available: adjWinRate != null,
    },
    {
      key: 'scoring',
      label: 'Scoring',
      weight: SCORE_WEIGHTS.scoring,
      appliedWeight: 0,
      credit:
        scoringIndex == null
          ? null
          : clamp01((scoringIndex - SCORING_INDEX_FLOOR) / (SCORING_INDEX_CEILING - SCORING_INDEX_FLOOR)),
      points: 0,
      value: scoringIndex == null ? '—' : `${round1(scoringIndex).toFixed(1)} index`,
      short: scoringIndex == null ? '—' : `${round1(scoringIndex).toFixed(1)} index`,
      basis:
        pricedGames > 0
          ? `${pricedGames.toLocaleString()} games with points and a comparable format`
          : 'No league-season with recorded points has a comparable format group yet',
      explain: `Points per game against the average AllFantasy team in the same sport, season, scoring, superflex/TE-premium setting and best-ball flag (100 = average; a group needs ${SCORING_COHORT_MIN} teams). ${SCORING_INDEX_FLOOR} earns nothing and ${SCORING_INDEX_CEILING} earns full credit.`,
      available: scoringIndex != null,
    },
    {
      key: 'titles',
      label: 'Titles vs. field',
      weight: SCORE_WEIGHTS.titles,
      appliedWeight: 0,
      credit: titleRatio == null ? null : logCredit(titleRatio, TITLE_RATIO_SPAN),
      points: 0,
      value: titleRatio == null ? '—' : `${titles} won vs ${round1(expectedTitles).toFixed(1)} expected`,
      short: titleRatio == null ? '—' : `${titles} vs ${round1(expectedTitles).toFixed(1)} expected`,
      basis: `${completed.length} completed league-seasons`,
      explain: `Each completed league offers a 1-in-N title, so a 14-team title counts for more than an 8-team one. Matching the expectation earns half credit; ${TITLE_RATIO_SPAN}× earns full credit.`,
      available: titleRatio != null,
    },
    {
      key: 'playoffs',
      label: 'Playoffs vs. cut',
      weight: SCORE_WEIGHTS.playoffs,
      appliedWeight: 0,
      credit: playoffRatio == null ? null : logCredit(playoffRatio, PLAYOFF_RATIO_SPAN),
      points: 0,
      value: playoffRatio == null ? '—' : `${playoffs} berths vs ${round1(expectedPlayoffs).toFixed(1)} expected`,
      short: playoffRatio == null ? '—' : `${playoffs} vs ${round1(expectedPlayoffs).toFixed(1)} expected`,
      basis: `${cutRows.length} completed league-seasons with a known playoff cut`,
      explain: `Judged against each league's own cut — 4 of 12 is harder than 6 of 10. Matching the expectation earns half credit; ${PLAYOFF_RATIO_SPAN}× earns full credit.`,
      available: playoffRatio != null,
    },
  ]

  const weightSum = components.reduce((s, c) => s + (c.available ? c.weight : 0), 0)
  let score: number | null = null
  if (weightSum > 0) {
    let total = 0
    for (const c of components) {
      if (!c.available || c.credit == null) continue
      c.appliedWeight = c.weight / weightSum
      c.points = round1(c.appliedWeight * c.credit * 100)
      total += c.appliedWeight * c.credit * 100
    }
    score = round1(total)
  }

  const sizes = results.filter((r) => r.leagueSizeKnown).map((r) => r.leagueSize)
  const shares = cutRows.map((r) => Math.min(1, (r.playoffTeams as number) / Math.max(2, r.leagueSize)))
  const years = new Set(results.map((r) => r.season)).size
  const stamps = rows.map((r) => r.updatedAt).filter((s): s is string => !!s).sort()

  const confidence: ManagerScore['confidence'] =
    games < 40 || results.length < 5 ? 'low' : results.length < 15 ? 'medium' : 'high'

  const prestige = computePrestige({
    championships: results.filter((r) => r.wonChampionship).length,
    winRate: winRateOf(wins, losses, ties),
    seasonsPlayed: years,
    leaguesPlayed: results.length,
    playoffAppearances: results.filter((r) => r.madePlayoffs).length,
  }).total

  return {
    score,
    components,
    sample: {
      leagueSeasons: rows.length,
      resultSeasons: results.length,
      completedSeasons: completed.length,
      games,
      seasons: years,
    },
    totals: {
      wins,
      losses,
      ties,
      titles,
      expectedTitles,
      playoffs,
      expectedPlayoffs,
      winRate,
      adjWinRate,
      scoringIndex,
      pricedGames,
      titleRatio,
      playoffRatio,
    },
    field: {
      avgSize: sizes.length ? round1(sizes.reduce((s, n) => s + n, 0) / sizes.length) : null,
      avgPlayoffShare: shares.length ? shares.reduce((s, n) => s + n, 0) / shares.length : null,
    },
    confidence,
    prestige,
    newestUpdate: stamps.length ? stamps[stamps.length - 1] : null,
    oldestUpdate: stamps.length ? stamps[0] : null,
  }
}

/* ───────────────────────────────── boards ───────────────────────────────── */

export type BoardKey = 'overall' | 'titles' | 'winRate' | 'scoring' | 'playoffs' | 'prestige' | 'drafters' | 'active'

export const BOARD_KEYS: BoardKey[] = ['overall', 'titles', 'winRate', 'scoring', 'playoffs', 'prestige', 'drafters', 'active']

export const BOARD_META: Record<BoardKey, { label: string; metricLabel: string; unavailable: string | null }> = {
  overall: { label: 'Overall', metricLabel: 'AF manager score, 0–100', unavailable: null },
  titles: { label: 'Titles', metricLabel: 'Titles above the field’s expectation', unavailable: null },
  winRate: { label: 'Win %', metricLabel: 'Adjusted win rate', unavailable: null },
  scoring: { label: 'Scoring', metricLabel: 'Points index vs. same-format teams', unavailable: null },
  playoffs: { label: 'Playoffs', metricLabel: 'Berths vs. each league’s cut', unavailable: null },
  prestige: { label: 'GM prestige', metricLabel: 'Career prestige, 0–100', unavailable: null },
  drafters: {
    label: 'Best drafters',
    metricLabel: 'Draft grade',
    /*
     * ⚠ A STATEMENT OF WHAT IS MISSING, NOT "COMING SOON". `draft_grades` is
     * keyed on (leagueId, season, rosterId) with no account id, and the only
     * bridge — `Roster.platformUserId` — holds a provider id on some rows and our
     * own uuid on others. A board built on that join would credit one manager's
     * draft to another.
     */
    unavailable:
      'Draft grades are stored per league roster, with no link back to an AllFantasy account. Ranking drafters across accounts needs that link before the board can be trusted.',
  },
  active: {
    label: 'Most active',
    metricLabel: 'Activity score',
    unavailable: 'Activity scoring needs per-manager chat, trade and waiver counts, which are not being recorded yet.',
  },
}

export function parseBoard(raw: string | null | undefined): BoardKey {
  // `top` was the pre-normalisation name of the default board; old links keep working.
  if (raw === 'top') return 'overall'
  return (BOARD_KEYS as string[]).includes(raw ?? '') ? (raw as BoardKey) : 'overall'
}

export type CommunityEntry = {
  userId: string
  handle: string
  avatarUrl: string | null
  level: number
  tierGroup: number
  score: ManagerScore
}

/** The number a board ranks by, or null when this manager cannot be placed on it. */
export function boardMetric(board: BoardKey, s: ManagerScore): number | null {
  switch (board) {
    case 'overall':
      return s.score
    case 'titles':
      return s.sample.completedSeasons > 0 ? s.totals.titles - s.totals.expectedTitles : null
    case 'winRate':
      return s.totals.adjWinRate
    case 'scoring':
      return s.totals.scoringIndex
    case 'playoffs':
      return s.totals.playoffRatio
    case 'prestige':
      return s.sample.resultSeasons > 0 ? s.prestige : null
    default:
      return null
  }
}

export function formatBoardMetric(board: BoardKey, s: ManagerScore): string {
  const m = boardMetric(board, s)
  if (m == null) return '—'
  switch (board) {
    case 'titles':
      return `${s.totals.titles} (${m >= 0 ? '+' : '−'}${Math.abs(round1(m)).toFixed(1)})`
    case 'winRate':
      return pct1(m)
    case 'playoffs':
      return `${(Math.round(m * 100) / 100).toFixed(2)}×`
    default:
      return round1(m).toFixed(1)
  }
}

export type BoardRow = {
  userId: string
  handle: string
  avatarUrl: string | null
  level: number
  tierGroup: number
  rank: number
  metric: number
  display: string
  score: ManagerScore
}

export type RankedBoard = {
  key: BoardKey
  rows: BoardRow[]
  /** Managers left off because their sample is under the minimum. */
  belowSample: number
  /** Managers with enough rows but nothing this board can measure. */
  unmeasured: number
}

/**
 * Rank managers on one board. Ties share a rank (1, 2, 2, 4); the order inside a
 * tie is by handle so it is stable between renders.
 */
export function rankBoard(entries: CommunityEntry[], board: BoardKey, minSample: number): RankedBoard {
  if (BOARD_META[board].unavailable) return { key: board, rows: [], belowSample: 0, unmeasured: 0 }
  let belowSample = 0
  let unmeasured = 0
  const scored: Array<Omit<BoardRow, 'rank'>> = []
  for (const e of entries) {
    if (e.score.sample.resultSeasons < minSample) {
      if (e.score.sample.leagueSeasons > 0) belowSample += 1
      continue
    }
    const metric = boardMetric(board, e.score)
    if (metric == null) {
      unmeasured += 1
      continue
    }
    scored.push({
      userId: e.userId,
      handle: e.handle,
      avatarUrl: e.avatarUrl,
      level: e.level,
      tierGroup: e.tierGroup,
      metric,
      display: formatBoardMetric(board, e.score),
      score: e.score,
    })
  }
  scored.sort((a, b) => b.metric - a.metric || a.handle.localeCompare(b.handle))
  const rows: BoardRow[] = []
  scored.forEach((row, i) => {
    const prev = rows[i - 1]
    const rank = prev && Math.abs(prev.metric - row.metric) < 1e-9 ? prev.rank : i + 1
    rows.push({ ...row, rank })
  })
  return { key: board, rows, belowSample, unmeasured }
}

export const SORT_KEYS = ['rank', 'manager', 'winRate', 'titles', 'playoffs', 'scoring', 'sample', 'move'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type SortDir = 'asc' | 'desc'

export function parseSort(rawSort: string | null | undefined, rawDir: string | null | undefined): { sort: SortKey; dir: SortDir } {
  const sort = (SORT_KEYS as readonly string[]).includes(rawSort ?? '') ? (rawSort as SortKey) : 'rank'
  const dir: SortDir = rawDir === 'desc' || rawDir === 'asc' ? rawDir : sort === 'rank' || sort === 'manager' ? 'asc' : 'desc'
  return { sort, dir }
}

/**
 * Re-order a ranked board for display. Rank numbers never change — sorting by
 * win rate shows who has the best win rate without pretending that is the rank.
 * Missing values sort last in either direction.
 */
export function sortBoardRows<T extends BoardRow & { movement?: number | null }>(rows: T[], sort: SortKey, dir: SortDir): T[] {
  const val = (r: T): number | string | null => {
    switch (sort) {
      case 'rank':
        return r.rank
      case 'manager':
        return r.handle.toLowerCase()
      case 'winRate':
        return r.score.totals.adjWinRate
      case 'titles':
        return r.score.sample.completedSeasons > 0 ? r.score.totals.titles : null
      case 'playoffs':
        return r.score.totals.playoffRatio
      case 'scoring':
        return r.score.totals.scoringIndex
      case 'sample':
        return r.score.sample.resultSeasons
      case 'move':
        return r.movement ?? null
    }
  }
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = val(a)
    const vb = val(b)
    if (va == null && vb == null) return a.rank - b.rank
    if (va == null) return 1
    if (vb == null) return -1
    const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)
    return cmp !== 0 ? cmp * sign : a.rank - b.rank
  })
}

/* ──────────────────────────────── movement ──────────────────────────────── */

/**
 * A stored daily board — the unfiltered Overall board as it stood that day.
 * `u`/`r`/`s` are short on purpose: one of these is kept per day.
 */
export type RankSnapshot = {
  date: string
  population: number
  rows: Array<{ u: string; r: number; s: number }>
}

/** Places climbed since the snapshot (positive = up), or null when either side is missing. */
export function movementSince(userId: string, currentRank: number | null, snapshot: RankSnapshot | null): number | null {
  if (currentRank == null || !snapshot) return null
  const then = snapshot.rows.find((row) => row.u === userId)
  return then ? then.r - currentRank : null
}

export type TrendPoint = { label: string; rank: number | null; score: number | null }

/** One manager's line through a set of snapshots, oldest first. */
export function seriesFor(userId: string, snapshots: RankSnapshot[]): TrendPoint[] {
  return [...snapshots]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((snap) => {
      const row = snap.rows.find((r) => r.u === userId)
      return { label: snap.date, rank: row?.r ?? null, score: row?.s ?? null }
    })
}

export type SeasonTrendPoint = {
  season: number
  /** The score that season's rows alone produce. */
  seasonScore: number | null
  /** The score everything up to and including that season produces. */
  careerScore: number | null
  leagueSeasons: number
  record: string
}

export function seasonTrend(rows: CareerLedgerRow[], cohorts: ScoringCohorts): SeasonTrendPoint[] {
  const seasons = [...new Set(rows.map((r) => r.season))].sort((a, b) => a - b)
  return seasons.map((season) => {
    const those = rows.filter((r) => r.season === season)
    const through = rows.filter((r) => r.season <= season)
    const one = scoreRows(those, cohorts)
    return {
      season,
      seasonScore: one.score,
      careerScore: scoreRows(through, cohorts).score,
      leagueSeasons: those.length,
      record: `${one.totals.wins}-${one.totals.losses}${one.totals.ties ? `-${one.totals.ties}` : ''}`,
    }
  })
}

/* ─────────────────────────────── calendar ───────────────────────────────── */

/** The US Eastern calendar date for an instant, `YYYY-MM-DD`. */
export function easternDateKey(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Shift a `YYYY-MM-DD` key by whole days. */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return t.toISOString().slice(0, 10)
}

/**
 * The Tuesday that opens the fantasy week containing `key` (Eastern). Tuesday,
 * not Monday, because Monday night is still last week's slate.
 */
export function fantasyWeekStartKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 Sun … 2 Tue
  const back = (dow - 2 + 7) % 7
  return shiftDateKey(key, -back)
}
