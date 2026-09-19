/**
 * Weekly stat normalization for the DAILY sports (NBA, NHL).
 *
 * ── Why this is not just "another normalizeNflWeeklyStats" ──────────────────
 *
 * NFL plays once a week, so `findCachedWeekPayload` finds THE row for a week and
 * normalizes it. NBA and NHL play three to five times a week, and the cache
 * keeps one row per game — `PlayerGameLogImportService.entryKey` is
 * `week:gameId:provider`, so a week legitimately holds several rows.
 *
 * Taking the first row (what the NFL path does) would silently score ONE game
 * of a player's week and look entirely correct. Everything here therefore
 * collects EVERY row for the week and sums it.
 *
 * ── 🛑 THE STAT KEY ALIASES BELOW ARE UNVERIFIED AGAINST THE VENDOR ─────────
 *
 * `contracts/rolling-insights/ENDPOINTS.yaml` declares NBA `confidence: low`
 * (game-level hints only, no player stat fields) and NHL `confidence: none`.
 * `GAPS.md` G-01 is still open, and `lib/sports-data/rollingInsightsGameLogs.ts`
 * says in its own header: "ONLY MLB IS MEASURED."
 *
 * The repo has already paid for guessing here once. From ENDPOINTS.yaml:
 *
 *     ⚠ Writing this parser from the NBA hint yields ZERO rows on a slate of
 *       fifteen games.
 *
 * So the aliases are a starting set, not a contract, and the design assumption
 * is that SOME OF THEM ARE WRONG. Two consequences, both deliberate:
 *
 *   1. `normalize*GameStats` reports the keys it could not place
 *      (`unmappedKeys`), so a wrong alias surfaces as a diagnostic instead of
 *      as a quietly-zero week.
 *   2. `SEASON_CAPABLE_SPORTS` in `lib/sport-scope.ts` is NOT widened by this
 *      module. Flipping that gate is a claim that a season can run to
 *      completion, and that claim needs one real captured payload first.
 *
 * Resolve G-01 by committing a fixture (the contract's own `scripts/probe.sh`,
 * during a game), then reconcile these tables against it.
 */

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/**
 * Canonical stat key -> the provider spellings we will accept for it.
 *
 * The canonical keys on the LEFT are not guesses: they are exactly the
 * `scoringCategories[].key` values in `lib/sportConfig/configs/nba.ts`, which is
 * what `calculateScoreFromSportConfig` scores against. A mismatch there scores
 * zero no matter how good the provider mapping is, so they are kept in lockstep
 * and covered by a test.
 *
 * ✅ The spellings on the RIGHT are now VERIFIED against the committed fixtures
 * `contracts/rolling-insights/fixtures/live.{NBA,NHL}.json` (probed 2026-03-15,
 * `G-01` RESOLVED). The vendor key actually observed is marked `measured`.
 * Other spellings are kept as tolerated fallbacks — they cost nothing and guard
 * a feed variant — but the measured one is what fires.
 */
const NBA_STAT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  pts: ['points', 'pts', 'PTS'], //                              measured: points
  reb: ['total_rebounds', 'reb', 'rebounds', 'totReb', 'REB'], // measured: total_rebounds
  ast: ['assists', 'ast', 'AST'], //                             measured: assists
  stl: ['steals', 'stl', 'STL'], //                              measured: steals
  blk: ['blocks', 'blk', 'blocked_shots', 'BLK'], //             measured: blocks
  to: ['turnovers', 'to', 'tov', 'turnover', 'TO'], //           measured: turnovers
  // ⚠ `three_pointS_made`, not `three_pointERS_made`. The guessed spelling was
  // one letter out, which scores every made three as nothing.
  threes: ['three_points_made', 'threes', 'tpm', 'fg3m', '3pm'],
  fgm: ['field_goals_made', 'fgm', 'FGM'], //                    measured: field_goals_made
  ftm: ['free_throws_made', 'ftm', 'FTM'], //                    measured: free_throws_made
}

/**
 * Canonical keys from `lib/sportConfig/configs/nhl.ts`.
 *
 * ⚠ NHL splits its box into `skaters` and `goalies`, so one player entry
 * carries only one group's keys. That split is handled upstream in the ingest
 * (`rollingInsightsGameLogs.ts`); stats arrive here already flattened.
 */
