/**
 * Decision OS — Phase 7.17 Widget Runtime JS Embed Adapter.
 *
 * The weakest-isolation embed target: a plain JavaScript factory function,
 * `AllFantasy.createWidget({ container, config, auth, apiKey, baseUrl })`,
 * rendering IPM presentation models (Phase 7.0/7.2) fetched through the
 * sdk-runtime core (Phase 7.6/7.7), reusing the React adapter (Phase 7.8)
 * internally to render. Computes nothing — no scores, no severities, no
 * colors are derived here.
 */

// ── Public factory ────────────────────────────────────────────────────────────
export { createAllFantasyWidget } from './createWidget'

// ── Global namespace ──────────────────────────────────────────────────────────
export { AllFantasy, attachAllFantasyGlobal, SDK_JS_EMBED_VERSION } from './namespace'
export type { AllFantasyGlobalNamespace } from './namespace'

// ── Container validation ──────────────────────────────────────────────────────
export { validateContainer } from './containerValidation'
export type { ContainerValidationResult } from './containerValidation'

// ── Config assembly + validation ──────────────────────────────────────────────
export { buildWidgetConfigWithCredential, validateCreateWidgetInputs } from './config'
export type { ValidateCreateWidgetInputsResult } from './config'

// ── Default runtime deps ──────────────────────────────────────────────────────
export { defaultFetchImpl, defaultClock } from './defaults'

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  JsEmbedTenantConfig,
  JsEmbedWidgetConfig,
  CreateWidgetOptions,
  CreateWidgetLifecycleCallbacks,
  AllFantasyWidgetInstance,
} from './types'
