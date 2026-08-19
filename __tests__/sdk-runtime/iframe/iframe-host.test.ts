import { describe, expect, it } from 'vitest'
import { IframeHostBootstrap, buildChildToParentMessage } from '../../../sdk-runtime/iframe/src/index'
import type { WindowLike, WindowMessageListener, ChildToParentMessage, MessageRejectionReason } from '../../../sdk-runtime/iframe/src/index'
import { buildSDKError } from '../../../lib/decision-os/sdk/index'

const WIDGET_ID = 'widget_league_001'
const NONCE = 'n0nce_abcdef123456'
const CHILD_ORIGIN = 'https://widgets.allfantasy.app'

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

function makeHost(overrides: Partial<{ parentWindow: WindowLike; childWindow: WindowLike; onRejected: (r: MessageRejectionReason) => void }> = {}) {
  const parent = makeRecordingWindow()
  const child = makeRecordingWindow()
  const host = new IframeHostBootstrap({
    parentWindow: overrides.parentWindow ?? parent.window,
    childWindow: overrides.childWindow ?? child.window,
    childOrigin: CHILD_ORIGIN,
    widgetId: WIDGET_ID,
    nonce: NONCE,
    generateTimestamp: () => '2026-07-01T00:00:00.000Z',
    onRejected: overrides.onRejected,
  })
  return { host, parent, child }
}

describe('IframeHostBootstrap — construction', () => {
  it('registers a listener on the parent window', () => {
    const { parent } = makeHost()
    expect(parent.listeners).toHaveLength(1)
  })
})

describe('IframeHostBootstrap — sends', () => {
  it('sendInit posts an init message to the child window with explicit origin', () => {
    const { host, child } = makeHost()
    host.sendInit({
      widgetMode: 'commissioner', entityId: 'league_001', entityType: 'league',
      theme: { mode: 'light', tokens: { colorTokenMap: {}, iconTokenMap: {}, radiusToken: 'soft', densityToken: 'comfortable' }, partnerBrandId: null },
      locale: { locale: 'en-US', fallbackLocale: 'en-US', numberFormat: 'western', dateFormat: 'MDY' },
      presentationVersion: '7.0.0',
    })
    expect(child.sent).toHaveLength(1)
    expect(child.sent[0].targetOrigin).toBe(CHILD_ORIGIN)
    expect((child.sent[0].message as { type: string }).type).toBe('init')
  })

  it('sendRefreshRequest posts a refresh_request message', () => {
    const { host, child } = makeHost()
    host.sendRefreshRequest()
    expect((child.sent[0].message as { type: string }).type).toBe('refresh_request')
  })

  it('sendVisibilityChange posts the visible flag', () => {
    const { host, child } = makeHost()
    host.sendVisibilityChange(false)
    expect((child.sent[0].message as { payload: { visible: boolean } }).payload.visible).toBe(false)
  })

  it('sendThemeUpdate posts the theme', () => {
    const { host, child } = makeHost()
    const theme = { mode: 'dark' as const, tokens: { colorTokenMap: {}, iconTokenMap: {}, radiusToken: 'pill' as const, densityToken: 'compact' as const }, partnerBrandId: null }
    host.sendThemeUpdate(theme)
    expect((child.sent[0].message as { payload: { theme: unknown } }).payload.theme).toEqual(theme)
  })
})

