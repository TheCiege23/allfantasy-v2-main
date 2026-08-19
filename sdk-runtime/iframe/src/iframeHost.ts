/**
 * Decision OS — Phase 7.10 Iframe Bootstrap: host (parent-side).
 *
 * The parent page's controller for ONE embedded widget iframe. Sends
 * init/refresh_request/visibility_change/theme_update/dispose; listens for
 * ready/lifecycle_change/degraded/error/interaction/resize — rejecting
 * anything that fails origin/schema/widgetId/nonce validation
 * (messageListener.ts). Every send goes through `safePostMessage`, which
 * can never be called with a wildcard target origin.
 */

import { createParentWindowListener } from './messageListener'
import { safePostMessage } from './postMessageSafety'
import { buildParentToChildMessage } from './protocol'
import type {
  ChildToParentMessage,
  IframeInitPayload,
  ParentToChildMessageType,
  ParentToChildPayloadMap,
} from './types'
import type { SDKTheme } from '../../../lib/decision-os/sdk/types'
import type { MessageRejectionReason } from './messageListener'
import type { MessageEventLike, WindowLike, WindowMessageListener } from './windowLike'

export interface IframeHostDeps {
  /** The host page's own window — the host listens on this for messages FROM the child. */
  parentWindow: WindowLike
  /** The embedded iframe's contentWindow — the host sends TO this. */
  childWindow: WindowLike
  /** Expected origin of the iframe's own content. */
  childOrigin: string
  widgetId: string
  nonce: string
  /** Injected for deterministic tests; defaults to `new Date().toISOString()`. */
  generateTimestamp?: () => string
  onRejected?: (reason: MessageRejectionReason, event: MessageEventLike) => void
}

export class IframeHostBootstrap {
  private readonly deps: IframeHostDeps
  private disposed = false
  private readonly listener: WindowMessageListener
  private readonly childMessageListeners = new Set<(message: ChildToParentMessage) => void>()

  constructor(deps: IframeHostDeps) {
    this.deps = deps
    this.listener = createParentWindowListener({
      expectedChildOrigin: deps.childOrigin,
      widgetId: deps.widgetId,
      nonce: deps.nonce,
      onMessage: (message) => this.dispatch(message),
      onRejected: deps.onRejected,
    })
    this.deps.parentWindow.addEventListener('message', this.listener)
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  /** Subscribes to validated messages received from the child. Returns an unsubscribe function. */
  onChildMessage(listener: (message: ChildToParentMessage) => void): () => void {
    this.childMessageListeners.add(listener)
    return () => this.childMessageListeners.delete(listener)
  }

  private dispatch(message: ChildToParentMessage): void {
    for (const listener of this.childMessageListeners) listener(message)
  }

  sendInit(payload: IframeInitPayload): void {
    this.send('init', payload)
  }

  sendRefreshRequest(): void {
    this.send('refresh_request', {})
  }

  sendVisibilityChange(visible: boolean): void {
    this.send('visibility_change', { visible })
  }

  sendThemeUpdate(theme: SDKTheme): void {
    this.send('theme_update', { theme })
  }

  private sendDispose(): void {
    this.send('dispose', {})
  }

  private send<T extends ParentToChildMessageType>(type: T, payload: ParentToChildPayloadMap[T]): void {
    if (this.disposed) return
    const message = buildParentToChildMessage(type, this.deps.widgetId, this.deps.nonce, payload, {
      timestamp: this.now(),
    })
    safePostMessage(this.deps.childWindow, message, this.deps.childOrigin)
  }

  private now(): string {
    return this.deps.generateTimestamp ? this.deps.generateTimestamp() : new Date().toISOString()
  }

  /** Notifies the child to tear down, then stops listening. Idempotent. */
  dispose(): void {
    if (this.disposed) return
    this.sendDispose()
    this.disposed = true
    this.deps.parentWindow.removeEventListener('message', this.listener)
    this.childMessageListeners.clear()
  }
}
