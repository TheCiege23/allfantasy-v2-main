/**
 * Decision OS — Phase 7.10 Iframe Bootstrap: validated message listeners.
 *
 * Every inbound message passes through the same four gates, in order:
 *   1. origin allowlist (exact match, never substring — Phase 7.9 origin.ts)
 *   2. protocol schema validation (Phase 7.9 protocol.ts validators)
 *   3. widgetId equality — this listener only accepts messages for the
 *      specific instance it was configured for
 *   4. nonce equality — binds this exchange to one specific handshake,
 *      rejecting a message replayed or spoofed from elsewhere on the page
 *      (PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md §2)
 *
 * A message failing ANY gate is silently dropped from the caller's
 * perspective (no exception thrown into browser event-handling code) but
 * is reported via the optional `onRejected` hook for observability/testing.
 */

import { isOriginAllowed } from './origin'
import { validateChildToParentMessage, validateParentToChildMessage } from './protocol'
import type { ChildToParentMessage, MessageValidationResult, ParentToChildMessage } from './types'
import type { MessageEventLike, WindowMessageListener } from './windowLike'

export type MessageRejectionReason =
  | 'origin_not_allowed'
  | 'invalid_message_schema'
  | 'widget_id_mismatch'
  | 'nonce_mismatch'

export interface MessageListenerConfig<M extends ParentToChildMessage | ChildToParentMessage> {
  expectedOrigin: string
  widgetId: string
  nonce: string
  validate: (raw: unknown) => MessageValidationResult
  onMessage: (message: M) => void
  onRejected?: (reason: MessageRejectionReason, event: MessageEventLike) => void
}

export function createMessageListener<M extends ParentToChildMessage | ChildToParentMessage>(
  config: MessageListenerConfig<M>,
): WindowMessageListener {
  return (event: MessageEventLike) => {
    if (!isOriginAllowed(event.origin, [config.expectedOrigin])) {
      config.onRejected?.('origin_not_allowed', event)
      return
    }

    const result = config.validate(event.data)
    if (!result.valid) {
      config.onRejected?.('invalid_message_schema', event)
      return
    }

    // Justified by the preceding validate() call succeeding — event.data is
    // now known to structurally match the envelope + per-type payload shape.
    const message = event.data as M

    if (message.widgetId !== config.widgetId) {
      config.onRejected?.('widget_id_mismatch', event)
      return
    }
    if (message.nonce !== config.nonce) {
      config.onRejected?.('nonce_mismatch', event)
      return
    }

    config.onMessage(message)
  }
}

/** A parent page's listener for messages FROM its embedded iframe. */
export function createParentWindowListener(config: {
  expectedChildOrigin: string
  widgetId: string
  nonce: string
  onMessage: (message: ChildToParentMessage) => void
  onRejected?: (reason: MessageRejectionReason, event: MessageEventLike) => void
}): WindowMessageListener {
  return createMessageListener<ChildToParentMessage>({
    expectedOrigin: config.expectedChildOrigin,
    widgetId: config.widgetId,
    nonce: config.nonce,
    validate: validateChildToParentMessage,
    onMessage: config.onMessage,
    onRejected: config.onRejected,
  })
}

/** An iframe's listener for messages FROM its embedding parent page. */
export function createChildWindowListener(config: {
  expectedParentOrigin: string
  widgetId: string
  nonce: string
  onMessage: (message: ParentToChildMessage) => void
  onRejected?: (reason: MessageRejectionReason, event: MessageEventLike) => void
}): WindowMessageListener {
  return createMessageListener<ParentToChildMessage>({
    expectedOrigin: config.expectedParentOrigin,
    widgetId: config.widgetId,
    nonce: config.nonce,
    validate: validateParentToChildMessage,
    onMessage: config.onMessage,
    onRejected: config.onRejected,
  })
}
