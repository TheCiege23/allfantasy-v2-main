/**
 * Pure half of `nflSpecialistRates.ts`: turns a kicker's or a team defense's stored game logs into
 * per-game rates, in the vocabulary league scoring is priced in (`lib/projections/leagueScoring.ts`).
 *
 * A rate is this season's average. It does not adjust for the week's opponent.
 */
export type SpecialistRate = {
  kind: 'K' | 'DEF'
  /** Games the average is over. */
  games: number
  perGame: Record<string, number>
}

/** Fewer games than this is one good or bad day, not a rate. */
export const MIN_SPECIALIST_GAMES = 2

/** Rate key → the stored stat(s) summed into it. `fg_40_49` and `fg_50_plus` are how the log names those makes. */
const KICKER_STATS: Readonly<Record<string, readonly string[]>> = {
  fgm_0_19: ['fgm_0_19'],
  fgm_20_29: ['fgm_20_29'],
  fgm_30_39: ['fgm_30_39'],
  fgm_40_49: ['fg_40_49'],
  fgm_50p: ['fg_50_plus'],
  fgmiss: ['fgmiss'],
  xpm: ['pat_made'],
  xpmiss: ['pat_missed'],
}

/** The log holds no defensive-touchdown count for a team defense, so none is projected. */
const DEFENSE_STATS: Readonly<Record<string, readonly string[]>> = {
  sack: ['dst_sack'],
  int: ['dst_interception'],
  fum_rec: ['fum_rec'],
  safe: ['safe'],
  blk_kick: ['blk_kick'],
  def_st_td: ['def_st_td'],
  pts_allow: ['pts_allow'],
  // Each game is flagged 1 in exactly one bucket, so the average is how often that bucket happens.
  pts_allow_0: ['pts_allow_0'],
  pts_allow_1_6: ['pts_allow_1_6'],
  pts_allow_7_13: ['pts_allow_7_13'],
  pts_allow_14_20: ['pts_allow_14_20'],
  pts_allow_21_27: ['pts_allow_21_27'],
  pts_allow_28_34: ['pts_allow_28_34'],
  pts_allow_35p: ['pts_allow_35p'],
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

export function summarizeSpecialistGames(games: ReadonlyArray<Record<string, unknown>>): SpecialistRate | null {
  const defense = games.filter((g) => num(g.pts_allow) != null)
  const kicking = games.filter((g) => num(g.pts_allow) == null && (num(g.fga) != null || num(g.xpa) != null))
  // A club's row carries its kicker's attempts too; points allowed is what marks it as the defense.
  const kind: SpecialistRate['kind'] | null = defense.length > 0 ? 'DEF' : kicking.length > 0 ? 'K' : null
  if (!kind) return null
  const rows = kind === 'DEF' ? defense : kicking
  if (rows.length < MIN_SPECIALIST_GAMES) return null
  const stats = kind === 'DEF' ? DEFENSE_STATS : KICKER_STATS
  const perGame: Record<string, number> = {}
  for (const [rate, sources] of Object.entries(stats)) {
    let total = 0
    for (const game of rows) for (const source of sources) total += num(game[source]) ?? 0
    perGame[rate] = total / rows.length
  }
  return { kind, games: rows.length, perGame }
}

/**
 * A team defense's component line for one NFL week, from its season rate: each count and each
 * points-allowed bracket frequency scaled by the games the club plays that week.
 *
 * Null for a week the club does not play (a bye, or no game on file): no line, so the lineup
 * surfaces say "no projection — a bye" rather than pricing a defense at zero.
 *
 * ⚠ RAW `pts_allow` STAYS ON THE LINE, PER GAME, UNSCALED. It is not a Sleeper scoring stat (the
 * bracket frequencies carry it), but it is what marks the line as a defense for
 * `computeLeagueProjectedPoints` — an ESPN league whose D/ST rule could not be translated is refused
 * rather than under-priced — and what an ESPN `pts_allow_range_*` rule buckets.
 */
export function teamDefenseWeekLine(rate: SpecialistRate | undefined, weekGames: number | null | undefined): Record<string, number> | null {
  if (rate?.kind !== 'DEF' || weekGames == null || !(weekGames > 0)) return null
  const line: Record<string, number> = {}
  for (const [stat, perGame] of Object.entries(rate.perGame)) line[stat] = stat === 'pts_allow' ? perGame : perGame * weekGames
  return line
}
