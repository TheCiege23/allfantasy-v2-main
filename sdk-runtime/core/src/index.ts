/**
 * Decision OS — Widget Runtime Core.
 *
 * Framework-agnostic HTTP client, auth pre-check, lifecycle controller,
 * error mapper (Phase 7.6), and refresh engine (Phase 7.7). Consumes ONLY
 * the frozen Phase 7.3/7.4 Decision OS contracts (`lib/decision-os/sdk`,
 * `lib/decision-os/presentation`). No DOM, no React, no embed adapter — see
 * PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md and
 * PHASE_7_5_RUNTIME_IMPLEMENTATION_PLAN.md.
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  RuntimeFetchRequestInit,
  RuntimeFetchResponse,
  RuntimeFetch,
  HttpClientConfig,
  PresentationMetaWire,
  PresentationDataWire,
  PresentationEnvelopeWire,
  PresentationFetchSuccess,
  PresentationFetchFailure,
  PresentationFetchResult,
  ExpectedEntity,
  AuthPreCheckSuccess,
  AuthPreCheckFailure,
  AuthPreCheckResult,
  RuntimeTimerHandle,
  RuntimeClock,
} from './types'

// ── HTTP client ───────────────────────────────────────────────────────────────
export { buildQueryString, buildRequestUrl, buildRequestHeaders, fetchPresentation } from './httpClient'

// ── Auth pre-check ────────────────────────────────────────────────────────────
export { authPreCheck } from './authPreCheck'

// ── Lifecycle controller ──────────────────────────────────────────────────────
export { LifecycleController, InvalidLifecycleTransitionError } from './lifecycleController'

// ── Error mapper ──────────────────────────────────────────────────────────────
export type { HttpFailureReason } from './errorMapper'
export { classifyHttpStatus, classifyFailureReason, mapHttpFailureToSDKError } from './errorMapper'

// ── Refresh engine ────────────────────────────────────────────────────────────
export type {
  RefreshAttemptInfo,
  RefreshOutcome,
  RefreshResultListener,
  RefreshStrategyOverrides,
  RefreshEngineDeps,
} from './refreshEngine'
export { RefreshEngine, computeBackoffDelayMs } from './refreshEngine'
