/**
 * Decision OS — Phase 7.15 Iframe Child React Renderer Bridge.
 *
 * Composes `sdk-runtime/react` (Phase 7.8) and `sdk-runtime/iframe`
 * (Phase 7.9-7.14) — the one sanctioned exception to "adapters never depend
 * on other adapters" (see types.ts for the full rationale). A SEPARATE
 * barrel — not re-exported from the main `sdk-runtime/iframe/src/index.ts`
 * (no-dom, no-React) nor from `facade/index.ts` (dom, but no React JSX
 * runtime configured).
 */

export type { ReactIframeChildBridgeConfig, MountedReactIframeChildBridge } from './types'
export { mountReactIframeChildBridge } from './IframeChildWidgetBridge'