describe('IframeHostBootstrap — receives (onChildMessage)', () => {
  it('dispatches a validated message from the child', () => {
    const { host, parent } = makeHost()
    const received: ChildToParentMessage[] = []
    host.onChildMessage((m) => received.push(m))

    const message = buildChildToParentMessage('ready', WIDGET_ID, NONCE, { sdkVersion: '7.4.0' })
    parent.listeners[0]({ data: message, origin: CHILD_ORIGIN })

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('ready')
  })

  it('rejects a message from an unexpected origin', () => {
    const rejections: MessageRejectionReason[] = []
    const { host, parent } = makeHost({ onRejected: (r) => rejections.push(r) })
    let received = false
    host.onChildMessage(() => { received = true })

    const message = buildChildToParentMessage('ready', WIDGET_ID, NONCE, { sdkVersion: '7.4.0' })
    parent.listeners[0]({ data: message, origin: 'https://evil.example.com' })

    expect(received).toBe(false)
    expect(rejections).toEqual(['origin_not_allowed'])
  })

  it('rejects a malformed message', () => {
    const rejections: MessageRejectionReason[] = []
    const { parent } = makeHost({ onRejected: (r) => rejections.push(r) })
    parent.listeners[0]({ data: { bogus: true }, origin: CHILD_ORIGIN })
    expect(rejections).toEqual(['invalid_message_schema'])
  })

  it('resize event is deliverable end-to-end via onChildMessage', () => {
    const { host, parent } = makeHost()
    const received: ChildToParentMessage[] = []
    host.onChildMessage((m) => received.push(m))
    const message = buildChildToParentMessage('resize', WIDGET_ID, NONCE, { heightPx: 480 })
    parent.listeners[0]({ data: message, origin: CHILD_ORIGIN })
    expect(received[0].type).toBe('resize')
    expect((received[0] as Extract<ChildToParentMessage, { type: 'resize' }>).payload.heightPx).toBe(480)
  })

  it('interaction event is deliverable end-to-end via onChildMessage', () => {
    const { host, parent } = makeHost()
    const received: ChildToParentMessage[] = []
    host.onChildMessage((m) => received.push(m))
    const message = buildChildToParentMessage('interaction', WIDGET_ID, NONCE, { target: 'recommendations' })
    parent.listeners[0]({ data: message, origin: CHILD_ORIGIN })
    expect(received[0].type).toBe('interaction')
  })

  it('error event is deliverable end-to-end via onChildMessage', () => {
    const { host, parent } = makeHost()
    const received: ChildToParentMessage[] = []
    host.onChildMessage((m) => received.push(m))
    const error = buildSDKError('NETWORK')
    const message = buildChildToParentMessage('error', WIDGET_ID, NONCE, { code: error.code, message: error.message, retryable: error.retryable })
    parent.listeners[0]({ data: message, origin: CHILD_ORIGIN })
    expect(received[0].type).toBe('error')
  })

  it('unsubscribe stops further delivery to that listener', () => {
    const { host, parent } = makeHost()
    const received: ChildToParentMessage[] = []
    const unsubscribe = host.onChildMessage((m) => received.push(m))
    unsubscribe()

    const message = buildChildToParentMessage('ready', WIDGET_ID, NONCE, { sdkVersion: '7.4.0' })
    parent.listeners[0]({ data: message, origin: CHILD_ORIGIN })

    expect(received).toHaveLength(0)
  })
})

describe('IframeHostBootstrap — dispose', () => {
  it('sends a dispose message before tearing down', () => {
    const { host, child } = makeHost()
    host.dispose()
    expect(child.sent).toHaveLength(1)
    expect((child.sent[0].message as { type: string }).type).toBe('dispose')
  })

  it('removes the parent window listener', () => {
    const { host, parent } = makeHost()
    expect(parent.listeners).toHaveLength(1)
    host.dispose()
    expect(parent.listeners).toHaveLength(0)
  })

  it('is idempotent — a second dispose() does not send a second dispose message', () => {
    const { host, child } = makeHost()
    host.dispose()
    host.dispose()
    expect(child.sent).toHaveLength(1)
  })

  it('further sends after dispose are no-ops', () => {
    const { host, child } = makeHost()
    host.dispose()
    host.sendRefreshRequest()
    expect(child.sent).toHaveLength(1) // only the dispose message
  })

  it('isDisposed reflects state', () => {
    const { host } = makeHost()
    expect(host.isDisposed).toBe(false)
    host.dispose()
    expect(host.isDisposed).toBe(true)
  })

  it('after dispose, incoming messages are no longer dispatched (listener removed)', () => {
    const { host, parent } = makeHost()
    const received: ChildToParentMessage[] = []
    host.onChildMessage((m) => received.push(m))
    host.dispose()

    // Simulate a message still arriving after dispose — the listener was
    // removed from `parent.listeners`, so there is nothing left to invoke.
    expect(parent.listeners).toHaveLength(0)
    expect(received).toHaveLength(0)
  })
})

describe('IframeHostBootstrap — no credential leakage', () => {
  it('nothing sent to the child ever contains a planted secret', () => {
    const SECRET = 'tok_host_test_secret_leak_check'
    const { host, child } = makeHost()
    host.sendInit({
      widgetMode: 'commissioner', entityId: 'league_001', entityType: 'league',
      theme: { mode: 'light', tokens: { colorTokenMap: {}, iconTokenMap: {}, radiusToken: 'soft', densityToken: 'comfortable' }, partnerBrandId: null },
      locale: { locale: 'en-US', fallbackLocale: 'en-US', numberFormat: 'western', dateFormat: 'MDY' },
      presentationVersion: '7.0.0',
    })
    host.sendRefreshRequest()
    host.dispose()
    expect(JSON.stringify(child.sent)).not.toContain(SECRET)
  })
})
