/**
 * Decision OS — Phase 7.10 Iframe Bootstrap: client (child-side).
 *
 * The controller running INSIDE the embedded widget iframe. Sends
 * ready/lifecycle_change/degraded/error/interaction/resize; listens for
 * init/refresh_request/visibility_change/theme_update/dispose — rejecting
 * anything that fails origin/schema/widgetId/nonce validation. Receiving a
 * 'dispose' message from the parent tears the client down automatically,
 * after notifying subscribers.
 */

import { createChildWindowListener } from './messageListener'
import { safePostMessage } from './postMessageSafety'
import { buildChildToParentMessage } from './protocol'
import { mapErrorToIframePayload, mapLifecycleToIframeState } from './lifecycleMapping'
import type {
  ChildToParentMessageType,
  ChildToParentPayloadMap,
  ParentToChildMessage,
} from './types'
import type { SDKError, SDKLifecycleState } from '../../../lib/decision-os/sdk/types'
import type { MessageRejectionReason } from './messageListener'
import type { MessageEventLike, WindowLike, WindowMessageListener } from './windowLike'

export interface IframeClientDeps {
  /** The iframe's own window — the client listens on this for messages FROM the parent. */
  ownWindow: WindowLike
  /** The embedding host page's window (`window.parent`) — the client sends TO this. */
  parentWindow: WindowLike
  /** Expected origin of the embedding host page. */
  parentOrigin: string
  widgetId: string
  nonce: string
  /** Injected for deterministic tests; defaults to `new Date().toISOString()`. */
  generateTimestamp?: () => string
  onRejected?: (reason: MessageRejectionReason, event: MessageEventLike) => void
  /** Called after a validated 'dispose' message is received and the client has torn itself down. */
  onDisposed?: () => void
}

export class IframeClientBootstrap {
  private readonly deps: IframeClientDeps
  private disposed = false
  private readonly listener: WindowMessageListener
  private readonly parentMessageListeners = new Set<(message: ParentToChildMessage) => void>()

  constructor(deps: IframeClientDeps) {
    this.deps = deps
    this.listener = createChildWindowListener({
      expectedParentOrigin: deps.parentOrigin,
      widgetId: deps.widgetId,
      nonce: deps.nonce,
      onMessage: (message) => this.dispatch(message),
      onRejected: deps.onRejected,
    })
    this.deps.ownWindow.addEventListener('message', this.listener)
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  /** Subscribes to validated messages received from the parent. Returns an unsubscribe function. */
  onParentMessage(listener: (message: ParentToChildMessage) => void): () => void {
    this.parentMessageListeners.add(listener)
    return () => this.parentMessageListeners.delete(listener)
  }

  private dispatch(message: ParentToChildMessage): void {
    for (const listener of this.parentMessageListeners) listener(message)
    if (message.type === 'dispose') {
      this.teardown()
      this.deps.onDisposed?.()
    }
  }

  sendReady(sdkVersion: string): void {
    this.send('ready', { sdkVersion })
  }

  sendLifecycleChange(state: SDKLifecycleState): void {
    this.send('lifecycle_change', { state: mapLifecycleToIframeState(state) })
  }

  sendDegraded(completeness: number): void {
    this.send('degraded', { completeness })
  }

  sendError(error: SDKError): void {
    this.send('error', mapErrorToIframePayload(error))
  }

  sendInteraction(target: string): void {
    this.send('interaction', { target })
  }

  sendResize(heightPx: number): void {
    this.send('resize', { heightPx })
  }

  private send<T extends ChildToParentMessageType>(type: T, payload: ChildToParentPayloadMap[T]): void {
    if (this.disposed) return
    const message = buildChildToParentMessage(type, this.deps.widgetId, this.deps.nonce, payload, {
      timestamp: this.now(),
    })
    safePostMessage(this.deps.parentWindow, message, this.deps.parentOrigin)
  }

  private now(): string {
    return this.deps.generateTimestamp ? this.deps.generateTimestamp() : new Date().toISOString()
  }

  private teardown(): void {
    if (this.disposed) return
    this.disposed = true
    this.deps.ownWindow.removeEventListener('message', this.listener)
    this.parentMessageListeners.clear()
  }

  /** Public dispose — for when the client itself decides to tear down, not only on a received 'dispose' message. */
  dispose(): void {
    this.teardown()
  }
}
