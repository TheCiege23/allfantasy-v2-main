/**
 * Sports OS foundation — the shared layer every screen and job is built on.
 *
 * Import from `@/lib/sports-os`. The internal module layout may change; this barrel is the contract,
 * the same convention `lib/events/index.ts` follows.
 *
 * The ten points and where each one lives:
 *
 *  1. Performance budgets ............ ./budgets.ts       + ./budgetTelemetry.ts
 *  2. Render the shell immediately ... app/core/[[...screen]]/page.tsx (`af.shell_ms`) — already built
 *  3. Stream cards independently ..... same page + lib/observability/cardTelemetry.ts — already built
 *  4. Screen-ready summaries ......... ./summaries.ts
 *  5. Layered caching ................ ./layeredCache.ts
 *  6. Heavy work in jobs ............. lib/jobs/ + lib/queues/ — reached from ./reactions.ts
 *  7. One event system ............... lib/events/ — the reaction table is ./reactions.ts
 *  8. End-to-end observability ....... lib/observability/ — budget verdicts from ./budgetTelemetry.ts
 *  9. Last-known data ................ ./freshness.ts
 * 10. Gradual rollout ................ ./rollout.ts
 *
 * See docs/sports-os/FOUNDATION.md for how they compose and what is NOT done yet.
 */

export {
  budgetFor,
  evaluateBudget,
  allBudgets,
  BUDGET_PHASES,
  type Budget,
  type BudgetKey,
  type BudgetPhase,
  type BudgetVerdict,
  type BudgetEvaluation,
} from './budgets'

export { recordBudget, recordBudgetSince, measure } from './budgetTelemetry'

export {
  fresh,
  withSource,
  emptyFreshness,
  ageMs,
  isStale,
  freshnessLabel,
  describeFreshness,
  shouldWarnAboutFreshness,
  freshnessMeta,
  mapFresh,
  combineFreshness,
  type Fresh,
  type FreshnessMeta,
  type FreshnessSource,
  type FreshnessView,
} from './freshness'

export {
  readThrough,
  invalidate,
  invalidatePrefix,
  type DurableCacheTier,
  type LayeredCacheOptions,
} from './layeredCache'

export {
  registerScreenSummary,
  getScreenSummaryDefinition,
  registeredScreens,
  readScreenSummary,
  invalidateScreenSummary,
  invalidateScreen,
  screensInvalidatedBy,
  scopeKey,
  summaryCacheKey,
  summaryKeyPrefix,
  type ScreenSummaryDefinition,
  type SummaryScope,
  type ReadSummaryOptions,
} from './summaries'

export {
  planReactions,
  dispatchReactions,
  reactingEventTypes,
  MAX_JOBS_PER_EVENT,
  type ReactionJob,
  type ReactionPlan,
  type ReactionEnqueue,
  type ReactionInvalidate,
  type DispatchResult,
} from './reactions'

export {
  hash32,
  bucketFor,
  evaluateRollout,
  isEnabled,
  parseRolloutEnv,
  DEFAULT_ROLLOUTS,
  BUCKET_SPACE,
  type RolloutRule,
  type RolloutDecision,
} from './rollout'
