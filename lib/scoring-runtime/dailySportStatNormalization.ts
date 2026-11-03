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
 *   2. This normalizer alone does not widen `SEASON_CAPABLE_SPORTS` in
 *      `lib/sport-scope.ts`. A season gate also needs a complete schedule,
 *      lineup locks, a fitted bracket, and an end-to-end season run.
 *
 * Resolve G-01 by committing a fixture (the contract's own `scripts/probe.sh`,
 * during a game), then reconcile these tables against it.
 */
import { normalizeMlbGameStats } from './mlbStatNormalization'
import { normalizeSoccerGameStats } from './soccerStatNormalization'

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
  ftm: ['free_throws_made', 'ftm', 'FTM'],
  fga: ['field_goals_attempted', 'fga', 'FGA'],
  fta: ['free_throws_attempted', 'fta', 'FTA'],
}

/**
 * Canonical keys from `lib/sportConfig/configs/ncaab.ts`: pts, reb, ast, stl, blk, to, threes.
 *
 * NCAAB's `/live` box has NBA's shape and field names (fixtures/live.NCAABB.json, GAPS G-03), so
 * the spellings are NBA's — but ONLY the categories the NCAAB config can score. NBA's table also
 * emits fgm/ftm and derived doubles, which ncaab.ts does not define; emitting them would be keys
 * the engine silently ignores, and the config-key test forbids it.
 */
const NCAAB_STAT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  pts: NBA_STAT_ALIASES.pts,
  reb: NBA_STAT_ALIASES.reb,
  ast: NBA_STAT_ALIASES.ast,
  stl: NBA_STAT_ALIASES.stl,
  blk: NBA_STAT_ALIASES.blk,
  to: NBA_STAT_ALIASES.to,
  threes: NBA_STAT_ALIASES.threes,
}

/**
 * Vendor keys the NCAAB box ALWAYS carries and the config deliberately does not score — every
 * numeric field in fixtures/live.NCAABB.json outside the aliases above. Without this list each of
 * them is reported as "Unrecognized NCAAB provider stat keys (alias table may be wrong)" on every
 * sync, and the warning stops meaning anything; with it, only a key the vendor has never sent
 * before is reported, which is what that warning is for.
 */
const NCAAB_KNOWN_UNSCORED = new Set([
  'player_id', 'fouls', 'minutes', 'offensive_rebounds', 'defensive_rebounds',
  'field_goals_made', 'field_goals_attempted', 'two_points_made', 'two_points_attempted',
  'two_point_percentage', 'three_points_attempted', 'free_throws_made', 'free_throws_attempted',
])

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
  // Wired 2026-10 for the commissioner panel's rows (lib/nhl-scoring/nhlScoringEngineContract.ts).
  // Every spelling below is a key in fixtures/live.NHL.json; nothing here is guessed.
  ppg: ['power_play_goals'], //                                  measured
  ppa: ['power_play_assists'], //                                measured
  shg: ['short_handed_goals'], //                                measured
  sha: ['short_handed_assists'], //                              measured
  fow: ['faceoffs_won'], //                                      measured
  fol: ['faceoffs_lost'], //                                     measured
  tk: ['takeaways'], //                                          measured
  gv: ['giveaways'], //                                          measured
  so_g: ['shootout_goals'], //                                   measured
  g_loss: ['loss'], //                                           measured (goalies; singular, like `win`)
  g_otl: ['overtime_loss'], //                                   measured (goalies)
  g_sa: ['shots_against'], //                                    measured (goalies)
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

export function normalizeNcaabGameStats(raw: unknown): NormalizedGameStats {
  const result = normalizeWithAliases(raw, NCAAB_STAT_ALIASES)
  return { ...result, unmappedKeys: result.unmappedKeys.filter((k) => !NCAAB_KNOWN_UNSCORED.has(k)) }
}

