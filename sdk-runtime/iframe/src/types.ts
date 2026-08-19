/**
 * Decision OS — Phase 7.9 Widget Runtime Iframe Adapter types.
 *
 * A CONTRACT layer only — types, versioned message schema, and payload
 * shapes for a future iframe embed runtime. No `window.postMessage`, no
 * `window.addEventListener`, no real `<iframe>` element is created here;
 * that is explicit runtime-implementation scope for a later ticket
 * (mirroring how Phase 7.3/7.4 were contract-only before Phase 7.6+
 * implemented the core runtime). This module is fully deterministic and
 * independently testable without a browser.
 *
 * Import boundary (enforced by __tests__/sdk-runtime/iframe/import-boundary.test.ts):
 *   allowed  — local modules, lib/decision-os/sdk, lib/decision-os/presentation
 *   forbidden — lib/decision-os/behavioral/*, lib/decision-os/world/*, Prisma,
 *               sdk-runtime/react (adapters never depend on other adapters —
 *               PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md decision D2)
 *
 * Security posture (PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md §2 — iframe):
 *   - `SDKAuth.credential` NEVER appears in any message payload — the iframe
 *     authenticates via its own `src` URL (a short-lived signed_embed_token),
 *     never via postMessage.
 *   - Every message carries an explicit `nonce` binding it to one widget
 *     instance, preventing a message spoofed by another script on the host
 *     page from being accepted as if it came from this widget's iframe.
 *   - The schema is versioned (`IFRAME_PROTOCOL_VERSION`) independently of
 *     SDK_VERSION/PRESENTATION_VERSION/WIDGET_CONTRACT_VERSION — the wire
 *     protocol between two windows can evolve on its own cadence.
 */

import type {
  SDKConfig,
  SDKError,
  SDKErrorCode,
  SDKLifecycleState,
  SDKLocale,
  SDKTheme,
} from '../../../lib/decision-os/sdk/types'
import type { WidgetMode } from '../../../lib/decision-os/presentation/widget-contracts'

// ── Protocol version ────────────────────────────────────────────────────────────

export const IFRAME_PROTOCOL_VERSION = '1.0.0' as const

// ── Iframe embed config ───────────────────────────────────────────────────────

/**
 * Config for one iframe-embedded widget instance. Wraps the frozen Phase 7.4
 * `SDKConfig` (which already carries auth/theme/locale/hostOrigin/embedTarget)
 * and adds the ONE field specific to the iframe target: where AllFantasy's
 * own iframe content is served from — needed for CSP `frame-ancestors` and
 * postMessage origin checks, which no other embed target needs to know.
 */
export interface IframeEmbedConfig {
  sdkConfig: SDKConfig
  /** The origin AllFantasy serves the iframe's own content from, e.g. 'https://widgets.allfantasy.app'. */
  iframeOrigin: string
  /**
   * Explicit allowlist of partner origins permitted to embed this widget
   * instance. `sdkConfig.hostOrigin` must be a member of this list.
   * SDKConfig (Phase 7.4, frozen) has no allowlist field of its own — this
   * is the iframe adapter's own authoritative list, never derived.
   */
  allowedOrigins: readonly string[]
}

// ── Message envelope ──────────────────────────────────────────────────────────

export type MessageDirection = 'parent_to_child' | 'child_to_parent'

interface MessageEnvelopeBase {
  protocolVersion: string
  /** Binds this message exchange to one specific widget instance. */
  nonce: string
  widgetId: string
  timestamp: string
}

// ── Parent → Child (host page → iframe) ───────────────────────────────────────

export type ParentToChildMessageType =
  | 'init'
  | 'refresh_request'
  | 'visibility_change'
  | 'theme_update'
  | 'dispose'

/**
 * The INIT payload deliberately excludes `auth` and `tenantId` entirely —
 * the iframe authenticates via its own `src` URL, never via postMessage.
 */
export interface IframeInitPayload {
  widgetMode: WidgetMode
  entityId: string
  entityType: 'manager' | 'league' | 'platform' | 'company'
  theme: SDKTheme
  locale: SDKLocale
  presentationVersion: string
}

export interface IframeVisibilityChangePayload {
  visible: boolean
}

export interface IframeThemeUpdatePayload {
  theme: SDKTheme
}

export type IframeRefreshRequestPayload = Record<string, never>
export type IframeDisposePayload = Record<string, never>

export type ParentToChildPayloadMap = {
  init: IframeInitPayload
  refresh_request: IframeRefreshRequestPayload
  visibility_change: IframeVisibilityChangePayload
  theme_update: IframeThemeUpdatePayload
  dispose: IframeDisposePayload
}

/**
 * A genuine discriminated union (not a generic interface with a default type
 * param) — built by distributing over ParentToChildMessageType so that
 * narrowing on `.type` in a switch/if correctly narrows `.payload` too. Use
 * `Extract<ParentToChildMessage, { type: 'init' }>` to select one variant.
 */
export type ParentToChildMessage = {
  [K in ParentToChildMessageType]: MessageEnvelopeBase & {
    direction: 'parent_to_child'
    type: K
    payload: ParentToChildPayloadMap[K]
  }
}[ParentToChildMessageType]

// ── Child → Parent (iframe → host page) ───────────────────────────────────────

export type ChildToParentMessageType =
  | 'ready'
  | 'lifecycle_change'
  | 'degraded'
  | 'error'
  | 'interaction'
  | 'resize'

/** Collapsed lifecycle state for cross-frame messaging — own local type, not imported from sdk-runtime/react (D2: adapters never depend on other adapters). */
export type IframeLifecycleState = 'loading' | 'ready' | 'error' | 'offline' | 'rate_limited' | 'disposed'

export interface IframeReadyPayload {
  sdkVersion: string
}

export interface IframeLifecycleChangePayload {
  state: IframeLifecycleState
}

export interface IframeDegradedPayload {
  completeness: number
}

/** Sanitized subset of SDKError — safe to cross the frame boundary as-is (Phase 7.4 already guarantees no credential/internal terminology in these fields). */
export interface IframeErrorPayload {
  code: SDKErrorCode
  message: string
  retryable: boolean
}

export interface IframeInteractionPayload {
  target: string
}

export interface IframeResizePayload {
  heightPx: number
}

export type ChildToParentPayloadMap = {
  ready: IframeReadyPayload
  lifecycle_change: IframeLifecycleChangePayload
  degraded: IframeDegradedPayload
  error: IframeErrorPayload
  interaction: IframeInteractionPayload
  resize: IframeResizePayload
}

/**
 * A genuine discriminated union (not a generic interface with a default type
 * param) — built by distributing over ChildToParentMessageType so that
 * narrowing on `.type` in a switch/if correctly narrows `.payload` too. Use
 * `Extract<ChildToParentMessage, { type: 'ready' }>` to select one variant.
 */
export type ChildToParentMessage = {
  [K in ChildToParentMessageType]: MessageEnvelopeBase & {
    direction: 'child_to_parent'
    type: K
    payload: ChildToParentPayloadMap[K]
  }
}[ChildToParentMessageType]

export type IframeMessage = ParentToChildMessage | ChildToParentMessage

// ── Validation result ─────────────────────────────────────────────────────────

export interface MessageValidationResult {
  valid: boolean
  errors: string[]
}

// ── Re-exports for adapter consumers ──────────────────────────────────────────

export type { SDKError, SDKErrorCode, SDKLifecycleState }
