/**
 * CollegeFootballData per-game stat rows -> the canonical fantasy stat keys the NCAAF scoring config
 * reads (`lib/sportConfig/configs/ncaaf.ts`, the same names NFL uses).
 *
 * The rows are written by the scheduled CFBD ingest (`import-stat-lines` -> `cfbdGameLogs.ts` ->
 * `ingestSportStats`) into `player_game_stats`, one per player per game, with `weekOrRound` = the real
 * CFBD week. Their `normalizedStatMap` is FLAT and keyed `<category>.<stat>` exactly as
 * `parseCfbdGamePlayers` built it (`passing.YDS`, `receiving.REC`, `kicking.XPM` …): the shared
 * normalizer maps NCAAF through the NFL alias table, which matches none of the dotted keys, so the
 * payload arrives unchanged. That is the input this module expects.
 *
 * ⚠ ONLY WHAT THE CONFIG SCORES IS MAPPED, AND EVERYTHING ELSE IS NAMED. CFBD reports a great deal
 * that NCAAF fantasy scoring does not use (QBR, averages, longs, punting). Return touchdowns
 * are mapped separately from offensive and defensive touchdowns so a league can score them once.
 * Known informational fields are listed in `NON_SCORING_KEYS`; a key in NEITHER list is
 * reported as unmapped, which is how a vendor rename shows up as a warning instead of as a week in
 * which every quarterback quietly threw for zero yards.
 *
 * ⚠ WHAT CFBD CANNOT GIVE, AND IS THEREFORE NOT INVENTED: unenriched two-point conversions, field-goal distance
 * buckets, and team-defense lines. Explicit ESPN conversion evidence is enriched separately;
 * missing conversion evidence is not inferred from a score residual.
 */

interface NcaafGameStats {
  stats: Record<string, number>
  /** Numeric CFBD keys that are neither scored nor known-non-scoring. Diagnostic. */
  unmappedKeys: string[]
  /** True when the row carried any CFBD stat at all — the player appeared in the game. */
  appeared: boolean
}

/** CFBD dotted key -> canonical scoring key. */
export const NCAAF_STAT_ALIASES: Readonly<Record<string, string>> = {
  'passing.YDS': 'pass_yds',
  'passing.TD': 'pass_td',
  'passing.INT': 'pass_int',
  'rushing.YDS': 'rush_yds',
  'rushing.TD': 'rush_td',
  'receiving.REC': 'rec',
  'receiving.YDS': 'rec_yds',
  'receiving.TD': 'rec_td',
  'fumbles.LOST': 'fum_lost',
  'conversions.PASS': 'pass_2pt',
  'conversions.RUSH': 'rush_2pt',
  'conversions.REC': 'rec_2pt',
  'kickReturns.TD': 'kr_td',
  'puntReturns.TD': 'pr_td',
  'kicking.XPM': 'xp_made',
  'kicking.FGM': 'fg_made',
  'defensive.SOLO': 'idp_solo',
  'defensive.TOT': 'idp_tackle',
  'defensive.SACKS': 'idp_sack',
  'defensive.PD': 'idp_pd',
  'defensive.TFL': 'idp_tfl',
  'defensive.TD': 'idp_td',
  'interceptions.INT': 'idp_int',
  'interceptions.YDS': 'idp_int_return_yards',
}

/** Categories CFBD reports that NCAAF fantasy scoring does not read, wholesale. */
const NON_SCORING_CATEGORIES = new Set(['defensive', 'interceptions', 'punting'])

/** Individual keys in scored categories that carry no fantasy points. */
const NON_SCORING_KEYS = new Set([
  'kickReturns.NO', 'kickReturns.YDS', 'kickReturns.AVG', 'kickReturns.LONG',
  'puntReturns.NO', 'puntReturns.YDS', 'puntReturns.AVG', 'puntReturns.LONG',
  'passing.COMPLETIONS',
  'passing.ATT',
  'passing.C/ATT',
  'passing.AVG',
  'passing.QBR',
  'rushing.CAR',
  'rushing.AVG',
  'rushing.LONG',
  'receiving.AVG',
  'receiving.LONG',
  'fumbles.FUM',
  'fumbles.REC',
  'kicking.FGA',
  'kicking.FG',
  'kicking.XPA',
  'kicking.XP',
  'kicking.PCT',
  'kicking.LONG',
  'kicking.PTS',
])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** One CFBD game row's `normalizedStatMap` -> canonical stats. */
export function normalizeCfbdGameStats(raw: unknown): NcaafGameStats {
  const record = asRecord(raw)
  const stats: Record<string, number> = {}
  const unmapped: string[] = []
  let appeared = false
  if (!record) return { stats, unmappedKeys: unmapped, appeared }

  for (const [key, value] of Object.entries(record)) {
    const n = asNumber(value)
    // Strings ride along in the payload (`name`, `_team`, `_opponent`, `_homeAway`); only numbers are stats.
    if (n == null || !key.includes('.')) continue
    appeared = true
    const canonical = NCAAF_STAT_ALIASES[key]
    if (canonical) {
      stats[canonical] = (stats[canonical] ?? 0) + n
      continue
    }
    const category = key.slice(0, key.indexOf('.'))
    if (NON_SCORING_CATEGORIES.has(category) || NON_SCORING_KEYS.has(key)) continue
    unmapped.push(key)
  }
  // Makes/attempts are captured independently; derive misses only when both exist.
  for (const [made, attempted, missed] of [['kicking.FGM', 'kicking.FGA', 'fg_miss'], ['kicking.XPM', 'kicking.XPA', 'xp_miss']]) {
    const m = asNumber(record[made]), a = asNumber(record[attempted])
    if (m != null && a != null && a >= m) stats[missed] = a - m
  }
  return { stats, unmappedKeys: unmapped, appeared }
}

