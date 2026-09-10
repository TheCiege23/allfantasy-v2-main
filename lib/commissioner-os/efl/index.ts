/**
 * EFL Promotion/Relegation Dynasty — template-level competition policy.
 *
 * ⚠ DELIBERATELY NOT EXPORTED FROM `lib/promotion-relegation/index.ts`. That barrel is mocked
 * wholesale by `__tests__/promotion-relegation-routes-contract.test.ts`, and adding exports to it
 * would leave the mock incomplete — the "test double stopped doubling anything" failure, where the
 * suite either dies loudly or, worse, keeps passing against a partial stand-in. EFL imports TYPES
 * from that module and adds nothing to it.
 */

export type {
  EflPendingPlayoff,
  EflPlayoffId,
  EflPlayoffKind,
  EflPlayoffOutcome,
  EflSeasonTransitionPlan,
  EflTierPlacement,
  EflTierStanding,
  EflTierTeam,
  EflTransitionConfig,
  SeasonEndTransition,
} from './types'
export { EFL_DEFAULT_TRANSITION_CONFIG } from './types'

export {
  resolveEflSeasonTransitions,
  resolveEflTierRoles,
  type EflTierRoles,
  type ResolveEflSeasonTransitionsInput,
} from './seasonTransitionResolver'

export {
  applyMaxPfCorrections,
  computeRegularSeasonMaxPf,
  resolveMaxPfFreezeStatus,
  type ComputeMaxPfFreezeInput,
  type ComputeMaxPfFreezeResult,
  type MaxPfCorrection,
  type MaxPfFreezeRow,
  type MaxPfFreezeSnapshot,
  type MaxPfFreezeState,
  type MaxPfFreezeStatus,
  type MaxPfMetric,
  type WeeklyTeamValue,
} from './maxPfFreeze'

export {
  readMaxPfFreezeStatus,
  starterSeatsFromTemplate,
  type MaxPfDataProvenance,
  type ReadMaxPfFreezeResult,
  type ReadMaxPfInput,
} from './maxPfReads'

export {
  computeSeasonMaxPf,
  computeWeeklyMaxPf,
  MAX_PF_COMPUTATION_VERSION,
  type ComputeSeasonMaxPfInput,
  type ComputeSeasonMaxPfResult,
  type WeeklyMaxPfResult,
  type WeeklyMaxPfRow,
  type WeeklyRosterPlayer,
  type WeeklyTeamRoster,
} from './maxPfEngine'

export {
  freezeMaxPf,
  readStoredMaxPfFreeze,
  recordMaxPfCorrection,
  type FreezeKey,
  type FreezeMaxPfResult,
  type RecordCorrectionResult,
  type StoredCorrection,
  type StoredMaxPfFreeze,
} from './freezeStore'

export {
  EFL_ROOKIE_DRAFT_ORDER_V1,
  resolveEflRookieDraftOrder,
  type EflDraftSlot,
  type EflRookieDraftOrderResult,
  type EflSlotRule,
  type ResolveEflRookieDraftOrderInput,
} from './rookieDraftOrder'

export {
  applyEflSeasonTransitions,
  type ApplyEflSeasonTransitionsInput,
  type ApplyEflSeasonTransitionsResult,
} from './applyEflSeasonTransitions'
