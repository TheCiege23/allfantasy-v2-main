/**
 * lib/chimmy-actions — barrel export
 * The AllFantasy unified AI Actions and Workflow Bindings system.
 */

// ── Types ──────────────────────────────────────────────────────────────────────
export type {
  AIActionType,
  AIActionSafetyClass,
  AIActionPermission,
  AIActionSurface,
  AIAction,
  AIActionContext,
  AIActionResult,
  AIActionEvent,
  SavedAIRecommendation,
  UnifiedSavedRecommendation,
  SavedRecommendationStatus,
  RecommendationCategory,
  BindingInput,
  AIWorkflowType,
  AIWorkflowPrefill,
} from './AIActionModel'

// ── Registry ───────────────────────────────────────────────────────────────────
export {
  AI_ACTION_REGISTRY,
  getActionMeta,
} from './AIActionRegistry'
export type { ActionMeta } from './AIActionRegistry'

// ── Permission Guard ───────────────────────────────────────────────────────────
export {
  validateAIActionPermissions,
  checkLeagueStateConstraints,
  evaluateAIActionDecision,
  getAIActionClass,
  applyAvailabilityToAction,
} from './AIActionPermissionGuard'
export type {
  PermissionCheckResult,
  AIActionClass,
  AIActionDecisionStatus,
  AIActionDecision,
} from './AIActionPermissionGuard'

// ── Sport Adapter ──────────────────────────────────────────────────────────────
export {
  getActionsForSport,
  isActionValidForSport,
  getSportSpecificPayload,
} from './AIActionSportAdapter'

// ── Binding Service ────────────────────────────────────────────────────────────
export {
  resolveAIActions,
  validateAIActionAvailability,
  bindRecommendationToWorkflow,
  confirmAIActionIfNeeded,
  executeAIAction,
} from './AIActionBindingService'

// ── Logger ─────────────────────────────────────────────────────────────────────
export {
  logAIActionEvent,
  saveAIRecommendation,
  restoreSavedAIRecommendation,
  getSavedRecommendations,
  markRecommendationActedOn,
} from './AIActionLogger'

// ── Analytics & Learning ─────────────────────────────────────────────────────
export {
  trackAIActionEvent,
  trackAIActionShown,
  buildLearningSnapshotFromEvents,
  getDefaultOutcomeAdapters,
} from './AIActionAnalytics'
export type {
  ChimmyLearningSnapshot,
  MeasurableOutcomeAdapter,
  MeasurableOutcomeEvent,
} from './AIActionAnalytics'

// ── Workflow Prefiller ─────────────────────────────────────────────────────────
export {
  getPrefillTarget,
  buildPrefillData,
  buildWorkflowPrefill,
} from './AIActionWorkflowPrefiller'

// ── Execution Validator ───────────────────────────────────────────────────────
export {
  validateActionExecution,
} from './AIActionExecutionValidator'
export type {
  AIActionExecutionValidationResult,
  WorkflowValidationIssue,
} from './AIActionExecutionValidator'

// ── Server Validation ────────────────────────────────────────────────────────
export { validateActionExecutionServerSide } from './AIActionServerValidation'
export type { ServerValidationResult } from './AIActionServerValidation'

// ── Context Bridge ─────────────────────────────────────────────────────────────
export { buildActionContext } from './buildActionContext'

// ── Feed Model ─────────────────────────────────────────────────────────────────
export type { ChimmyFeedRecommendation } from './AIActionModel'
