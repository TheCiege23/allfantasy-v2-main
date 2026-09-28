import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import type { ChimmyDecisionKind } from './decisionAnswerContract'

/**
 * Decisions a league's FORMAT rules out, before any engine runs.
 *
 * An engine asked about a move the league cannot make still computes one: the start/sit
 * builder ranks two players whether or not anyone sets a lineup, and the trade grader prices a
 * deal in a league with no trade market. The result looks like any other ready answer, and the
 * chat route charges for it. Measured 2026-09-28 by `__tests__/chimmy-eval/decision.test.ts`:
 * a best-ball "who should I start" and a guillotine trade were both READY and CHARGED.
 *
 * Pure. Takes fields the membership-proven snapshot already carries, so no second read has to
 * repeat the authorization.
 *
 * ⚠ BEST BALL IS THE COLUMN, NOT THE FORMAT. `readFormatRules` has no best-ball concept, and in
 * production `leagueType` never says it: all 61 `bestBallMode` leagues read `redraft` or
 * `dynasty` (2026-09-28). `resolveNormalizedLeagueContext` reads the same column, which is what
 * the model path's "no start/sit move" evidence (`lineupActionEvidence`) is built on.
 *
 * ⚠ ONLY THE LINEUP IS GATED FOR BEST BALL. The model path records that a best-ball import's
 * waiver, trade and substitution permissions are UNVERIFIED, so refusing those here would claim
 * something no evidence supports.
 *
 * ⚠ GUILLOTINE IS `readFormatRules`, THE SAME TEST THE PLAYER FINDER USES
 * (`lib/core-app/playerTradeVisual.ts`: `concept === 'guillotine' || concept === 'survivor'`),
 * so Chimmy and the finder cannot disagree about whether a league trades. In production it
 * catches all 17 such leagues from the stored type or the confirmed concept. None relies on
 * the `guillotineMode` column alone.
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

/** True when the league's format has no trade market. */
export function leagueForbidsTrades(league: Pick<DecisionFormatInput, 'leagueType' | 'isDynasty' | 'settings'>): boolean {
  const concept = readFormatRules({ leagueType: league.leagueType, isDynasty: league.isDynasty, settings: league.settings }).concept
  return concept === 'guillotine' || concept === 'survivor'
}

export function decisionFormatBlock(league: DecisionFormatInput, kind: ChimmyDecisionKind): DecisionFormatBlock | null {
  if (kind === 'lineup' && league.bestBallMode === true) {
    return {
      code: 'best_ball_auto_lineup',
      detail: 'This is a Best Ball league: your highest-scoring players count automatically each week, so there is no start/sit or lineup move to make.',
      remedy: 'Ask about roster depth, waivers or trades instead. This answer is not charged.',
    }
  }
  if (kind === 'trade' && leagueForbidsTrades(league)) {
    return {
      code: 'trades_not_allowed',
      detail: 'This league\'s format does not allow trades: in a guillotine or survivor league, players move only through waiver bids on eliminated rosters.',
      remedy: 'Ask what to bid on a player instead. No trade verdict was computed, and this answer is not charged.',
    }
  }
  return null
}
