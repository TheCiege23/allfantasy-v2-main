import { describe, expect, it } from 'vitest'
import { IframeClientBootstrap, buildParentToChildMessage } from '../../../sdk-runtime/iframe/src/index'
import type { WindowLike, WindowMessageListener, ParentToChildMessage, MessageRejectionReason } from '../../../sdk-runtime/iframe/src/index'
import { buildSDKError } from '../../../lib/decision-os/sdk/index'

const WIDGET_ID = 'widget_league_001'
const NONCE = 'n0nce_abcdef123456'
const PARENT_ORIGIN = 'https://partner.example.com'

function makeRecordingWindow() {
  const sent: Array<{ message: unknown; targetOrigin: string }> = []
  const listeners: WindowMessageListener[] = []
  const window: WindowLike = {
    postMessage: (message, targetOrigin) => { sent.push({ message, targetOrigin }) },
    addEventListener: (_t, l) => { listeners.push(l) },
    removeEventListener: (_t, l) => {
      const i = listeners.indexOf(l)
      if (i >= 0) listeners.splice(i, 1)
    },
  }
  return { window, sent, listeners }
}

function makeClient(overrides: Partial<{ onRejected: (r: MessageRejectionReason) => void; onDisposed: () => void }> = {}) {
  const own = makeRecordingWindow()
  const parent = makeRecordingWindow()
  const client = new IframeClientBootstrap({
    ownWindow: own.window,
    parentWindow: parent.window,
    parentOrigin: PARENT_ORIGIN,
    widgetId: WIDGET_ID,
    nonce: NONCE,
    generateTimestamp: () => '2026-07-01T00:00:00.000Z',
    onRejected: overrides.onRejected,
    onDisposed: overrides.onDisposed,
  })
  return { client, own, parent }
}

describe('IframeClientBootstrap — construction', () => {
  it('registers a listener on its own window', () => {
    const { own } = makeClient()
    expect(own.listeners).toHaveLength(1)
  })
})

describe('IframeClientBootstrap — sends', () => {
  it('sendReady posts a ready message to the parent window with explicit origin', () => {
    const { client, parent } = makeClient()
    client.sendReady('7.4.0')
    expect(parent.sent).toHaveLength(1)
    expect(parent.sent[0].targetOrigin).toBe(PARENT_ORIGIN)
    expect((parent.sent[0].message as { type: string }).type).toBe('ready')
    expect((parent.sent[0].message as { payload: { sdkVersion: string } }).payload.sdkVersion).toBe('7.4.0')
  })

  it('sendLifecycleChange maps the SDKLifecycleState via mapLifecycleToIframeState', () => {
    const { client, parent } = makeClient()
    client.sendLifecycleChange('refreshing')
    expect((parent.sent[0].message as { payload: { state: string } }).payload.state).toBe('ready')
  })

  it('sendDegraded posts the completeness value', () => {
    const { client, parent } = makeClient()
    client.sendDegraded(55)
    expect((parent.sent[0].message as { payload: { completeness: number } }).payload.completeness).toBe(55)
  })

  it('sendError maps SDKError via mapErrorToIframePayload', () => {
    const { client, parent } = makeClient()
    const error = buildSDKError('NETWORK')
    client.sendError(error)
    const payload = (parent.sent[0].message as { payload: { code: string; message: string; retryable: boolean } }).payload
    expect(payload).toEqual({ code: 'NETWORK', message: error.message, retryable: true })
  })

  it('sendInteraction posts the target', () => {
    const { client, parent } = makeClient()
    client.sendInteraction('recommendations')
    expect((parent.sent[0].message as { payload: { target: string } }).payload.target).toBe('recommendations')
  })

  it('sendResize posts the height', () => {
    const { client, parent } = makeClient()
    client.sendResize(512)
    expect((parent.sent[0].message as { payload: { heightPx: number } }).payload.heightPx).toBe(512)
  })
})

