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
  BindingInput,
  AIWorkflowType,
  AIWorkflowPrefill,
} from './AIActionModel'

// ── Registry ───────────────────────────────────────────────────────────────────
export {
  AI_ACTION_REGISTRY,
  getActionMeta,
} from './AIActionRegistry'

// ── Permission Guard ───────────────────────────────────────────────────────────
export {
  evaluateAIActionDecision,
  getAIActionClass,
  applyAvailabilityToAction,
} from './AIActionPermissionGuard'

// ── Sport Adapter ──────────────────────────────────────────────────────────────
export {
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

// ── Feed Model ─────────────────────────────────────────────────────────────────
export type { ChimmyFeedRecommendation } from './AIActionModel'