interface NcaafWeekAggregate {
  stats: Record<string, number>
  /** Game rows in which the player appeared. A player who appeared and produced nothing still counts. */
  gamesCounted: number
  unmappedKeys: string[]
}

/**
 * Rolling Insights college football box lines (`/live/{date}/NCAAFB`) -> the same canonical keys.
 *
 * The row's `normalizedStatMap` is the shape `rollingInsightsGameLogs.normalizedStatMapFor` writes:
 * `{ stats: { passing_yards: 253, ... }, position, ... }`. The field names are from the committed
 * fixture (contracts/rolling-insights/fixtures/live.NCAAFB.json, 54 games, captured 2026-10-05):
 * flat per player, no group level.
 *
 * ⚠ THE CONTRACT SAYS WHAT IS MISSING, AND IT IS NOT INVENTED HERE: no two-point conversion fields
 * and no forced fumbles (`limits: no_verified_player_two_point_or_forced_fumble_fields`). `tackles` is
 * the total; RI sends no solo/assisted split.
 */
export const RI_NCAAF_STAT_ALIASES: Readonly<Record<string, string>> = {
  passing_yards: 'pass_yds',
  passing_touchdowns: 'pass_td',
  passing_interceptions: 'pass_int',
  rushing_yards: 'rush_yds',
  rushing_touchdowns: 'rush_td',
  receptions: 'rec',
  receiving_yards: 'rec_yds',
  receiving_touchdowns: 'rec_td',
  fumbles_lost: 'fum_lost',
  kick_return_touchdowns: 'kr_td',
  punt_return_touchdowns: 'pr_td',
  extra_points_made: 'xp_made',
  field_goals_made: 'fg_made',
  tackles: 'idp_tackle',
  sacks: 'idp_sack',
  interceptions: 'idp_int',
}

/** Informational RI fields the college scoring config does not use. Anything else is reported. */
const RI_NON_SCORING_KEYS = new Set([
  // Not a stat: the vendor's own player id rides inside the box line (seen on production, 2026-11-20).
  'player_id',
  'completions', 'passing_attempts', 'passer_rating', 'rushing_attempts', 'rushing_long', 'receiving_long',
  'fumbles', 'fumbles_recoveries', 'kick_returns', 'kick_return_yards', 'kick_return_long', 'punt_returns',
  'punt_return_yards', 'punt_return_long', 'punts', 'punting_yards', 'punts_long', 'inside_20',
  'field_goals_attempted', 'field_goals_long', 'extra_points_attempted', 'field_goal_distances',
])

/** True when a stored row came from Rolling Insights (a nested `stats` object), not CFBD (flat dotted keys). */
export function isRiNcaafRow(raw: unknown): boolean {
  const stats = asRecord(asRecord(raw)?.stats)
  return stats != null
}

/** One Rolling Insights game row's `normalizedStatMap` -> canonical stats. */
export function normalizeRiNcaafGameStats(raw: unknown): NcaafGameStats {
  const stats: Record<string, number> = {}
  const unmapped: string[] = []
  const box = asRecord(asRecord(raw)?.stats)
  if (!box) return { stats, unmappedKeys: unmapped, appeared: false }
  let appeared = false
  for (const [key, value] of Object.entries(box)) {
    const n = asNumber(value)
    if (n == null || key === 'player_id') continue
    appeared = true
    const canonical = RI_NCAAF_STAT_ALIASES[key]
    if (canonical) stats[canonical] = (stats[canonical] ?? 0) + n
    else if (!RI_NON_SCORING_KEYS.has(key)) unmapped.push(key)
  }
  for (const [made, attempted, missed] of [['field_goals_made', 'field_goals_attempted', 'fg_miss'], ['extra_points_made', 'extra_points_attempted', 'xp_miss']] as const) {
    const m = asNumber(box[made]), a = asNumber(box[attempted])
    if (m != null && a != null && a >= m) stats[missed] = a - m
  }
  return { stats, unmappedKeys: unmapped, appeared }
}

/**
 * Sum a player's game rows for one week (almost always one game; a rare week holds two).
 * Accepts CFBD rows and Rolling Insights rows; each is read by its own shape.
 */
export function aggregateNcaafWeek(rows: readonly unknown[]): NcaafWeekAggregate {
  const stats: Record<string, number> = {}
  const unmapped = new Set<string>()
  let gamesCounted = 0
  for (const row of rows) {
    const game = isRiNcaafRow(row) ? normalizeRiNcaafGameStats(row) : normalizeCfbdGameStats(row)
    for (const key of game.unmappedKeys) unmapped.add(key)
    if (!game.appeared) continue
    gamesCounted += 1
    for (const [key, value] of Object.entries(game.stats)) stats[key] = (stats[key] ?? 0) + value
  }
  return { stats, gamesCounted, unmappedKeys: [...unmapped].sort() }
}

/** `RedraftSeason.sport` stores the config key `NCAAFB`; everything else says `NCAAF`. */
export function isNcaafSport(sport: string | null | undefined): boolean {
  const s = String(sport ?? '').trim().toUpperCase()
  return s === 'NCAAF' || s === 'NCAAFB'
}
