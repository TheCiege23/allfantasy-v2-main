/**
 * Best-of-N playoff SERIES for native NBA / NHL / MLB redraft leagues. Pure and dependency-free — the
 * scorer, the bracket advance, the window sizing, the settings panel and the bracket board share it.
 *
 * TWO MODES, AND THE DEFAULT IS TODAY'S BEHAVIOUR.
 *  - `cumulative` (default, and every league that never saved this): a round lasts
 *    `League.playoffWeeksPerRound` weeks (the final `max(that, championship_length)`), and the round's
 *    score is the SUM of its weeks (lib/playoff-runtime/playoffRoundScoring.ts). Unchanged.
 *  - `series`: round `r` is a best-of-`N_r` series lasting exactly `N_r` weeks. Each week is one game,
 *    won by the higher points; the first team to `ceil(N_r / 2)` game wins takes the series, so it can
 *    be clinched before its last week. A week with equal points is won by the HIGHER SEED (the lower
 *    seed number). `playoffWeeksPerRound` and `championship_length` are not read in series mode — the
 *    series length IS the round's length.
 *
 * WHERE IT LIVES. `League.settings.playoff_series = { mode: 'series', lengths: [N_1, N_2, …] }` — one
 * entry per championship round, round 1 first. A round past the end of the list uses the LAST entry, so
 * `[3, 3, 5]` on a bracket that later grows a round still ends with the 5. The consolation bracket's
 * round `100 + n` and the third-place game play round `n`'s length. No schema column: a lengths list
 * whose every entry is 1 is stored as "off" (the key is removed), so N = 1 everywhere IS cumulative mode.
 *
 * GATING. Any N > 1 is an AF Commissioner setting (enforced in the settings PATCH). The READERS here
 * never look at the plan: a series configured while the plan was active finishes as configured if the
 * plan lapses mid-postseason, and the config is never stripped — the commissioner just cannot set a new
 * N > 1 (or change one) without the plan.
 */

export const PLAYOFF_SERIES_SETTINGS_KEY = 'playoff_series' as const

/** The series lengths a commissioner can pick. 1 is a single week. */
export const PLAYOFF_SERIES_LENGTHS = [1, 3, 5, 7] as const
export type PlayoffSeriesLength = (typeof PLAYOFF_SERIES_LENGTHS)[number]

/** A bracket is at most 16 teams (four rounds); a commissioner bye plan can add rounds. Generous bound. */
export const MAX_PLAYOFF_SERIES_ROUNDS = 8

/** The sports series mode is offered to (native redraft leagues only). */
export const PLAYOFF_SERIES_SPORTS: ReadonlySet<string> = new Set(['NBA', 'NHL', 'MLB'])

export function playoffSeriesSportSupported(sport: unknown): boolean {
  return PLAYOFF_SERIES_SPORTS.has(String(sport ?? '').trim().toUpperCase())
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function isSeriesLength(n: number): n is PlayoffSeriesLength {
  return (PLAYOFF_SERIES_LENGTHS as readonly number[]).includes(n)
}

/** All-ones (or empty) means "no series": null. Otherwise the list as given. */
function normalized(lengths: number[]): number[] | null {
  return lengths.length > 0 && lengths.some((n) => n > 1) ? lengths : null
}

/**
 * The league's series lengths, or null in cumulative mode (the default). Never throws; anything it does
 * not recognise reads as cumulative, which is the behaviour every league had before series existed.
 */
export function readPlayoffSeriesLengths(settings: unknown): number[] | null {
  const config = record(record(settings)?.[PLAYOFF_SERIES_SETTINGS_KEY])
  if (!config || config.mode !== 'series' || !Array.isArray(config.lengths)) return null
  const lengths = config.lengths.map((v) => Math.floor(Number(v)))
  if (lengths.length === 0 || lengths.length > MAX_PLAYOFF_SERIES_ROUNDS || !lengths.every(isSeriesLength)) return null
  return normalized(lengths)
}

export type ParsedPlayoffSeriesLengths = { ok: true; value: number[] | null } | { ok: false; error: string }

/** A commissioner's submitted lengths: an array of 1/3/5/7 (null or [] turns series off). */
export function parsePlayoffSeriesLengths(raw: unknown): ParsedPlayoffSeriesLengths {
  if (raw == null) return { ok: true, value: null }
  if (!Array.isArray(raw)) return { ok: false, error: 'playoffSeriesLengths must be a list of series lengths, one per round.' }
  if (raw.length > MAX_PLAYOFF_SERIES_ROUNDS) {
    return { ok: false, error: `playoffSeriesLengths can list at most ${MAX_PLAYOFF_SERIES_ROUNDS} rounds.` }
  }
  const lengths: number[] = []
  for (const v of raw) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
    if (typeof n !== 'number' || !Number.isInteger(n) || !isSeriesLength(n)) {
      return { ok: false, error: 'Each playoff series length must be 1, 3, 5 or 7.' }
    }
    lengths.push(n)
  }
  return { ok: true, value: normalized(lengths) }
}

