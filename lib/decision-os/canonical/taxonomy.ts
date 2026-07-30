/**
 * Decision OS canonical decision TAXONOMY (Phase 3A) — an extensible, controlled vocabulary of decision
 * categories shared across every brain. Adding a category is an additive change here; producers must use a
 * listed category (validation rejects unknown categories) so the surface layer can rely on a closed set.
 *
 * PURE — types + constants only. NFL and NCAAF both use these categories unchanged; nothing here is NFL-only.
 */

/** Commissioner-audience categories (league governance / operations). */
export const COMMISSIONER_CATEGORIES = [
  'league_requires_review',
  'roster_incomplete',
  'lineup_missing',
  'inactive_manager',
  'draft_scheduled',
  'waiver_run_today',
  'trade_pending',
  'high_league_health',
] as const

/** Manager-audience categories (a manager's own team decisions). */
export const MANAGER_CATEGORIES = [
  'manager_lineup_missing',
  'manager_waiver_pending',
  'start_sit',
  'waiver_target',
  'drop_candidate',
  'trade_review',
  'trade_target',
  'roster_risk',
  'matchup_opportunity',
  'injury_attention',
  'bye_week_risk',
  'draft_recommendation',
] as const

/** Portfolio / cross-league foundations. Representable in the contract + fixtures in Phase 3A, but NOT computed
 *  (no Portfolio Resolver, consolidated waivers, Sunday Readiness, exposure, or connected-franchise resolution
 *  in this phase). Present so the envelope + schema are forward-compatible. */
export const PORTFOLIO_CATEGORIES = [
  'cross_league_conflict',
  'player_exposure',
  'duplicate_waiver_target',
  'sunday_readiness',
  'connected_devy_context',
] as const

export const DECISION_CATEGORIES = [
  ...COMMISSIONER_CATEGORIES,
  ...MANAGER_CATEGORIES,
  ...PORTFOLIO_CATEGORIES,
] as const

export type CommissionerCategory = (typeof COMMISSIONER_CATEGORIES)[number]
export type ManagerCategory = (typeof MANAGER_CATEGORIES)[number]
export type PortfolioCategory = (typeof PORTFOLIO_CATEGORIES)[number]
export type DecisionCategory = (typeof DECISION_CATEGORIES)[number]

const CATEGORY_SET: ReadonlySet<string> = new Set(DECISION_CATEGORIES)
const COMMISSIONER_SET: ReadonlySet<string> = new Set(COMMISSIONER_CATEGORIES)
const MANAGER_SET: ReadonlySet<string> = new Set(MANAGER_CATEGORIES)
const PORTFOLIO_SET: ReadonlySet<string> = new Set(PORTFOLIO_CATEGORIES)

export function isDecisionCategory(v: unknown): v is DecisionCategory {
  return typeof v === 'string' && CATEGORY_SET.has(v)
}
export function isCommissionerCategory(v: string): v is CommissionerCategory {
  return COMMISSIONER_SET.has(v)
}
export function isManagerCategory(v: string): v is ManagerCategory {
  return MANAGER_SET.has(v)
}
export function isPortfolioCategory(v: string): v is PortfolioCategory {
  return PORTFOLIO_SET.has(v)
}

/** Natural audience for a category (a `dual_role` decision may still be produced explicitly). Advisory — the
 *  producer sets the actual `audience`; this helps validation catch obvious mismatches. */
export function defaultAudienceForCategory(category: DecisionCategory): 'manager' | 'commissioner' | 'portfolio' {
  if (isCommissionerCategory(category)) return 'commissioner'
  if (isPortfolioCategory(category)) return 'portfolio'
  return 'manager'
}