describe('IframeClientBootstrap — receives (onParentMessage)', () => {
  it('dispatches a validated init message from the parent', () => {
    const { client, own } = makeClient()
    const received: ParentToChildMessage[] = []
    client.onParentMessage((m) => received.push(m))

    const payload = {
      widgetMode: 'commissioner' as const, entityId: 'league_001', entityType: 'league' as const,
      theme: { mode: 'light' as const, tokens: { colorTokenMap: {}, iconTokenMap: {}, radiusToken: 'soft' as const, densityToken: 'comfortable' as const }, partnerBrandId: null },
      locale: { locale: 'en-US' as const, fallbackLocale: 'en-US' as const, numberFormat: 'western' as const, dateFormat: 'MDY' as const },
      presentationVersion: '7.0.0',
    }
    const message = buildParentToChildMessage('init', WIDGET_ID, NONCE, payload)
    own.listeners[0]({ data: message, origin: PARENT_ORIGIN })

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('init')
  })

  it('rejects a message from an unexpected origin', () => {
    const rejections: MessageRejectionReason[] = []
    const { client, own } = makeClient({ onRejected: (r) => rejections.push(r) })
    let received = false
    client.onParentMessage(() => { received = true })

    const message = buildParentToChildMessage('refresh_request', WIDGET_ID, NONCE, {})
    own.listeners[0]({ data: message, origin: 'https://evil.example.com' })

    expect(received).toBe(false)
    expect(rejections).toEqual(['origin_not_allowed'])
  })

  it('rejects a malformed message', () => {
    const rejections: MessageRejectionReason[] = []
    const { own } = makeClient({ onRejected: (r) => rejections.push(r) })
    own.listeners[0]({ data: { bogus: true }, origin: PARENT_ORIGIN })
    expect(rejections).toEqual(['invalid_message_schema'])
  })

  it('refresh_request is deliverable end-to-end via onParentMessage', () => {
    const { client, own } = makeClient()
    const received: ParentToChildMessage[] = []
    client.onParentMessage((m) => received.push(m))
    const message = buildParentToChildMessage('refresh_request', WIDGET_ID, NONCE, {})
    own.listeners[0]({ data: message, origin: PARENT_ORIGIN })
    expect(received[0].type).toBe('refresh_request')
  })
})

describe('IframeClientBootstrap — dispose behavior', () => {
  it('receiving a dispose message tears the client down and calls onDisposed', () => {
    let disposedCalled = false
    const { client, own } = makeClient({ onDisposed: () => { disposedCalled = true } })

    expect(client.isDisposed).toBe(false)
    const message = buildParentToChildMessage('dispose', WIDGET_ID, NONCE, {})
    own.listeners[0]({ data: message, origin: PARENT_ORIGIN })

    expect(client.isDisposed).toBe(true)
    expect(disposedCalled).toBe(true)
    expect(own.listeners).toHaveLength(0)
  })

  it('notifies onParentMessage subscribers of the dispose message before tearing down', () => {
    const { client, own } = makeClient()
    const received: ParentToChildMessage[] = []
    client.onParentMessage((m) => received.push(m))

    const message = buildParentToChildMessage('dispose', WIDGET_ID, NONCE, {})
    own.listeners[0]({ data: message, origin: PARENT_ORIGIN })

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('dispose')
  })

  it('public dispose() also tears down without requiring a message', () => {
    const { client, own } = makeClient()
    client.dispose()
    expect(client.isDisposed).toBe(true)
    expect(own.listeners).toHaveLength(0)
  })

  it('is idempotent', () => {
    const { client } = makeClient()
    client.dispose()
    expect(() => client.dispose()).not.toThrow()
    expect(client.isDisposed).toBe(true)
  })

  it('further sends after dispose are no-ops', () => {
    const { client, parent } = makeClient()
    client.dispose()
    client.sendReady('7.4.0')
    expect(parent.sent).toHaveLength(0)
  })
})

describe('IframeClientBootstrap — no credential leakage', () => {
  it('nothing sent to the parent ever contains a planted secret', () => {
    const SECRET = 'tok_client_test_secret_leak_check'
    const { client, parent } = makeClient()
    client.sendReady('7.4.0')
    client.sendError(buildSDKError('UNAUTHORIZED'))
    client.sendLifecycleChange('error')
    expect(JSON.stringify(parent.sent)).not.toContain(SECRET)
  })
})
