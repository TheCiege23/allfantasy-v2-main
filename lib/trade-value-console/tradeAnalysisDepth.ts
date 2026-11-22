/**
 * The Trade Center's share of the /core depth paywall (lib/core-app/coreDepthAccess.ts), applied
 * to the `/api/trade-value/analyze` response.
 *
 * FREE — the verdict: the grades, fairness score and labels, confidence, both totals, the priced
 * rows, what we could not see, and the league's own rules (`formatNotes`, which can block the
 * deal) and bye collisions, which are schedule facts.
 *
 * AF PRO, AF COMMISSIONER, AF SUPREME (`af_intelligence`, 2026-11-22) — the breakdown: the market's per-asset
 * moves, the OS's second opinion, the lineup picture, who wins now and long term and why, the value layers, contender and
 * rebuilder reads, warnings, rebalance ideas and counter targets, the negotiation toolkit, the
 * written evaluation and its drivers, and the posture / leverage / need / scale / pick notes.
 *
 * ⚠ THE SAME DEPTH IS COPIED ACROSS SEVERAL FIELDS: `chimmyPayload` carries `tradeIntelligence`
 * again, `opponentRosterTargets` is the counter-target list under another name, and `summaryLine`
 * names both winners. Withholding `tradeIntelligence` alone would have left all three in place.
 *
 * ⚠ A DROP-LIST LEAKS WHATEVER IS ADDED LATER, so every top-level field is classified here, as
 * depth or as verdict, and __tests__/core-depth-paywall.test.ts fails on a response field that is
 * in neither list. A new field has to be put on one side on purpose.
 *
 * ⚠ THE AI WRITE-UP WAS ALREADY GATED (`evaluateAiCostGate`, `skipAi`) — but skipping the model
 * only swaps `evaluation` for the deterministic bullets. Nothing on the depth list costs a model
 * call, which is exactly why the cost gate never covered it.
 */
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'

export const TRADE_DEPTH_FIELDS = [
  'tradeIntelligence',
  'chimmyPayload',
  'opponentRosterTargets',
  'counterOffers',
  'summaryLine',
  'secondary',
  'drivers',
  'evaluation',
  'negotiationToolkit',
  'timeContext',
  'tradeWindow',
  'postureNotes',
  'leverageNotes',
  'needNotes',
  'scaleNotes',
  'pickNotes',
  /*
   * 2026-11-22 (owner: "the extended trade value and trade eval — users get a basic answer but not the
   * full answer, with an upgrade button"). Moved from the free verdict:
   *   tradeMarket   the AllFantasy market's per-asset moves (the "extended trade value")
   *   decisionOs    the OS's own second opinion on the deal
   *   visualImpact  the lineup and depth-chart picture after the deal
   * The letter, the fairness score, both totals and the rules the grade was priced under (`valueBasis`)
   * stay free, so a free grade still names WHAT moved it — the lock says where the detail went.
   */
  'tradeMarket',
  'decisionOs',
  'visualImpact',
] as const

/** Everything else the route returns — free, and read by the Trade Center, the league trades tab and the value modal. */
export const TRADE_VERDICT_FIELDS = [
  'ok',
  'analysisMode',
  'effectiveSport',
  'analysisScope',
  'league',
  'labels',
  'fairnessScore',
  'confidenceScore',
  'percentDiff',
  'giveTotal',
  'getTotal',
  'giveMarket',
  'getMarket',
  /*
   * Part of the VERDICT, not the depth: it names the rules the grade was priced under. A free user
   * who sees a grade move must be able to see why, or the grade is exactly the invisible
   * adjustment `lib/trade-value/leagueTradeValue.ts` exists to prevent.
   */
  'valueBasis',
  'valuationBasis',
  /* The letter itself, and the same free verdict on every surface — see `lib/decision-os/trade/tradeGrade.ts`. */
  'grade',
  'evaluationReceipt',
  'salaryCap',
  'degraded',
  'dataGaps',
  'dataSources',
  'lastUpdated',
  'players',
  'rosterSummary',
  'validation',
  'sourceFlags',
  'dataQuality',
  'formatNotes',
  'byeNotes',
  'aiLimit',
] as const

/**
 * Fields the route adds that carry their OWN paywall, and so pass through this filter untouched:
 * `competitiveEdge` is the `competitive_edge` depth (AF Pro and the War Room plan), computed only
 * for a viewer who has it. A War Room plan holder does not have trade depth, and stripping it here
 * would take away what they paid for.
 */
export const SEPARATELY_GATED_FIELDS = ['competitiveEdge'] as const

export function applyTradeAnalysisDepth<T extends object>(
  body: T,
  access: CoreDepthAccess,
): T & { depth: CoreDepthAccess } {
  if (access.unlocked) return { ...body, depth: access }
  const kept: Record<string, unknown> = { ...(body as Record<string, unknown>) }
  for (const field of TRADE_DEPTH_FIELDS) delete kept[field]
  /*
   * Inside the free letter, the extended value goes too (2026-11-22): the market's per-asset moves and
   * the roster-fit breakdown. The letter, both totals, the priced lines and the basis stay — they ARE
   * the basic answer, and every other surface shows the same letter.
   */
  const grade = kept.grade
  if (grade && typeof grade === 'object' && !Array.isArray(grade)) {
    const { moves: _moves, rosterFit: _rosterFit, ...basic } = grade as Record<string, unknown>
    kept.grade = basic
  }
  return { ...(kept as T), depth: access }
}