/**
 * NHL single-game bonuses the feed does not send, counted from that game's own line.
 *
 * 🛑 PER GAME, then summed — the same rule as NBA's double-double above. Two goals on Monday and
 * one on Thursday is not a hat trick, and a week's totals would say it was.
 */
const NHL_GAME_THRESHOLDS: ReadonlyArray<[bonus: string, stat: (s: Record<string, number>) => number, min: number]> = [
  ['hat_trick', (s) => s.g ?? 0, 3],
  ['multi_g_game', (s) => s.g ?? 0, 2],
  ['multi_a_game', (s) => s.a ?? 0, 2],
  ['three_ast_game', (s) => s.a ?? 0, 3],
  ['five_pt_game', (s) => (s.g ?? 0) + (s.a ?? 0), 5],
  ['ten_sog_game', (s) => s.sog ?? 0, 10],
  ['five_hit_game', (s) => s.hits ?? 0, 5],
  ['five_blk_game', (s) => s.blks ?? 0, 5],
  ['g_40sv_game', (s) => s.g_sv ?? 0, 40],
  ['g_50sv_game', (s) => s.g_sv ?? 0, 50],
]

/**
 * NHL rate-stat bonuses — save %, GAA and shooting % — evaluated on ONE game's line.
 *
 * 🛑 PER GAME, then summed, like the thresholds above. Owner's decision 2026-10-20: each game that
 * counts for the league earns or misses the bonus on its own. A .940 game and an .880 game are one
 * bonus, not a .910 week; recomputing the rate from week totals would award a different number
 * entirely. Which games count is decided downstream, not here: a weekly-lineup league sums every
 * game the starter played (`aggregateWeeklyStats`), and a daily-lineup league scores each day only
 * for that day's starters (`player_daily_scores`, lib/redraft/dailyLineups.ts). Because the engine
 * multiplies each key by a commissioner's value and sums, a week's points are then exactly the sum
 * of its games' points. There is no per-week mode; adding one means scoring a rate off totals,
 * which no path here does.
 *
 * Each needs its own denominator from the same line, and a game without one earns nothing rather
 * than a perfect rate: save % needs a shot against, GAA needs goalie minutes (`g_toi`, stored only
 * on lines ingested since 2026-10-20), shooting % needs a shot on goal.
 *
 * 🛑 AND A MINIMUM SAMPLE (owner's decision 2026-10-23). One goal on one shot is 100%, a reliever
 * stopping 3 of 3 is 1.000, and a goalie pulled after ten clean minutes is a 0.00 GAA — each a
 * near-maximal bonus for a game that proves nothing. A game below the minimum earns 0 for that
 * bonus; exactly at it, the bonus is earned. Fixed defaults, not panel settings: these bonuses are
 * baked into the shared `PlayerWeeklyScore` / `PlayerDailyScore` rows (keyed by player, not league)
 * before any league's settings are read, so a per-league minimum would need the rate scored at
 * league time instead. The panel help text states them (`NhlScoringCategories.ts`).
 */
const NHL_SAVE_PCT_FLOOR = 0.9 //   panel: bonus per 0.010 above .900
const NHL_GAA_CEILING = 2.5 //      panel: bonus for a GAA below 2.50
const NHL_SHOOTING_PCT_FLOOR = 10 // panel: bonus per point above 10%
export const NHL_SAVE_PCT_MIN_SHOTS_AGAINST = 20
export const NHL_GAA_MIN_GOALIE_MINUTES = 40
export const NHL_SHOOTING_PCT_MIN_SHOTS_ON_GOAL = 4

