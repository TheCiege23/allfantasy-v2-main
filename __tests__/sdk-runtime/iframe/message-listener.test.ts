import { describe, expect, it } from 'vitest'
import {
  createParentWindowListener,
  createChildWindowListener,
  buildChildToParentMessage,
  buildParentToChildMessage,
} from '../../../sdk-runtime/iframe/src/index'
import type { ChildToParentMessage, ParentToChildMessage, MessageRejectionReason } from '../../../sdk-runtime/iframe/src/index'

const WIDGET_ID = 'widget_league_001'
const NONCE = 'n0nce_abcdef123456'
const CHILD_ORIGIN = 'https://widgets.allfantasy.app'
const PARENT_ORIGIN = 'https://partner.example.com'

describe('createParentWindowListener — accepts valid child messages', () => {
  it('dispatches a valid ready message', () => {
    const received: ChildToParentMessage[] = []
    const listener = createParentWindowListener({
      expectedChildOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      onMessage: (m) => received.push(m),
    })
    const message = buildChildToParentMessage('ready', WIDGET_ID, NONCE, { sdkVersion: '7.4.0' })
    listener({ data: message, origin: CHILD_ORIGIN })
    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('ready')
  })
})

describe('createParentWindowListener — rejections', () => {
  const message = buildChildToParentMessage('ready', WIDGET_ID, NONCE, { sdkVersion: '7.4.0' })

  it('rejects a message from an unexpected origin', () => {
    const rejections: MessageRejectionReason[] = []
    const listener = createParentWindowListener({
      expectedChildOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      onMessage: () => { throw new Error('should not dispatch') },
      onRejected: (reason) => rejections.push(reason),
    })
    listener({ data: message, origin: 'https://evil.example.com' })
    expect(rejections).toEqual(['origin_not_allowed'])
  })

  it('rejects a malformed message (fails schema validation)', () => {
    const rejections: MessageRejectionReason[] = []
    const listener = createParentWindowListener({
      expectedChildOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      onMessage: () => { throw new Error('should not dispatch') },
      onRejected: (reason) => rejections.push(reason),
    })
    listener({ data: { totally: 'bogus' }, origin: CHILD_ORIGIN })
    expect(rejections).toEqual(['invalid_message_schema'])
  })

  it('rejects a message for a different widgetId', () => {
    const rejections: MessageRejectionReason[] = []
    const listener = createParentWindowListener({
      expectedChildOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      onMessage: () => { throw new Error('should not dispatch') },
      onRejected: (reason) => rejections.push(reason),
    })
    const wrongWidget = buildChildToParentMessage('ready', 'widget_other', NONCE, { sdkVersion: '7.4.0' })
    listener({ data: wrongWidget, origin: CHILD_ORIGIN })
    expect(rejections).toEqual(['widget_id_mismatch'])
  })

  it('rejects a message with a mismatched nonce', () => {
    const rejections: MessageRejectionReason[] = []
    const listener = createParentWindowListener({
      expectedChildOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      onMessage: () => { throw new Error('should not dispatch') },
      onRejected: (reason) => rejections.push(reason),
    })
    const wrongNonce = buildChildToParentMessage('ready', WIDGET_ID, 'different_nonce_val', { sdkVersion: '7.4.0' })
    listener({ data: wrongNonce, origin: CHILD_ORIGIN })
    expect(rejections).toEqual(['nonce_mismatch'])
  })

  it('rejects a plain string payload gracefully (no throw)', () => {
    const listener = createParentWindowListener({
      expectedChildOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      onMessage: () => { throw new Error('should not dispatch') },
    })
    expect(() => listener({ data: 'not an object', origin: CHILD_ORIGIN })).not.toThrow()
  })

  it('never calls onMessage when any gate fails', () => {
    let called = false
    const listener = createParentWindowListener({
      expectedChildOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      onMessage: () => { called = true },
    })
    listener({ data: message, origin: 'https://evil.example.com' })
    expect(called).toBe(false)
  })
})

describe('createChildWindowListener — accepts valid parent messages', () => {
  it('dispatches a valid refresh_request message', () => {
    const received: ParentToChildMessage[] = []
    const listener = createChildWindowListener({
      expectedParentOrigin: PARENT_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      onMessage: (m) => received.push(m),
    })
    const message = buildParentToChildMessage('refresh_request', WIDGET_ID, NONCE, {})
    listener({ data: message, origin: PARENT_ORIGIN })
    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('refresh_request')
  })
})

describe('createChildWindowListener — rejections', () => {
  it('rejects a message from an unexpected origin', () => {
    const rejections: MessageRejectionReason[] = []
    const listener = createChildWindowListener({
      expectedParentOrigin: PARENT_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      onMessage: () => { throw new Error('should not dispatch') },
      onRejected: (reason) => rejections.push(reason),
    })
    const message = buildParentToChildMessage('refresh_request', WIDGET_ID, NONCE, {})
    listener({ data: message, origin: 'https://evil.example.com' })
    expect(rejections).toEqual(['origin_not_allowed'])
  })

  it('rejects a child-to-parent message type sent to the child listener (cross-direction)', () => {
    const rejections: MessageRejectionReason[] = []
    const listener = createChildWindowListener({
      expectedParentOrigin: PARENT_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      onMessage: () => { throw new Error('should not dispatch') },
      onRejected: (reason) => rejections.push(reason),
    })
    const wrongDirection = buildChildToParentMessage('ready', WIDGET_ID, NONCE, { sdkVersion: '7.4.0' })
    listener({ data: wrongDirection, origin: PARENT_ORIGIN })
    expect(rejections).toEqual(['invalid_message_schema'])
  })
})
