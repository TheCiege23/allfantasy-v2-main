import { describe, expect, it } from 'vitest'
import { createAllFantasyWidgetIframeClient } from '../../../../sdk-runtime/iframe/src/facade/index'
import type { AllFantasyWidgetIframeClientConfig } from '../../../../sdk-runtime/iframe/src/facade/index'
import type { BrowserWindowSource } from '../../../../sdk-runtime/iframe/src/browser/windowBridge'
import { buildParentToChildMessage } from '../../../../sdk-runtime/iframe/src/index'
import type { MessageRejectionReason } from '../../../../sdk-runtime/iframe/src/index'
import { resolveSDKTheme, buildSDKError } from '../../../../lib/decision-os/sdk/index'

const WIDGET_ID = 'widget_league_001_commissioner'
const NONCE = 'n0nce_abcdef123456'
const PARENT_ORIGIN = 'https://partner.example.com'
const SECRET = 'tok_child_facade_test_secret_leak_check'

function makeMockBrowserWindow() {
  const sent: Array<{ message: unknown; targetOrigin: string }> = []
  const listeners: Array<(event: MessageEvent) => void> = []
  const source: BrowserWindowSource = {
    postMessage: (message, targetOrigin) => { sent.push({ message, targetOrigin }) },
    addEventListener: ((_t: string, l: (e: MessageEvent) => void) => { listeners.push(l) }) as BrowserWindowSource['addEventListener'],
    removeEventListener: ((_t: string, l: (e: MessageEvent) => void) => {
      const i = listeners.indexOf(l)
      if (i >= 0) listeners.splice(i, 1)
    }) as BrowserWindowSource['removeEventListener'],
  }
  return { source, sent, listeners }
}

function makeConfig(overrides: Partial<AllFantasyWidgetIframeClientConfig> = {}): AllFantasyWidgetIframeClientConfig {
  return {
    widgetId: WIDGET_ID,
    nonce: NONCE,
    parentOrigin: PARENT_ORIGIN,
    ...overrides,
  }
}

/** Simulates a message arriving at the child's own window, as if the parent had posted it. */
function deliverToOwn(ownWindowMock: ReturnType<typeof makeMockBrowserWindow>, data: unknown, origin = PARENT_ORIGIN): void {
  ownWindowMock.listeners[0]({ data, origin } as MessageEvent)
}

// ── Ready handshake ────────────────────────────────────────────────────────────

describe('createAllFantasyWidgetIframeClient — ready handshake', () => {
  it('sendReady posts a ready message to the parent with explicit origin', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const client = createAllFantasyWidgetIframeClient(makeConfig({ ownWindow: ownWindow.source, parentWindow: parentWindow.source }))

    client.sendReady('7.4.0')

    expect(parentWindow.sent).toHaveLength(1)
    expect(parentWindow.sent[0].targetOrigin).toBe(PARENT_ORIGIN)
    const message = parentWindow.sent[0].message as { type: string; payload: { sdkVersion: string } }
    expect(message.type).toBe('ready')
    expect(message.payload.sdkVersion).toBe('7.4.0')
  })
})

// ── Init handling ─────────────────────────────────────────────────────────────

describe('createAllFantasyWidgetIframeClient — init handling', () => {
  it('receiving init invokes onInit with the payload', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const received: unknown[] = []
    createAllFantasyWidgetIframeClient(makeConfig({
      ownWindow: ownWindow.source, parentWindow: parentWindow.source, onInit: (p) => received.push(p),
    }))

    const initPayload = {
      widgetMode: 'commissioner' as const, entityId: 'league_001', entityType: 'league' as const,
      theme: resolveSDKTheme('light'),
      locale: { locale: 'en-US' as const, fallbackLocale: 'en-US' as const, numberFormat: 'western' as const, dateFormat: 'MDY' as const },
      presentationVersion: '7.0.0',
    }
    deliverToOwn(ownWindow, buildParentToChildMessage('init', WIDGET_ID, NONCE, initPayload))

    expect(received).toEqual([initPayload])
  })
})

// ── Render request handling ────────────────────────────────────────────────────

