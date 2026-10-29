/**
 * Last season's per-game rate from SEASON TOTALS (`player_season_stats`), for the prior-season blend in
 * dailySportForm.ts — the pure half. Used only where `player_game_stats` holds no game line for that
 * season, which on 2026-10-26 is every season but 2026 for all three daily sports.
 *
 * ── WHY TOTALS ÷ GAMES IS THE SAME NUMBER AS THE GAME-LINE PRIOR, AND WHEN IT IS NOT ───────────────
 * Every league category is `stat × points`, summed. So scoring a season's summed line and dividing by
 * games played IS the mean of the per-game scores — exactly what `scoreFormBlob` computes from game
 * lines. That holds only while every category the league weights is one the totals carry. A category
 * the totals cannot supply scores 0 here and its real value on a game line, so the prior would be biased
 * low for every player who earns it — silently. Hence two gates, both on MAPPED KEYS, never a guess:
 *
 *   1. per SPORT (`seasonTotalsWritableForSport`): the sport has a mapping table, so the writer stores a
 *      totals prior at all. It does NOT require the default scoring to map — NBA's default weights the
 *      doubles, yet a league that zeroes them is exactly priced by its totals;
 *   2. per LEAGUE, under its own scoring (`leagueAcceptsSeasonTotals`): a league that weights any
 *      unmapped key (an NHL hat-trick bonus, NBA's default double-double) gets no totals prior, and
 *      prices from this season alone — today's behaviour. This is the gate that decides; a league on a
 *      sport's defaults passes it only when `seasonTotalsBlockersForSport` is empty.
 *
 * The per-game derived categories are the ones totals can never supply: NBA double / triple doubles, the
 * MLB quality start, the NHL single-game thresholds and rate bonuses. They are resolved per game by
 * `dailySportStatNormalization.ts`, and a season total cannot say which games earned them.
 *
 * ── PER SPORT, MEASURED ON `player_season_stats` 2025 (source rolling_insights), 2026-10-26 ───────
 *   NHL  QUALIFIES, FOR SKATERS. Every default category maps: the skater keys below, and the goalie
 *        keys, which a skater's game line never carries (fixtures/live.NHL.json splits the box), so 0 is
 *        his true value. 942 skater rows; league totals match 2023 and 2024 (8,068 goals vs 8,085 /
 *        7,898; 46,929 games vs ~47,200).
 *        🛑 GOALIES ARE NOT PRICED. Their 2025 decisions are about half a season — 651 wins across 2,730
 *        goalie games where 2023 had 1,279 and 2024 1,299 — and shutouts are 0 (151 in 2024), while
 *        saves, shots and goals allowed look complete. The keys map; the numbers do not, so goalie rows
 *        carry no group and keep today's behaviour. `shootout_goals` is 0 in every stored season, so
 *        `so_g` is left unmapped too. It is the VENDOR'S number, not our ingestion's: the raw
 *        `regular_season` block kept verbatim in `fantasy_stat_lines` carries the same values (Vejmelka
 *        64 GP, 20-8-1), there is no other key or nesting, and `/live` sends `shutouts: 0` on 2026
 *        shutouts too (contracts/rolling-insights/GAPS.md, "NHL 2025 `player_season_stats`").
 *   NBA  PER LEAGUE. `dbl_dbl` (1.5) and `trpl_dbl` (3) are default-weighted and per-game derived, so a
 *        league on the defaults declines; one that weights neither takes the prior. Every other NBA
 *        category maps, and all 591 2025 rows carry all eleven keys as numbers (league totals 284,482
 *        points against 280,002 in 2024, so a full season).
 *   MLB  OFF. The default weights `qs` (4, per-game derived) AND `era` (-1): a game line scores that
 *        game's ERA, and no season total says what the per-game ERAs averaged. A league zeroing both could
 *        in principle qualify, but a row's one `games_played` covers batting and pitching appearances
 *        together (a two-way player, a position player who pitched), and `pitching.IP` is a baseball-
 *        notation string ("55.1" = 55⅓). Not mapped until those are settled; no table, nothing to gate.
 *
 * The vendor spellings are the ones the game-line normalizer measured against fixtures/live.{NBA,NHL}
 * .json; the season rows use the same names (read from the stored rows, not probed).
 */

