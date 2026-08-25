/**
 * IDP stat-line projection — shared types.
 *
 * WHY THIS MODULE EXISTS. `computeLeagueProjectedPoints` already prices a component line
 * under a league's own rules, and four surfaces already call it. For a defender it has
 * nothing to price: the vendor feed is Sleeper's standard-PPR line, which contains no
 * defensive scoring at all, so a linebacker arrives with an empty defensive component line
 * and correctly renders as an em dash (see `hasIdpScoring` in lib/core-app/scoringNotes.ts).
 *
 * This module produces the missing INPUT — a projected per-game defensive stat line in the
 * same vocabulary the scoring path already understands — and nothing downstream changes.
 *
 * PURE. No prisma, no fetch, no clock. Every input is passed in. The failure this guards
 * against (a confident number with nothing behind it) is a logic failure, not an I/O one,
 * so it must be testable without a database.
 */

/**
 * Output vocabulary.
 *
 * ⚠ THESE KEY NAMES ARE LOAD-BEARING AND ARE NOT FREELY CHOSEN. They are the keys
 * `STAT_ALIASES` in lib/projections/leagueScoring.ts resolves a league's `scoring_settings`
 * to. A league configures bare `sack`; Sleeper projects `idp_sack`; the alias map bridges
 * them. Emitting a plausible-looking variant instead (`idp_fr`, `idp_td`) produces a stat
 * line that every scoring key silently fails to match — the projection then reads as a
 * confident zero contribution rather than as an error.
 */
export type IdpStatKey =
  | 'idp_tkl_solo'
  | 'idp_tkl_ast'
  | 'idp_sack'
  | 'idp_int'
  | 'idp_pass_def'
  | 'idp_ff'
  | 'idp_fum_rec'
  | 'idp_tkl_loss'
  | 'idp_qb_hit'
  | 'idp_def_td'
  | 'idp_safe'

/** A projected per-game defensive stat line, keyed for the league scoring path. */
export type IdpStatLine = Partial<Record<IdpStatKey, number>>

/** One observed game, as stored in `PlayerGameStat.normalizedStatMap`. */
export interface IdpGameObservation {
  season: number
  week: number
  /** Defense's opponent that week — the offense whose pace drove snap volume. */
  opponent: string | null
  statMap: Record<string, unknown>
}

/**
 * Opponent offensive pace for the week being projected.
 *
 * Pace is an OFFENSIVE property being used as a DEFENSIVE volume signal: a defense facing a
 * fast, pass-happy offense is on the field for more snaps, and tackle counts follow snaps.
 * `leagueMeanSecPerPlay` is the normaliser and must come from the same season — pace drifts
 * league-wide year to year, so a fixed constant would encode one season's tempo forever.
 */
export interface OpponentPace {
  secPerPlay: number
  leagueMeanSecPerPlay: number
}

/**
 * Population means for the player's position group, used to regress low-frequency events.
 *
 * ⚠ SUPPLIED, NEVER HARDCODED. A sack rate baked in as a constant is an invented number
 * wearing a decimal point. These are computed from the same cohort the projection is drawn
 * from (see `deriveCohortPriors`), so they describe this data rather than a remembered one.
 * When absent, no regression is applied and the projection says so.
 */
export interface CohortPriors {
  position: string
  /** Per-game means across the cohort, in the output vocabulary. */
  perGame: IdpStatLine
  /** How many player-games the priors were computed from. Reported, never assumed adequate. */
  sampleGames: number
}

export type IdpConfidenceLevel = 'high' | 'medium' | 'low'

export interface IdpProjectionCoverage {
  /** Games actually used from the supplied history. */
  gamesUsed: number
  /**
   * Games carrying BOTH `def_snp` and `tm_def_snp`, so a snap share could be computed.
   *
   * Reported because it decides which basis volume was projected on, and the two are not
   * equally trustworthy. Measured on production: `def_snp` is present on 58% of defender
   * game rows and `tm_def_snp` on 70%, so a player legitimately has neither.
   */
  gamesWithSnaps: number
  /** Projected defensive snaps per game. Null when no game carried a snap count. */
  projectedSnaps: number | null
  /** Projected share of his team's defensive snaps, 0..1. Null when unknown. */
  projectedSnapShare: number | null
  /** Distinct components with a non-zero observation. */
  componentsObserved: number
  hasDepthRole: boolean
  hasOpponentPace: boolean
  /** True when priors were supplied and low-frequency regression ran. */
  regressionApplied: boolean
}

/**
 * A refusal is an outcome, not an error.
 *
 * The handoff's rule, and the one this module is built around: a confident wrong number is
 * worse than a labelled absence.
 */
export interface IdpProjectionRefusal {
  ok: false
  reason: 'not_idp_position' | 'no_history' | 'insufficient_sample' | 'no_defensive_production'
  detail: string
}

export interface IdpProjectionSuccess {
  ok: true
  /** The projected per-game line, ready for `computeLeagueProjectedPoints`. */
  statLine: IdpStatLine
  basis: 'weighted_game_logs'
  confidence: IdpConfidenceLevel
  /** 0..1, derived from real coverage — never a constant. */
  confidenceScore: number
  coverage: IdpProjectionCoverage
  /**
   * True statements about how this number was built, rendered to the reader.
   *
   * Includes which basis volume was projected on. Snap share is the strongest IDP signal
   * there is, and whether it was available for THIS player changes how much the number is
   * worth — so it is stated either way rather than assumed in either direction.
   */
  notes: string[]
}

export type IdpProjectionOutcome = IdpProjectionSuccess | IdpProjectionRefusal