const NHL_STAT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  g: ['goals', 'g', 'G'], //                                     measured: goals
  a: ['assists', 'a', 'A'], //                                   measured: assists
  plusminus: ['plus_minus', 'plusminus', 'plusMinus', '+/-'], //  measured: plus_minus
  sog: ['shots_on_goal', 'sog', 'shots', 'SOG'], //               measured: shots_on_goal
  // ⚠ The feed carries NO *_points total for either special-teams stat, only
  // the goal and assist halves — summed below. The guessed single key matched
  // nothing at all.
  ppp: ['power_play_points', 'ppp', 'PPP'],
  shp: ['short_handed_points', 'shp', 'SHP'],
  blks: ['blocks', 'blks', 'blocked', 'blocked_shots'], //        measured: blocks
  hits: ['hits', 'HIT'], //                                      measured: hits
  pim: ['penalty_minutes', 'pim', 'PIM'], //                     measured: penalty_minutes
  // ⚠ Goalie keys are SINGULAR, and it is "allowed", not "against".
  g_win: ['win', 'g_win', 'wins', 'goalie_wins', 'W'], //         measured: win
  g_sv: ['saves', 'g_sv', 'goalie_saves', 'SV'], //               measured: saves
  g_so: ['shutouts', 'g_so', 'goalie_shutouts', 'SO'], //         measured: shutouts
  g_ga: ['goals_allowed', 'g_ga', 'goals_against', 'GA'], //      measured: goals_allowed
}

/**
 * Stats the feed reports only as component halves. Summed when no single total
 * key is present, the same way split rebounds are reconstructed for NBA.
 */
const NHL_COMPONENT_SUMS: Readonly<Record<string, readonly string[]>> = {
  ppp: ['power_play_goals', 'power_play_assists'],
  shp: ['short_handed_goals', 'short_handed_assists'],
}

/**
 * NBA double-double / triple-double are BONUSES the provider does not send —
 * they are counted from the other categories.
 *
 * 🛑 They must be derived PER GAME and then summed. Deriving them from a week's
 * totals is wrong in a way that always inflates: 40 points and 20 rebounds
 * across four games is not a double-double, and a player can genuinely record
 * three of them in one week.
 */
const DOUBLE_CATEGORIES = ['pts', 'reb', 'ast', 'stl', 'blk'] as const

export function countDoubleDigitCategories(stats: Record<string, number>): number {
  return DOUBLE_CATEGORIES.reduce((count, key) => count + ((stats[key] ?? 0) >= 10 ? 1 : 0), 0)
}

export interface NormalizedGameStats {
  stats: Record<string, number>
  /** Numeric keys present in the payload that no alias claimed. Diagnostic only. */
  unmappedKeys: string[]
}

function normalizeWithAliases(
  raw: unknown,
  aliases: Readonly<Record<string, readonly string[]>>,
  componentSums: Readonly<Record<string, readonly string[]>> = {},
): NormalizedGameStats {
  const source = isRecord(raw) && isRecord(raw.stats) ? raw.stats : raw
  if (!isRecord(source)) return { stats: {}, unmappedKeys: [] }

  const stats: Record<string, number> = {}
  const claimed = new Set<string>()

  for (const [canonical, spellings] of Object.entries(aliases)) {
    for (const spelling of spellings) {
      const value = asNumber(source[spelling])
      if (value !== undefined) {
        stats[canonical] = value
        claimed.add(spelling)
        break
      }
    }
  }

  // Basketball feeds commonly split rebounds; reconstruct the total when only
  // the halves are present rather than dropping the category entirely.
  if (stats.reb === undefined) {
    const off = asNumber(source.oreb) ?? asNumber(source.offensive_rebounds)
    const def = asNumber(source.dreb) ?? asNumber(source.defensive_rebounds)
    if (off !== undefined || def !== undefined) {
      stats.reb = (off ?? 0) + (def ?? 0)
      for (const k of ['oreb', 'offensive_rebounds', 'dreb', 'defensive_rebounds']) {
        if (source[k] !== undefined) claimed.add(k)
      }
    }
  }

  // Stats the feed only reports as halves (NHL power-play and short-handed
  // points). Only fires when no single total key was found, so a feed that
  // grows one later wins over the reconstruction.
  for (const [canonical, parts] of Object.entries(componentSums)) {
    if (stats[canonical] !== undefined) continue
    let total = 0
    let found = false
    for (const part of parts) {
      const value = asNumber(source[part])
      if (value !== undefined) {
        total += value
        claimed.add(part)
        found = true
      }
    }
    if (found) stats[canonical] = total
  }

  const unmappedKeys = Object.keys(source).filter(
    (key) => !claimed.has(key) && asNumber(source[key]) !== undefined,
  )

  return { stats, unmappedKeys }
}

export function normalizeNbaGameStats(raw: unknown): NormalizedGameStats {
  const result = normalizeWithAliases(raw, NBA_STAT_ALIASES)
  if (Object.keys(result.stats).length === 0) return result

  // Derived per game — see the DOUBLE_CATEGORIES note above.
  const doubles = countDoubleDigitCategories(result.stats)
  if (doubles >= 2) result.stats.dbl_dbl = 1
  if (doubles >= 3) result.stats.trpl_dbl = 1

  return result
}

export function normalizeNhlGameStats(raw: unknown): NormalizedGameStats {
  return normalizeWithAliases(raw, NHL_STAT_ALIASES, NHL_COMPONENT_SUMS)
}

/**
 * Every cached row belonging to `week`, not merely the first.
 *
 * `findCachedWeekPayload` in `nflStatNormalization.ts` deliberately returns one
 * row, which is right for a sport that plays once a week and wrong for these.
 */