/** The settings value to store for these lengths: the config object, or undefined to remove the key. */
export function playoffSeriesSettingsValue(lengths: number[] | null): { mode: 'series'; lengths: number[] } | undefined {
  return lengths ? { mode: 'series', lengths: [...lengths] } : undefined
}

/** Does this config need AF Commissioner? Any series longer than one week does. */
export function playoffSeriesNeedsPlan(lengths: readonly number[] | null | undefined): boolean {
  return Boolean(lengths && lengths.some((n) => n > 1))
}

export function samePlayoffSeriesLengths(a: readonly number[] | null | undefined, b: readonly number[] | null | undefined): boolean {
  const x = a ?? null
  const y = b ?? null
  if (x == null || y == null) return x == null && y == null
  return x.length === y.length && x.every((n, i) => n === y[i])
}

/**
 * Is a save of `next` refused for a commissioner WITHOUT the plan? Only when it sets a series (N > 1)
 * that differs from what is stored: re-saving the stored config is never refused, and turning series
 * off (all 1) is always free — a lapsed plan must be able to leave series mode.
 */
export function playoffSeriesChangeNeedsPlan(
  next: readonly number[] | null | undefined,
  current: readonly number[] | null | undefined,
): boolean {
  return playoffSeriesNeedsPlan(next) && !samePlayoffSeriesLengths(next, current)
}

/** Best-of length of championship round `roundNumber` (1-based). 1 when series mode is off. */
export function seriesLengthForRound(lengths: readonly number[] | null | undefined, roundNumber: number): number {
  if (!lengths || lengths.length === 0) return 1
  const round = Math.max(1, Math.floor(Number(roundNumber)) || 1)
  return lengths[Math.min(round, lengths.length) - 1] ?? 1
}

/** Game wins needed to take a best-of-N series: a majority, ceil(N / 2). */
export function seriesWinsNeeded(bestOf: number): number {
  return Math.ceil(Math.max(1, Math.floor(Number(bestOf)) || 1) / 2)
}

export type SeriesGameInput = { week: number; homePoints: number; awayPoints: number }

export type SeriesGame = SeriesGameInput & {
  winnerRosterId: string | null
  /** True when the points were equal and the higher seed took the game. */
  decidedBySeed: boolean
}

export type SeriesResult = {
  bestOf: number
  winsNeeded: number
  homeWins: number
  awayWins: number
  /** The games that count, in week order — never past the one that clinched. */
  games: SeriesGame[]
  /** Set once one team reached `winsNeeded`. */
  winnerRosterId: string | null
  loserRosterId: string | null
  /** The week the series was clinched in, when it was. */
  clinchedWeek: number | null
  /** Why no winner could be named for a game (equal points AND no seed to separate them). */
  blockedReason: string | null
}

/**
 * Score a series from its completed games, in week order. A tied game goes to the higher seed (lower
 * seed number); equal or missing seeds leave it for the commissioner, as a tied single game always has.
 * Games after the clinching one are ignored — the series is over.
 */
