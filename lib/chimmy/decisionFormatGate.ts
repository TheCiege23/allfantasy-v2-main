import { leagueForbidsTrades, tradeBanReason } from '@/lib/league-rules/tradeLegality'
import type { ChimmyDecisionKind } from './decisionAnswerContract'

/**
 * Decisions a league's FORMAT rules out, before any engine runs.
 *
 * An engine asked about a move the league cannot make still computes one: the start/sit
 * builder ranks two players whether or not anyone sets a lineup, and the trade grader prices a
 * deal in a league with no trade market. The result looks like any other ready answer, and the
 * chat route charges for it. Measured 2026-09-28 by `__tests__/chimmy-eval/decision.test.ts`:
 * a best-ball "who should I start" and a no-trade-format trade were both READY and CHARGED.
 *
 * Pure. Takes fields the membership-proven snapshot already carries, so no second read has to
 * repeat the authorization.
 *
 * ⚠ BEST BALL IS THE COLUMN, NOT THE FORMAT. In production `leagueType` never says best ball: all
 * 61 `bestBallMode` leagues read `redraft` or `dynasty` (2026-09-28). `resolveNormalizedLeagueContext`
 * reads the same column, which is what the model path's "no start/sit move" evidence
 * (`lineupActionEvidence`) is built on.
 *
 * ⚠ ONLY THE LINEUP IS GATED FOR BEST BALL. The model path records that a best-ball import's
 * waiver, trade and substitution permissions are UNVERIFIED, and the catalog's own best-ball trade
 * entry only says "typically draft-and-hold". Refusing trades there would claim what no evidence
 * supports, so that one catalog entry is deliberately not honoured for trades.
 *
 * 🛑 "NO TRADES" COMES FROM THE CONCEPT CATALOG, NOT FROM "IS IT A GUILLOTINE". The first version
 * of this gate copied the Player Finder's test (`concept === 'guillotine' || concept === 'survivor'`,
 * `lib/core-app/playerTradeVisual.ts`) and refused trades in every guillotine and survivor league.
 * The catalog (`lib/league-rules/conceptCatalog.ts`), the per-format rules authority, says trading
 * is LEGAL in both: `lib/trade-intel/guillotine.ts` prices trades by weeks left, and survivor's
 * entry recommends tribemate deals. Only Survivor All-Stars Guillotine ("no trades at all") and
 * Tournament forbid them. The finder's test cannot tell those apart, because `readFormatRules`
 * maps `survivor_guillotine` onto its `guillotine` chassis. `resolveLeagueRules` keeps the
 * confirmed concept, so it can. It was caught before merge, by a cross-check against the catalog.
 */
export type DecisionFormatInput = {
  leagueType: string | null
  isDynasty: boolean
  settings: unknown
  bestBallMode: boolean | null
}

export type DecisionFormatBlock = {
  code: 'best_ball_auto_lineup' | 'trades_not_allowed'
  detail: string
  remedy: string
}

/*
 * The trade rule lives in `lib/league-rules/tradeLegality.ts`, shared with the Player Finder so the two
 * surfaces cannot disagree about whether a league trades. Re-exported for this module's callers.
 */
export { leagueForbidsTrades, tradeBanReason }

export function decisionFormatBlock(league: DecisionFormatInput, kind: ChimmyDecisionKind): DecisionFormatBlock | null {
  if (kind === 'lineup' && league.bestBallMode === true) {
    return {
      code: 'best_ball_auto_lineup',
      detail: 'This is a Best Ball league: your highest-scoring players count automatically each week, so there is no start/sit or lineup move to make.',
      remedy: 'Ask about roster depth, waivers or trades instead. This answer is not charged.',
    }
  }
  const banned = kind === 'trade' ? tradeBanReason(league) : null
  if (banned) {
    return {
      code: 'trades_not_allowed',
      detail: `This league's format does not allow trades. ${banned}`,
      remedy: 'No trade verdict was computed, and this answer is not charged.',
    }
  }
  return null
}