export function collectCachedWeekRows(payload: unknown, week: number): unknown[] {
  const rows: unknown[] = []

  const visit = (node: unknown, depth: number) => {
    if (depth > 4 || node == null) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    if (!isRecord(node)) return

    const rowWeek = asNumber(node.week) ?? asNumber(node.weekNumber) ?? asNumber(node.gameWeek)
    if (rowWeek === week) {
      rows.push(node)
      return
    }
    // Only descend through the container keys the importer actually writes, so
    // an unrelated nested object cannot be mistaken for a game row.
    if (rowWeek === undefined) {
      for (const key of ['gameLogs', 'weeklyStats', 'weeks', 'logs', 'stats']) {
        if (node[key] !== undefined) visit(node[key], depth + 1)
      }
    }
  }

  visit(payload, 0)
  return rows
}

export interface WeeklyAggregate {
  stats: Record<string, number>
  gamesCounted: number
  unmappedKeys: string[]
}

/** Sum per-game normalized stats into one week. */
export function aggregateWeeklyStats(
  rows: readonly unknown[],
  normalizer: (raw: unknown) => NormalizedGameStats,
): WeeklyAggregate {
  const stats: Record<string, number> = {}
  const unmapped = new Set<string>()
  let gamesCounted = 0

  for (const row of rows) {
    const { stats: gameStats, unmappedKeys } = normalizer(row)
    for (const key of unmappedKeys) unmapped.add(key)
    if (Object.keys(gameStats).length === 0) continue
    gamesCounted += 1
    for (const [key, value] of Object.entries(gameStats)) {
      stats[key] = (stats[key] ?? 0) + value
    }
  }

  return { stats, gamesCounted, unmappedKeys: [...unmapped].sort() }
}

const DAILY_SPORT_NORMALIZERS: Readonly<Record<string, (raw: unknown) => NormalizedGameStats>> = {
  NBA: normalizeNbaGameStats,
  NHL: normalizeNhlGameStats,
}

export function isDailyStatSport(sport: string | null | undefined): boolean {
  return Object.hasOwn(DAILY_SPORT_NORMALIZERS, String(sport ?? '').trim().toUpperCase())
}

export interface WeekWindow {
  start: Date
  end: Date
}

/**
 * 🛑 A DAILY SPORT'S WEEK IS A DATE RANGE. IT IS NOT `weekOrRound`.
 *
 * Measured on production 2026-09-19: every MLB row (all 66,525, April through
 * September) and every SOCCER row carries `weekOrRound = 0`. The ingest says so
 * itself — "Football carries a real week; the daily sports do not, and 0 is this
 * column's documented 'no week' value". `lib/season-week/sportWeekSignal.ts`
 * measured the same thing on the schedule feed: NBA writes 0, NHL writes 500.
 *
 * So selecting these sports by `weekOrRound` matches NOTHING, forever, in the
 * quietest possible way — which is exactly what an earlier version of this
 * pipeline did. `gameDate` IS populated correctly, so the window is the selector.
 *
 * The anchor must be a real day. `SeasonCalendar` holds only MONTH granularity
 * (`{ monthStart, monthEnd }`) and is empty in production anyway, so there is no
 * anchor to read yet — callers that cannot supply one must decline rather than
 * invent a start date.
 */
export function weekWindowFromSeasonStart(
  seasonStartUtc: Date | string | null | undefined,
  week: number,
): WeekWindow | null {
  if (seasonStartUtc == null) return null
  const start = seasonStartUtc instanceof Date ? new Date(seasonStartUtc.getTime()) : new Date(seasonStartUtc)
  if (Number.isNaN(start.getTime())) return null
  if (!Number.isFinite(week) || week < 1) return null

  const DAY_MS = 86_400_000
  const windowStart = new Date(start.getTime() + (week - 1) * 7 * DAY_MS)
  return { start: windowStart, end: new Date(windowStart.getTime() + 7 * DAY_MS) }
}

/**
 * The per-game normalizer for a sport, for callers that already hold the week's
 * rows and do not need them found in a payload — notably the `playerGameStat`
 * path, where the query has already filtered to one week.
 */
export function getDailySportNormalizer(
  sport: string | null | undefined,
): ((raw: unknown) => NormalizedGameStats) | null {
  return DAILY_SPORT_NORMALIZERS[String(sport ?? '').trim().toUpperCase()] ?? null
}

/**
 * The entry point the weekly score service uses for a daily sport: find every
 * game in the week, normalize each, and sum.
 */
export function normalizeDailySportWeeklyStats(
  sport: string,
  payload: unknown,
  week: number,
): WeeklyAggregate {
  const normalizer = DAILY_SPORT_NORMALIZERS[String(sport).trim().toUpperCase()]
  if (!normalizer) return { stats: {}, gamesCounted: 0, unmappedKeys: [] }
  return aggregateWeeklyStats(collectCachedWeekRows(payload, week), normalizer)
}