import { resolveLeagueScoringRules, type LeagueScoringRules } from '@/lib/redraft/leagueScoringRules'
import { rankPositionFor, type DailySportFormBlob, type FormPlayer } from './dailySportForm'

/** One row shape: which rows it applies to, and each scorer key as a sum of vendor keys. */
type TotalsGroup = {
  /** A row belongs to the first group whose `marker` key it carries. */
  marker: string
  /** Scorer key -> the vendor season keys summed into it. Every one must be numeric, or the row is refused. */
  keys: Readonly<Record<string, readonly string[]>>
  /** Scorer keys this group's GAME line never carries, so 0 is exact for it (a skater's goalie stats). */
  zeroKeys?: readonly string[]
}

const NHL_SKATER: TotalsGroup = {
  marker: 'goals',
  keys: {
    g: ['goals'],
    a: ['assists'],
    pts: ['goals', 'assists'],
    plusminus: ['plus_minus'],
    sog: ['shots_on_goal'],
    ppp: ['power_play_goals', 'power_play_assists'],
    shp: ['short_handed_goals', 'short_handed_assists'],
    ppg: ['power_play_goals'],
    ppa: ['power_play_assists'],
    shg: ['short_handed_goals'],
    sha: ['short_handed_assists'],
    blks: ['blocks'],
    hits: ['hits'],
    pim: ['penalty_minutes'],
    fow: ['faceoffs_won'],
    fol: ['faceoffs_lost'],
    tk: ['takeaways'],
    gv: ['giveaways'],
  },
  zeroKeys: [
    'g_win', 'g_loss', 'g_otl', 'g_sv', 'g_so', 'g_ga', 'g_sa', 'g_toi',
    'g_40sv_game', 'g_50sv_game', 'g_sv_pct_bonus', 'g_gaa_bonus',
  ],
}

const NBA_PLAYER: TotalsGroup = {
  marker: 'points',
  keys: {
    pts: ['points'],
    reb: ['total_rebounds'],
    ast: ['assists'],
    stl: ['steals'],
    blk: ['blocks'],
    to: ['turnovers'],
    threes: ['three_points_made'],
    fgm: ['field_goals_made'],
    ftm: ['free_throws_made'],
    fga: ['field_goals_attempted'],
    fta: ['free_throws_attempted'],
  },
}

export const SEASON_TOTALS_GROUPS: Readonly<Record<string, readonly TotalsGroup[]>> = {
  NHL: [NHL_SKATER],
  NBA: [NBA_PLAYER],
}

/**
 * Every scorer key a sport's season totals price exactly, for EVERY row they price: a key mapped (or
 * structurally 0) in each group. Empty = the sport has no mapping.
 */
export function seasonTotalsMappedKeys(sport: string): Set<string> {
  const groups = (SEASON_TOTALS_GROUPS[sport.toUpperCase()] ?? []).map(
    (g) => new Set<string>([...Object.keys(g.keys), ...(g.zeroKeys ?? [])]),
  )
  if (groups.length === 0) return new Set()
  return new Set([...groups[0]!].filter((k) => groups.every((own) => own.has(k))))
}

/**
 * The categories this scoring weights that season totals cannot supply. Empty = the totals prior is
 * exact under this scoring. A threshold or tier category scores off another stat, never its own key, so
 * a weighted one is always unmapped. A sport with no mapping returns every weighted key.
 */
export function seasonTotalsUnmappedKeys(
  sport: string,
  rules: LeagueScoringRules,
  mapped: ReadonlySet<string> = seasonTotalsMappedKeys(sport),
): string[] {
  const out: string[] = []
  for (const cat of rules.categories) {
    const weight = rules.overrides[cat.key] ?? cat.defaultPoints
    if (!weight) continue
    if (cat.minForBonus != null || cat.tierStatKey != null || !mapped.has(cat.key)) out.push(cat.key)
  }
  return [...new Set(out)].sort()
}

/**
 * The keys that keep a league on the sport's DEFAULT scoring from taking the totals prior (empty = a
 * default league takes it). A sport without a mapping or a config is blocked by `['no_mapping']`.
 * Informational for the writer since per-league qualification: see `seasonTotalsWritableForSport`.
 */
