/**
 * Decision OS — Phase 7.13 Widget Iframe Child Facade types.
 *
 * The single public entrypoint the code running INSIDE an embedded widget
 * iframe uses — mirrors `widgetHost.ts` (Phase 7.12) for the other side of
 * the handshake. Hides `IframeClientBootstrap` (Phase 7.10), the protocol
 * envelope (Phase 7.9), and the browser bridge (Phase 7.11) behind a small
 * config object and typed callbacks. A widget implementer never sees a
 * `ParentToChildMessage`, a nonce, or a `WindowLike`.
 */

import type { SDKError, SDKTheme } from '../../../../lib/decision-os/sdk/types'
import type { IframeInitPayload } from '../types'
import type { BrowserWindowSource } from '../browser/windowBridge'
import type { MessageRejectionReason } from '../messageListener'
import type { MessageEventLike } from '../windowLike'

export interface AllFantasyWidgetIframeClientCallbacks {
  /** Fires when the parent's 'init' message arrives — the widget's actual config to render. */
  onInit?: (payload: IframeInitPayload) => void
  /** Fires when the parent asks this widget to refresh its data. */
  onRefreshRequest?: () => void
  onVisibilityChange?: (visible: boolean) => void
  onThemeUpdate?: (theme: SDKTheme) => void
  /** Fires after a 'dispose' message from the parent has already torn this client down. */
  onDisposed?: () => void
  /** Advanced/debugging hook — fires when an inbound message fails origin/schema/widgetId/nonce validation. */
  onProtocolRejection?: (reason: MessageRejectionReason, event: MessageEventLike) => void
}

export interface AllFantasyWidgetIframeClientConfig extends AllFantasyWidgetIframeClientCallbacks {
  /** Must match the widgetId the host generated for this instance (communicated out of band, e.g. via the iframe's own src URL). */
  widgetId: string
  /** Must match the nonce the host generated for this instance (communicated out of band). */
  nonce: string
  /** The expected origin of the embedding host page. */
  parentOrigin: string
  /** Injectable for tests; defaults to the real global `window`. */
  ownWindow?: BrowserWindowSource
  /** Injectable for tests; defaults to the real global `window.parent`. */
  parentWindow?: BrowserWindowSource
  generateTimestamp?: () => string
}

export interface AllFantasyWidgetIframeClient {
  readonly isDisposed: boolean
  /** Announces this widget is ready to receive 'init' — call once the widget implementer's own setup has completed. */
  sendReady(sdkVersion: string): void
  sendResize(heightPx: number): void
  sendInteraction(target: string): void
  sendError(error: SDKError): void
  /** Tears the client down proactively (not only on a received 'dispose' message). Idempotent. */
  dispose(): void
}
