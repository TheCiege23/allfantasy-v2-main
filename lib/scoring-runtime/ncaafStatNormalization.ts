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
 * that NCAAF fantasy scoring does not use (QBR, averages, longs, tackles, punting, returns). Those are
 * listed in `NON_SCORING_KEYS` so they are neither scored nor reported; a key in NEITHER list is
 * reported as unmapped, which is how a vendor rename shows up as a warning instead of as a week in
 * which every quarterback quietly threw for zero yards.
 *
 * ⚠ WHAT CFBD CANNOT GIVE, AND IS THEREFORE NOT INVENTED: two-point conversions, field-goal distance
 * buckets, and team-defense lines. Those categories stay at zero for the players they belong to.
 */

export interface NcaafGameStats {
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
  'kicking.XPM': 'xp_made',
}

/** Categories CFBD reports that NCAAF fantasy scoring does not read, wholesale. */
const NON_SCORING_CATEGORIES = new Set(['defensive', 'interceptions', 'punting', 'kickReturns', 'puntReturns'])

/** Individual keys in scored categories that carry no fantasy points. */
const NON_SCORING_KEYS = new Set([
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
  'kicking.FGM',
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
  return { stats, unmappedKeys: unmapped, appeared }
}

export interface NcaafWeekAggregate {
  stats: Record<string, number>
  /** Game rows in which the player appeared. A player who appeared and produced nothing still counts. */
  gamesCounted: number
  unmappedKeys: string[]
}

/** Sum a player's CFBD game rows for one week (almost always one game; a rare week holds two). */
export function aggregateNcaafWeek(rows: readonly unknown[]): NcaafWeekAggregate {
  const stats: Record<string, number> = {}
  const unmapped = new Set<string>()
  let gamesCounted = 0
  for (const row of rows) {
    const game = normalizeCfbdGameStats(row)
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