describe('createAllFantasyWidgetIframeClient — render (refresh) request handling', () => {
  it('receiving refresh_request invokes onRefreshRequest with no arguments', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    let callCount = 0
    createAllFantasyWidgetIframeClient(makeConfig({
      ownWindow: ownWindow.source, parentWindow: parentWindow.source, onRefreshRequest: () => { callCount++ },
    }))

    deliverToOwn(ownWindow, buildParentToChildMessage('refresh_request', WIDGET_ID, NONCE, {}))

    expect(callCount).toBe(1)
  })

  it('receiving visibility_change invokes onVisibilityChange with the boolean', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const values: boolean[] = []
    createAllFantasyWidgetIframeClient(makeConfig({
      ownWindow: ownWindow.source, parentWindow: parentWindow.source, onVisibilityChange: (v) => values.push(v),
    }))

    deliverToOwn(ownWindow, buildParentToChildMessage('visibility_change', WIDGET_ID, NONCE, { visible: false }))

    expect(values).toEqual([false])
  })

  it('receiving theme_update invokes onThemeUpdate with the theme', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const themes: unknown[] = []
    createAllFantasyWidgetIframeClient(makeConfig({
      ownWindow: ownWindow.source, parentWindow: parentWindow.source, onThemeUpdate: (t) => themes.push(t),
    }))

    const theme = resolveSDKTheme('dark')
    deliverToOwn(ownWindow, buildParentToChildMessage('theme_update', WIDGET_ID, NONCE, { theme }))

    expect(themes).toEqual([theme])
  })
})

// ── Resize helper ─────────────────────────────────────────────────────────────

describe('createAllFantasyWidgetIframeClient — resize helper', () => {
  it('sendResize posts the height to the parent', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const client = createAllFantasyWidgetIframeClient(makeConfig({ ownWindow: ownWindow.source, parentWindow: parentWindow.source }))

    client.sendResize(512)

    const message = parentWindow.sent[0].message as { type: string; payload: { heightPx: number } }
    expect(message.type).toBe('resize')
    expect(message.payload.heightPx).toBe(512)
  })
})

// ── Interaction helper ─────────────────────────────────────────────────────────

describe('createAllFantasyWidgetIframeClient — interaction helper', () => {
  it('sendInteraction posts the target to the parent', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const client = createAllFantasyWidgetIframeClient(makeConfig({ ownWindow: ownWindow.source, parentWindow: parentWindow.source }))

    client.sendInteraction('recommendation_card')

    const message = parentWindow.sent[0].message as { type: string; payload: { target: string } }
    expect(message.type).toBe('interaction')
    expect(message.payload.target).toBe('recommendation_card')
  })
})

// ── Error helper ──────────────────────────────────────────────────────────────

describe('createAllFantasyWidgetIframeClient — error helper', () => {
  it('sendError posts the sanitized SDKError payload to the parent', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const client = createAllFantasyWidgetIframeClient(makeConfig({ ownWindow: ownWindow.source, parentWindow: parentWindow.source }))

    const error = buildSDKError('NETWORK')
    client.sendError(error)

    const message = parentWindow.sent[0].message as { type: string; payload: { code: string; message: string; retryable: boolean } }
    expect(message.type).toBe('error')
    expect(message.payload).toEqual({ code: 'NETWORK', message: error.message, retryable: true })
  })
})

// ── Dispose handling ──────────────────────────────────────────────────────────

describe('createAllFantasyWidgetIframeClient — dispose handling', () => {
  it('receiving dispose tears the client down and calls onDisposed', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    let disposedCalled = false
    const client = createAllFantasyWidgetIframeClient(makeConfig({
      ownWindow: ownWindow.source, parentWindow: parentWindow.source, onDisposed: () => { disposedCalled = true },
    }))

    expect(client.isDisposed).toBe(false)
    deliverToOwn(ownWindow, buildParentToChildMessage('dispose', WIDGET_ID, NONCE, {}))

    expect(client.isDisposed).toBe(true)
    expect(disposedCalled).toBe(true)
    expect(ownWindow.listeners).toHaveLength(0)
  })
})

// ── Safe teardown ─────────────────────────────────────────────────────────────

describe('createAllFantasyWidgetIframeClient — safe teardown', () => {
  it('dispose() proactively tears the client down without a received message', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const client = createAllFantasyWidgetIframeClient(makeConfig({ ownWindow: ownWindow.source, parentWindow: parentWindow.source }))

    client.dispose()

    expect(client.isDisposed).toBe(true)
    expect(ownWindow.listeners).toHaveLength(0)
  })

  it('dispose() is idempotent', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const client = createAllFantasyWidgetIframeClient(makeConfig({ ownWindow: ownWindow.source, parentWindow: parentWindow.source }))

    client.dispose()
    expect(() => client.dispose()).not.toThrow()
  })

  it('sends after dispose are no-ops', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const client = createAllFantasyWidgetIframeClient(makeConfig({ ownWindow: ownWindow.source, parentWindow: parentWindow.source }))

    client.dispose()
    client.sendReady('7.4.0')

    expect(parentWindow.sent).toHaveLength(0)
  })
})