export function resolvePlayoffSeries(input: {
  bestOf: number
  homeRosterId: string
  awayRosterId: string
  homeSeed: number | null | undefined
  awaySeed: number | null | undefined
  games: readonly SeriesGameInput[]
}): SeriesResult {
  const bestOf = Math.max(1, Math.floor(Number(input.bestOf)) || 1)
  const winsNeeded = seriesWinsNeeded(bestOf)
  const result: SeriesResult = {
    bestOf,
    winsNeeded,
    homeWins: 0,
    awayWins: 0,
    games: [],
    winnerRosterId: null,
    loserRosterId: null,
    clinchedWeek: null,
    blockedReason: null,
  }
  const seedTieWinner = (): string | null => {
    const h = input.homeSeed
    const a = input.awaySeed
    if (h == null || a == null || h === a) return null
    return h < a ? input.homeRosterId : input.awayRosterId
  }
  const ordered = [...input.games].sort((x, y) => x.week - y.week)
  for (const game of ordered.slice(0, bestOf)) {
    let winner: string | null = null
    let decidedBySeed = false
    if (game.homePoints > game.awayPoints) winner = input.homeRosterId
    else if (game.awayPoints > game.homePoints) winner = input.awayRosterId
    else {
      winner = seedTieWinner()
      decidedBySeed = winner != null
    }
    result.games.push({ ...game, winnerRosterId: winner, decidedBySeed })
    if (!winner) {
      result.blockedReason = 'Tied playoff series game needs commissioner resolution.'
      break
    }
    if (winner === input.homeRosterId) result.homeWins += 1
    else result.awayWins += 1
    if (result.homeWins >= winsNeeded || result.awayWins >= winsNeeded) {
      const homeTook = result.homeWins >= winsNeeded
      result.winnerRosterId = homeTook ? input.homeRosterId : input.awayRosterId
      result.loserRosterId = homeTook ? input.awayRosterId : input.homeRosterId
      result.clinchedWeek = game.week
      break
    }
  }
  return result
}

/** What `RedraftPlayoffMatchup.metadata.series` holds. Written by the scorer, read by the advance and the UI. */
export type StoredPlayoffSeries = {
  bestOf: number
  winsNeeded: number
  homeWins: number
  awayWins: number
  games: Array<{ week: number; homePoints: number; awayPoints: number; winnerRosterId: string | null; decidedBySeed?: boolean; live?: boolean }>
  winnerRosterId: string | null
  clinchedWeek: number | null
}

/** The stored series on a matchup's metadata, or null when it is not a series (or unreadable). */
export function readStoredPlayoffSeries(metadata: unknown): StoredPlayoffSeries | null {
  const raw = record(record(metadata)?.series)
  if (!raw) return null
  const bestOf = Math.floor(Number(raw.bestOf))
  if (!Number.isFinite(bestOf) || bestOf <= 1 || !Array.isArray(raw.games)) return null
  const games: StoredPlayoffSeries['games'] = []
  for (const g of raw.games) {
    const row = record(g)
    if (!row) return null
    const week = Number(row.week)
    const homePoints = Number(row.homePoints)
    const awayPoints = Number(row.awayPoints)
    if (![week, homePoints, awayPoints].every(Number.isFinite)) return null
    games.push({
      week,
      homePoints,
      awayPoints,
      winnerRosterId: typeof row.winnerRosterId === 'string' ? row.winnerRosterId : null,
      ...(row.decidedBySeed === true ? { decidedBySeed: true } : {}),
      ...(row.live === true ? { live: true } : {}),
    })
  }
  return {
    bestOf,
    winsNeeded: seriesWinsNeeded(bestOf),
    homeWins: Math.max(0, Math.floor(Number(raw.homeWins)) || 0),
    awayWins: Math.max(0, Math.floor(Number(raw.awayWins)) || 0),
    games,
    winnerRosterId: typeof raw.winnerRosterId === 'string' ? raw.winnerRosterId : null,
    clinchedWeek: Number.isFinite(Number(raw.clinchedWeek)) && raw.clinchedWeek != null ? Number(raw.clinchedWeek) : null,
  }
}

/**
 * The series view for one matchup, for the bracket board and the matchup strip. Null for a single-week
 * round. `state`: not started (no completed game), in progress, or won.
 */
export function playoffSeriesView(input: {
  bestOf: number
  metadata: unknown
  homeRosterId: string | null
  awayRosterId: string | null
}): {
  bestOf: number
  winsNeeded: number
  homeWins: number
  awayWins: number
  state: 'not_started' | 'in_progress' | 'won'
  winnerRosterId: string | null
  leaderRosterId: string | null
} | null {
  const stored = readStoredPlayoffSeries(input.metadata)
  const bestOf = stored?.bestOf ?? Math.floor(Number(input.bestOf))
  if (!Number.isFinite(bestOf) || bestOf <= 1) return null
  const homeWins = stored?.homeWins ?? 0
  const awayWins = stored?.awayWins ?? 0
  const winnerRosterId = stored?.winnerRosterId ?? null
  const leaderRosterId =
    homeWins > awayWins ? input.homeRosterId : awayWins > homeWins ? input.awayRosterId : null
  return {
    bestOf,
    winsNeeded: seriesWinsNeeded(bestOf),
    homeWins,
    awayWins,
    state: winnerRosterId ? 'won' : homeWins + awayWins > 0 ? 'in_progress' : 'not_started',
    winnerRosterId,
    leaderRosterId,
  }
}