export function seasonTotalsBlockersForSport(sport: string): string[] {
  const s = sport.toUpperCase()
  if (!SEASON_TOTALS_GROUPS[s]) return ['no_mapping']
  const rules = resolveLeagueScoringRules({ sport: s, settings: null })
  if (!rules) return ['no_mapping']
  return seasonTotalsUnmappedKeys(s, rules)
}

/**
 * Gate 1: the sport has a totals mapping (and a scoring config), so the writer stores a totals prior.
 * Whether any LEAGUE uses it is gate 2's call, per league.
 */
export function seasonTotalsWritableForSport(sport: string): boolean {
  const s = sport.toUpperCase()
  return Boolean(SEASON_TOTALS_GROUPS[s]) && resolveLeagueScoringRules({ sport: s, settings: null }) != null
}

/** Gate 2: this league's own scoring weights nothing the stored totals blob cannot supply. */
export function leagueAcceptsSeasonTotals(
  league: { sport: string; settings: unknown },
  blob: Pick<DailySportFormBlob, 'mappedKeys'>,
): boolean {
  const rules = resolveLeagueScoringRules(league)
  if (!rules || !blob.mappedKeys) return false
  return seasonTotalsUnmappedKeys(league.sport, rules, new Set(blob.mappedKeys)).length === 0
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * One season row's summed line in scorer keys, or null when the row cannot be priced exactly: no group
 * marker, a group key missing or non-numeric, or no games played. Zeros are dropped, as the game-line
 * blob drops them.
 */
export function mapSeasonTotals(
  sport: string,
  stats: Record<string, unknown>,
  gamesPlayed: number | null | undefined,
): { games: number; line: Record<string, number> } | null {
  const games = num(gamesPlayed)
  if (games == null || games <= 0) return null
  const group = (SEASON_TOTALS_GROUPS[sport.toUpperCase()] ?? []).find((g) => g.marker in stats)
  if (!group) return null
  const line: Record<string, number> = {}
  for (const [key, sources] of Object.entries(group.keys)) {
    let total = 0
    for (const s of sources) {
      const v = num(stats[s])
      if (v == null) return null
      total += v
    }
    if (total !== 0) line[key] = total
  }
  return { games: Math.round(games), line }
}

export type SeasonTotalsRow = {
  /** Already translated to the identity id the game lines are keyed on. */
  playerId: string
  stats: unknown
  gamesPlayed: number | null
  team: string | null
}

/**
 * A prior-season form blob from season totals: `ss` is the mapped season line and `sg` games played,
 * which is all `scoreFormBlob` reads from a prior (`scorer(ss) / sg`). No recent-form line — last season
 * has none that matters. Rows that cannot be priced exactly are left out, never zero-filled.
 */
export function buildSeasonTotalsForm(args: {
  sport: string
  season: number
  rows: readonly SeasonTotalsRow[]
  identityPositions: ReadonlyMap<string, string | null>
  computedAt: Date
}): DailySportFormBlob {
  const sport = args.sport.toUpperCase()
  const players: Record<string, FormPlayer> = {}
  for (const row of args.rows) {
    if (players[row.playerId]) continue
    const stats = row.stats && typeof row.stats === 'object' && !Array.isArray(row.stats) ? (row.stats as Record<string, unknown>) : {}
    const mapped = mapSeasonTotals(sport, stats, row.gamesPlayed)
    if (!mapped || Object.keys(mapped.line).length === 0) continue
    players[row.playerId] = {
      pos: rankPositionFor(sport, args.identityPositions.get(row.playerId), { pitchingApps: 0, starts: 0, lastGamePosition: null }),
      team: row.team ? row.team.trim().toUpperCase() : null,
      sg: mapped.games,
      ss: mapped.line,
      rg: 0,
      rs: {},
      part: null,
    }
  }
  return {
    v: 1,
    sport,
    season: args.season,
    computedAt: args.computedAt.toISOString(),
    recentGames: 0,
    players,
    basis: 'season_totals',
    mappedKeys: [...seasonTotalsMappedKeys(sport)].sort(),
  }
}
