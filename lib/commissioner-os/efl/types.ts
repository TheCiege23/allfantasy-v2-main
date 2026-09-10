/**
 * EFL Promotion/Relegation Dynasty — the domain vocabulary.
 *
 * 🛑 TIER 1 IS THE HIGHEST TIER, AND EVERY MODULE HERE DEPENDS ON IT.
 * `LeagueDivision.tierLevel` ascends downward (Premier League = 1, League 2 = 4) and
 * `PromotionEngine` reads `fromTierLevel` as the division being relegated FROM. Getting the
 * orientation backwards relegates the champions and promotes the bottom of the table, and nothing
 * in the type system stops it — so it is stated here, asserted in the tests, and re-stated at every
 * comparison that could be read either way.
 *
 * ⚠ THIS IS A TEMPLATE-LEVEL COMPETITION POLICY, NOT A CHANGE TO THE GENERIC LADDER.
 * `lib/promotion-relegation/` owns standings-zone promotion and relegation and stays exactly as it
 * is. EFL adds playoff-DECIDED movement, which is a property of this competition rather than of
 * ladders in general — the user's 2026-09-10 ruling was explicitly not to turn `PromotionRule` into
 * a generalised playoff DSL on speculation.
 *
 * ⚠ THE RESOLVER EMITS THE EXISTING CANONICAL `SeasonEndTransition`, NOT A PARALLEL TYPE. That is
 * what keeps the output drop-in compatible with the existing application path and stops a second
 * transition vocabulary appearing beside the one `PromotionEngine` already returns.
 */

import type { SeasonEndTransition } from '@/lib/promotion-relegation/types'

export type { SeasonEndTransition }

/** A team's finishing position inside its own tier, from the regular season. */
export type EflTierTeam = {
  teamId: string
  teamName: string
  /** 1-based position WITHIN THE TIER. 1 is the tier winner. */
  rank: number
}

export type EflTierStanding = {
  tierLevel: number
  /** The `LeagueDivision.id` for this tier, so transitions carry real division ids. */
  divisionId: string
  label: string
  teams: readonly EflTierTeam[]
}

/**
 * Which playoff, and in which tier.
 *
 * ⚠ A PLAYOFF IS NAMED BY THE TIER WHOSE TEAMS PLAY IN IT, not by the tier they move to. The
 * League 2 promotion playoff is contested by League 2 teams (tier 4) and its winner moves up to
 * League 1 (tier 3). Naming it by the destination would make slot 9 ("League 2 Promotion Playoff
 * Winner") ambiguous against slot 17 ("League 1 Promotion Playoff Winner").
 */
export type EflPlayoffKind = 'promotion' | 'relegation'

export type EflPlayoffId = {
  kind: EflPlayoffKind
  tierLevel: number
}

/** A playoff that must happen, with the teams in it, before the ladder can settle. */
export type EflPendingPlayoff = EflPlayoffId & {
  divisionId: string
  label: string
  participants: readonly EflTierTeam[]
  /** Why this is still open. */
  reason: string
}

/**
 * A known playoff result.
 *
 * ⚠ BOTH SIDES ARE NAMED. A promotion playoff's WINNER goes up and its LOSER stays; a relegation
 * playoff's LOSER goes down and its WINNER stays. Both ids are required because the rookie draft
 * order references all four outcomes as distinct slots (6, 9, 8, 11 in the League 2 / League 1
 * bands), so recording only the mover would leave four of the thirty-two slots unfillable.
 */
export type EflPlayoffOutcome = EflPlayoffId & {
  winnerTeamId: string
  loserTeamId: string
}

/**
 * The Premier League championship playoff placement.
 *
 * ⚠ SEPARATE FROM PROMOTION AND RELEGATION ON PURPOSE. The top tier has nowhere to be promoted to,
 * so its playoff decides a title and the top five rookie slots (28-32) and nothing else. Folding it
 * into `EflPlayoffOutcome` would give it a winner/loser shape that cannot express fifth place.
 */
export type EflTierPlacement = {
  tierLevel: number
  /** teamIds in finishing order: index 0 is 1st place. */
  placements: readonly string[]
}

/**
 * Commissioner-configurable competition rules.
 *
 * 🛑 CONFIGURABLE, NOT HARDCODED. The user's brief is explicit: commissioners must eventually be
 * able to change these, and "EFL forever" must not be baked into the generic ladder. Every count
 * below is read from this object, never from a literal in the resolver.
 */
export type EflTransitionConfig = {
  autoRelegateCount: number
  relegationPlayoffCount: number
  autoPromoteCount: number
  promotionPlayoffCount: number
  /** Tiers nobody drops out of. EFL: [4], the bottom tier. */
  noRelegationFromTierLevels: readonly number[]
  /** Tiers nobody rises out of. EFL: [1], the top tier. */
  noPromotionFromTierLevels: readonly number[]
}

export const EFL_DEFAULT_TRANSITION_CONFIG: EflTransitionConfig = Object.freeze({
  autoRelegateCount: 1,
  relegationPlayoffCount: 2,
  autoPromoteCount: 1,
  promotionPlayoffCount: 2,
  noRelegationFromTierLevels: Object.freeze([4]),
  noPromotionFromTierLevels: Object.freeze([1]),
})

/**
 * The settled — or not yet settled — season-end plan.
 *
 * 🛑 `finalTransitions` IS `null` WHILE ANYTHING IS PENDING, AND THAT IS THE CORE SAFETY PROPERTY.
 * A partial list is indistinguishable from a complete one once it has been handed to an applier,
 * and applying half a ladder moves some teams and leaves others stranded in a tier that no longer
 * has room. Null forces the caller to look at `pendingPlayoffs` instead of iterating a list that
 * happens to be shorter than it should be.
 */
export type EflSeasonTransitionPlan = {
  leagueId: string
  season: number
  /** Movement decided by the regular season alone. Known as soon as standings are final. */
  automaticTransitions: SeasonEndTransition[]
  /** Playoffs that must be played (or whose result must be recorded) before the ladder settles. */
  pendingPlayoffs: EflPendingPlayoff[]
  /** Movement decided by a playoff whose result IS known. */
  resolvedPlayoffTransitions: SeasonEndTransition[]
  /** Human-readable reasons the plan is not final. Empty when it is. */
  unresolvedReasons: string[]
  /**
   * Contradictions found in the inputs — a team moving both ways, a team moving twice, an outcome
   * naming a team that is not in that playoff.
   *
   * ⚠ A CONFLICT DOES NOT PRODUCE A BEST GUESS. It suppresses `finalTransitions` exactly as a
   * pending playoff does, because a ladder built on contradictory input is worse than no ladder.
   */
  conflicts: string[]
  /** The complete plan, or null while anything is pending or contradictory. */
  finalTransitions: SeasonEndTransition[] | null
}
