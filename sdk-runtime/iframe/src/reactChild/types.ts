/**
 * Decision OS — Phase 7.15 Iframe Child React Renderer Bridge types.
 *
 * The ONE sanctioned exception to "adapters never depend on other adapters"
 * (PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md decision D2): this subfolder
 * exists specifically to compose `sdk-runtime/react` (Phase 7.8) and
 * `sdk-runtime/iframe` (Phase 7.9-7.14) for the one real scenario that needs
 * both — a widget rendering INSIDE an embedded iframe. Neither adapter
 * itself is modified to know about the other; this is a separate,
 * deliberately isolated composition layer with its own scoped tsconfig
 * (DOM + React JSX enabled) and its own import-boundary test.
 *
 * Auth/tenant config here is supplied by the CALLER up front — NEVER
 * derived from the URL handshake (Phase 7.14) or any postMessage, which
 * deliberately carry no credential-shaped fields at all. A real widget
 * bootstrap script gets its session credential from some separate channel
 * (e.g. a cookie, or a path segment outside the `af_*` handshake params) —
 * that mechanism is out of scope here, same as it has been since Phase 7.11.
 */

import type { SDKAuth, SDKTheme } from '../../../../lib/decision-os/sdk/types'
import type { WidgetTenantConfig } from '../../../../lib/decision-os/presentation/widget-contracts'
import type { RuntimeClock, RuntimeFetch, RefreshStrategyOverrides } from '../../../core/src/index'
import type { BrowserWindowSource } from '../browser/windowBridge'
import type { MessageRejectionReason } from '../messageListener'
import type { MessageEventLike } from '../windowLike'

export interface ReactIframeChildBridgeConfig {
  /** Fetch credential — never derived from the handshake. */
  auth: SDKAuth
  /** Widget deployment/tenant contract (Phase 7.3) — apiKey here is structurally distinct from `auth.credential`; see Phase 7.8's documented overlap note. */
  tenantConfig: WidgetTenantConfig
  baseUrl: string
  fetchImpl: RuntimeFetch
  clock: RuntimeClock
  refreshStrategyOverrides?: RefreshStrategyOverrides

  /** Where the React tree mounts. */
  container: HTMLElement

  /** Handshake config — passed straight through to createAllFantasyWidgetIframeClientFromUrl (Phase 7.14). */
  locationSearch?: string
  ownWindow?: BrowserWindowSource
  parentWindow?: BrowserWindowSource
  generateTimestamp?: () => string

  /** Advanced/debugging hook — fires when an inbound message fails origin/schema/widgetId/nonce validation. */
  onProtocolRejection?: (reason: MessageRejectionReason, event: MessageEventLike) => void
  /** Fires after the parent's 'dispose' message has already torn everything down (both the protocol client and the React tree). */
  onDisposed?: () => void
}

export interface MountedReactIframeChildBridge {
  /** Unmounts the React tree and disposes the protocol client. Idempotent. */
  unmount: () => void
}
