/**
 * Decision OS — Phase 7.8 Widget Runtime React Adapter.
 *
 * Renders IPM presentation models (Phase 7.0/7.2) fetched through the
 * sdk-runtime core (Phase 7.6/7.7). Computes nothing — no scores, no
 * severities, no colors are derived here.
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  WidgetPresentationData,
  WidgetRenderState,
  UseAllFantasyWidgetOptions,
  UseAllFantasyWidgetResult,
} from './types'

// ── Lifecycle mapping ─────────────────────────────────────────────────────────
export { mapLifecycleToRenderState } from './lifecycleMapping'

// ── Initial load ──────────────────────────────────────────────────────────────
export type { InitialLoadDeps, InitialLoadResult } from './initialLoad'
export { runInitialLoad } from './initialLoad'

// ── Presentation helpers ──────────────────────────────────────────────────────
export type { WidgetHeadline } from './presentationHelpers'
export { extractHeadline } from './presentationHelpers'

// ── Theme tokens ──────────────────────────────────────────────────────────────
export {
  DEFAULT_COLOR_HEX,
  DEFAULT_COLOR_HEX_DARK,
  DEFAULT_COLOR_HEX_LIGHT,
  resolveColorTokenHex,
  resolveThemedColorTokenHex,
  resolveWidgetChromeHex,
} from './tokens'
export type { WidgetChromeHex } from './tokens'

// ── Hook ──────────────────────────────────────────────────────────────────────
export { useAllFantasyWidget } from './useAllFantasyWidget'

// ── Components ────────────────────────────────────────────────────────────────
export { WidgetRenderBoundary } from './WidgetRenderBoundary'
export type { WidgetRenderBoundaryProps } from './WidgetRenderBoundary'
export { AllFantasyWidget } from './AllFantasyWidget'
export type { AllFantasyWidgetProps } from './AllFantasyWidget'
