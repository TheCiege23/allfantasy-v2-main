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
 * The spellings on the RIGHT are the unverified half. `points`/`rebounds`/
 * `assists`/`steals`/`blocks`/`turnovers` are corroborated by
 * `lib/workers/devy-data-worker.ts`, which already parses basketball rows with
 * those names (and with the same 1.2 / 3 / 3 weights this sport config uses).
 */
const NBA_STAT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  pts: ['pts', 'points', 'PTS'],
  reb: ['reb', 'rebounds', 'totReb', 'totalRebounds', 'rebounds_total', 'REB'],
  ast: ['ast', 'assists', 'AST'],
  stl: ['stl', 'steals', 'STL'],
  blk: ['blk', 'blocks', 'blocked_shots', 'BLK'],
  to: ['to', 'tov', 'turnovers', 'turnover', 'TO'],
  threes: ['threes', 'tpm', 'fg3m', 'three_pointers_made', 'threePointersMade', '3pm'],
  fgm: ['fgm', 'field_goals_made', 'fieldGoalsMade', 'FGM'],
  ftm: ['ftm', 'free_throws_made', 'freeThrowsMade', 'FTM'],
}

/** Canonical keys from `lib/sportConfig/configs/nhl.ts`. Same split as above. */
const NHL_STAT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  g: ['g', 'goals', 'G'],
  a: ['a', 'assists', 'A'],
  plusminus: ['plusminus', 'plus_minus', 'plusMinus', '+/-'],
  sog: ['sog', 'shots', 'shots_on_goal', 'shotsOnGoal', 'SOG'],
  ppp: ['ppp', 'power_play_points', 'powerPlayPoints', 'PPP'],
  shp: ['shp', 'short_handed_points', 'shortHandedPoints', 'SHP'],
  blks: ['blks', 'blocked', 'blocks', 'blocked_shots', 'blockedShots'],
  hits: ['hits', 'HIT', 'hits_total'],
  pim: ['pim', 'penalty_minutes', 'penaltyMinutes', 'PIM'],
  g_win: ['g_win', 'wins', 'goalie_wins', 'goalieWins', 'W'],
  g_sv: ['g_sv', 'saves', 'goalie_saves', 'goalieSaves', 'SV'],
  g_so: ['g_so', 'shutouts', 'goalie_shutouts', 'goalieShutouts', 'SO'],
  g_ga: ['g_ga', 'goals_against', 'goalsAgainst', 'GA'],
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
  return normalizeWithAliases(raw, NHL_STAT_ALIASES)
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