function addNhlRateBonuses(stats: Record<string, number>): void {
  if (stats.g_sv !== undefined) {
    const shotsAgainst = stats.g_sa ?? stats.g_sv + (stats.g_ga ?? 0)
    if (shotsAgainst >= NHL_SAVE_PCT_MIN_SHOTS_AGAINST) {
      const steps = (stats.g_sv / shotsAgainst - NHL_SAVE_PCT_FLOOR) / 0.01
      if (steps > 0) stats.g_sv_pct_bonus = steps
    }
  }
  if (stats.g_toi !== undefined && stats.g_toi >= NHL_GAA_MIN_GOALIE_MINUTES && stats.g_ga !== undefined) {
    if ((stats.g_ga * 60) / stats.g_toi < NHL_GAA_CEILING) stats.g_gaa_bonus = 1
  }
  if (stats.sog !== undefined && stats.sog >= NHL_SHOOTING_PCT_MIN_SHOTS_ON_GOAL) {
    const points = ((stats.g ?? 0) / stats.sog) * 100 - NHL_SHOOTING_PCT_FLOOR
    if (points > 0) stats.sh_pct_bonus = points
  }
}

/**
 * A goalie's shutout, derived from his own line, because the vendor's `shutouts` is 0 even for a
 * goalie who played the whole game and allowed nothing (contracts/rolling-insights/GAPS.md; five
 * full-game lines by 2026-10-08, Oettinger 26 of 26 among them).
 *
 * The NHL rule: one shutout, only to a goalie who was the ONLY goalie his team used and who allowed
 * no goal in regulation or overtime. Shootout goals are not goals against, so both goalies of a 0-0
 * game decided in a shootout get one. Two goalies splitting a clean game get none.
 *
 *   1. Sole goalie, from the ingest. `normalizedStatMapFor` counts the team's goalie lines that
 *      actually played (`teamGoaliesUsed`) while the whole box is in hand, and records whether the
 *      vendor called the game final. Trusted only once it is: mid-game, the starter is trivially the
 *      only goalie used so far, and a shutout through two periods is not one.
 *   2. Otherwise (a row ingested before that count was stored, or a game still running) a sole
 *      goalie cannot be established, so the line must show the full game itself: at least 60:00 on
 *      the clock (an overtime game runs longer, so 60 covers it) and no goal against. This misses
 *      a real shutout whose clock the vendor printed short — measured: 59:50, and "0" for goalies
 *      with 24 saves — which is the safe direction: it never awards a split or a relief outing.
 *
 * Either way a REGULATION loss with no goal against means the winner went into an empty net, which
 * is not a shutout; a shootout loss stays eligible, as in the NHL.
 */
export function derivedNhlShutout(stats: Record<string, number>, raw: JsonRecord): 0 | 1 {
  if (stats.g_ga !== 0) return 0
  if ((stats.g_loss ?? 0) > 0) return 0
  const played = (stats.g_toi ?? 0) > 0 || (stats.g_sa ?? 0) > 0 || (stats.g_sv ?? 0) > 0 ||
    (stats.g_win ?? 0) > 0 || (stats.g_otl ?? 0) > 0
  if (!played) return 0
  const used = asNumber(raw.teamGoaliesUsed)
  if (raw.gameFinal === true && used !== undefined) return used === 1 ? 1 : 0
  return (stats.g_toi ?? 0) >= NHL_SHUTOUT_FULL_GAME_MINUTES ? 1 : 0
}

/**
 * A goalie's WIN, derived from the box, because the vendor leaves it out: 68 of 179 regular-season
 * 2026 games had no goalie credited with one by 2026-10-26 (31 of 43 in week 1, 35 of 46 in week 2).
 *
 * Credited only when all of it is in hand from the ingest (`normalizedStatMapFor`):
 *   - the vendor called the game final (`gameFinal`);
 *   - his team won (`teamWon`, from the box's scores, or for a tie on the board the box's own
 *     decisions / shootout goals — `riWinningTeam`), which is absent when the box cannot say;
 *   - he was the ONLY goalie his team used (`teamGoaliesUsed === 1`) and he played.
 * When the winners used two goalies the win belongs to whoever was in net for the winning goal,
 * which only play-by-play can say, so nothing is derived. A row without that context (written
 * before it was stored, or a game still running) derives nothing either: a goalie's own line
 * cannot show that his team won. A line the vendor already gave a loss is left alone.
 */