// ── Malformed message / invalid origin ────────────────────────────────────────

describe('createAllFantasyWidgetIframeClient — malformed message', () => {
  it('a schema-invalid message is rejected via onProtocolRejection, no callback fires', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const rejections: MessageRejectionReason[] = []
    let initCalled = false
    createAllFantasyWidgetIframeClient(makeConfig({
      ownWindow: ownWindow.source, parentWindow: parentWindow.source,
      onInit: () => { initCalled = true },
      onProtocolRejection: (r) => rejections.push(r),
    }))

    deliverToOwn(ownWindow, { totally: 'bogus' })

    expect(rejections).toEqual(['invalid_message_schema'])
    expect(initCalled).toBe(false)
  })
})

describe('createAllFantasyWidgetIframeClient — invalid origin', () => {
  it('a message from an unexpected origin is rejected via onProtocolRejection', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const rejections: MessageRejectionReason[] = []
    let refreshCalled = false
    createAllFantasyWidgetIframeClient(makeConfig({
      ownWindow: ownWindow.source, parentWindow: parentWindow.source,
      onRefreshRequest: () => { refreshCalled = true },
      onProtocolRejection: (r) => rejections.push(r),
    }))

    deliverToOwn(ownWindow, buildParentToChildMessage('refresh_request', WIDGET_ID, NONCE, {}), 'https://evil.example.com')

    expect(rejections).toEqual(['origin_not_allowed'])
    expect(refreshCalled).toBe(false)
  })

  it('a message with a mismatched nonce is rejected via onProtocolRejection', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const rejections: MessageRejectionReason[] = []
    createAllFantasyWidgetIframeClient(makeConfig({
      ownWindow: ownWindow.source, parentWindow: parentWindow.source,
      onProtocolRejection: (r) => rejections.push(r),
    }))

    deliverToOwn(ownWindow, buildParentToChildMessage('refresh_request', WIDGET_ID, 'a_different_nonce_val', {}))

    expect(rejections).toEqual(['nonce_mismatch'])
  })

  it('a message for a different widgetId is rejected via onProtocolRejection', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const rejections: MessageRejectionReason[] = []
    createAllFantasyWidgetIframeClient(makeConfig({
      ownWindow: ownWindow.source, parentWindow: parentWindow.source,
      onProtocolRejection: (r) => rejections.push(r),
    }))

    deliverToOwn(ownWindow, buildParentToChildMessage('refresh_request', 'widget_other', NONCE, {}))

    expect(rejections).toEqual(['widget_id_mismatch'])
  })
})

// ── No credential leakage ─────────────────────────────────────────────────────

describe('createAllFantasyWidgetIframeClient — no credential leakage', () => {
  it('none of the outbound helper messages ever contain a planted secret', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const client = createAllFantasyWidgetIframeClient(makeConfig({ ownWindow: ownWindow.source, parentWindow: parentWindow.source }))

    client.sendReady('7.4.0')
    client.sendResize(400)
    client.sendInteraction('cta')
    client.sendError(buildSDKError('UNAUTHORIZED'))

    expect(JSON.stringify(parentWindow.sent)).not.toContain(SECRET)
  })

  it('no callback payload contains a planted secret across a full init/refresh/error round trip', () => {
    const ownWindow = makeMockBrowserWindow()
    const parentWindow = makeMockBrowserWindow()
    const collected: unknown[] = []
    createAllFantasyWidgetIframeClient(makeConfig({
      ownWindow: ownWindow.source, parentWindow: parentWindow.source,
      onInit: (p) => collected.push(p),
      onRefreshRequest: () => collected.push('refresh'),
    }))

    deliverToOwn(ownWindow, buildParentToChildMessage('init', WIDGET_ID, NONCE, {
      widgetMode: 'commissioner', entityId: 'league_001', entityType: 'league',
      theme: resolveSDKTheme('light'),
      locale: { locale: 'en-US', fallbackLocale: 'en-US', numberFormat: 'western', dateFormat: 'MDY' },
      presentationVersion: '7.0.0',
    }))
    deliverToOwn(ownWindow, buildParentToChildMessage('refresh_request', WIDGET_ID, NONCE, {}))

    expect(JSON.stringify(collected)).not.toContain(SECRET)
  })
})

// ── Defaults ──────────────────────────────────────────────────────────────────

describe('createAllFantasyWidgetIframeClient — defaults to real browser globals', () => {
  it('does not throw when ownWindow/parentWindow are omitted (uses real window/window.parent)', () => {
    expect(() => createAllFantasyWidgetIframeClient(makeConfig())).not.toThrow()
  })
})
