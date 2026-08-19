/**
 * Decision OS — Phase 7.12 Widget Host Facade types.
 *
 * The single public entrypoint a partner host page uses to mount an
 * AllFantasy widget — hides the Phase 7.9 protocol envelope, the Phase 7.10
 * bootstrap classes, and the Phase 7.11 browser bridging behind a small
 * config object and a handful of typed callbacks. A host page never sees a
 * `ChildToParentMessage`, a nonce, or a `WindowLike`.
 */

import type { SDKConfig, SDKTheme } from '../../../../lib/decision-os/sdk/types'
import type { IframeErrorPayload, IframeLifecycleState } from '../types'
import type { DocumentSource } from '../browser/mount'
import type { BrowserWindowSource } from '../browser/windowBridge'
import type { RandomSource } from '../browser/nonce'
import type { MessageRejectionReason } from '../messageListener'
import type { MessageEventLike } from '../windowLike'

export interface AllFantasyWidgetHostCallbacks {
  onReady?: (info: { sdkVersion: string }) => void
  onLifecycleChange?: (state: IframeLifecycleState) => void
  onDegraded?: (completeness: number) => void
  onError?: (error: IframeErrorPayload) => void
  onInteraction?: (target: string) => void
  onResize?: (heightPx: number) => void
  /** Advanced/debugging hook — fires when an inbound message fails origin/schema/widgetId/nonce validation. */
  onProtocolRejection?: (reason: MessageRejectionReason, event: MessageEventLike) => void
}

export interface AllFantasyWidgetHostConfig extends AllFantasyWidgetHostCallbacks {
  /** Widget deployment + auth contract (Phase 7.4). `sdkConfig.embedTarget` must be 'iframe'. */
  sdkConfig: SDKConfig
  /** The origin AllFantasy serves the iframe's own content from. */
  iframeOrigin: string
  /** Explicit allowlist of partner origins permitted to embed this widget instance. */
  allowedOrigins: readonly string[]
  /**
   * The iframe content's own base URL, WITHOUT the handshake query params —
   * its origin must exactly equal `iframeOrigin`. Never carries a raw API
   * key; a short-lived signed token, if needed, is the caller's concern
   * when building this URL. `mount()` appends the widgetId/nonce/parentOrigin
   * handshake params (Phase 7.14, `buildIframeWidgetUrl`) on top of this.
   */
  baseSrc: string
  /** Injectable for tests; defaults to the real global `document`. */
  document?: DocumentSource
  /** Injectable for tests; defaults to the real global `window`. */
  parentWindow?: BrowserWindowSource
  /** Injectable for deterministic tests; defaults to the real global `crypto`. */
  randomSource?: RandomSource
  generateTimestamp?: () => string
}

export interface AllFantasyWidgetHost {
  readonly isMounted: boolean
  /** Creates the iframe, appends it to `container`, and wires the protocol handshake. Throws if already mounted. */
  mount(container: Pick<HTMLElement, 'appendChild'>): void
  /** Disposes the host (sending a final teardown message) and removes the iframe element. Idempotent — safe to call when not mounted. */
  unmount(): void
  sendRefreshRequest(): void
  sendVisibilityChange(visible: boolean): void
  sendThemeUpdate(theme: SDKTheme): void
}