export function derivedNhlWin(stats: Record<string, number>, raw: JsonRecord): 0 | 1 {
  if (raw.gameFinal !== true || raw.teamWon !== true) return 0
  if (asNumber(raw.teamGoaliesUsed) !== 1) return 0
  if ((stats.g_loss ?? 0) > 0 || (stats.g_otl ?? 0) > 0) return 0
  const played = (stats.g_toi ?? 0) > 0 || (stats.g_sa ?? 0) > 0 || (stats.g_sv ?? 0) > 0 || (stats.g_win ?? 0) > 0
  return played ? 1 : 0
}

/** Regulation length. The fallback in {@link derivedNhlShutout} requires the goalie's clock to reach it. */
export const NHL_SHUTOUT_FULL_GAME_MINUTES = 60

/**
 * Numeric keys every stored NHL line carries that no category scores. `player_id` is folded into
 * each line by the ingest (the vendor keys the box BY id); without this it was reported as
 * "Unrecognized NHL provider stat keys (alias table may be wrong): player_id" on every sync.
 */
const NHL_KNOWN_UNSCORED = new Set(['player_id', 'time_on_ice_minutes'])

export function normalizeNhlGameStats(raw: unknown): NormalizedGameStats {
  const normalized = normalizeWithAliases(raw, NHL_STAT_ALIASES, NHL_COMPONENT_SUMS)
  const result = { ...normalized, unmappedKeys: normalized.unmappedKeys.filter((k) => !NHL_KNOWN_UNSCORED.has(k)) }
  const stats = result.stats
  if (Object.keys(stats).length === 0) return result

  // Goalie minutes played. Skaters carry the same clock, so it is credited by the line's GROUP,
  // which the ingest stores beside `stats` (rollingInsightsGameLogs.ts `normalizedStatMapFor`).
  // Only rows ingested after time on ice was stored carry it; older rows simply score 0 here.
  if (isRecord(raw) && raw.group === 'goalies' && isRecord(raw.stats)) {
    const minutes = asNumber(raw.stats.time_on_ice_minutes)
    if (minutes !== undefined) stats.g_toi = minutes
  }

  if (isRecord(raw) && raw.group === 'goalies') {
    // max(vendor, derived), clamped: a vendor fix later can never make one game two wins.
    if (derivedNhlWin(stats, raw) === 1) stats.g_win = 1
    else if (stats.g_win !== undefined) stats.g_win = Math.min(1, Math.max(0, stats.g_win))
    // max(vendor, derived), clamped: a vendor fix later can never make one game two shutouts.
    if (derivedNhlShutout(stats, raw) === 1) stats.g_so = 1
    else if (stats.g_so !== undefined) stats.g_so = Math.min(1, Math.max(0, stats.g_so))
  }

  if (stats.g !== undefined || stats.a !== undefined) stats.pts = (stats.g ?? 0) + (stats.a ?? 0)
  for (const [bonus, stat, min] of NHL_GAME_THRESHOLDS) {
    if (stat(stats) >= min) stats[bonus] = 1
  }
  addNhlRateBonuses(stats)
  return result
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
  NCAAB: normalizeNcaabGameStats,
  // Group-aware (batting vs pitching share field names) and measured against fixtures/live.MLB.json —
  // see mlbStatNormalization.ts. Registering it lets the weekly sync score MLB once the season's
  // opener is recorded (dailySportSeasonStarts.ts); without one, the sync declines and says so.
  MLB: normalizeMlbGameStats,
  // Measured against the stored production rows, not the contract (G-04 has no soccer fields) — see
  // soccerStatNormalization.ts. Like MLB, a week scores only once its season opener is recorded.
  SOCCER: normalizeSoccerGameStats,
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
