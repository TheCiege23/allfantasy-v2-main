import { describe, expect, it } from 'vitest'
import { createAllFantasyWidgetHost } from '../../../../sdk-runtime/iframe/src/facade/index'
import type { AllFantasyWidgetHostConfig } from '../../../../sdk-runtime/iframe/src/facade/index'
import type { DocumentSource } from '../../../../sdk-runtime/iframe/src/browser/mount'
import type { BrowserWindowSource } from '../../../../sdk-runtime/iframe/src/browser/windowBridge'
import { generateNonce } from '../../../../sdk-runtime/iframe/src/browser/nonce'
import type { RandomSource } from '../../../../sdk-runtime/iframe/src/browser/nonce'
import { buildChildToParentMessage, IFRAME_SANDBOX_ATTRIBUTE, parseIframeWidgetUrlParams } from '../../../../sdk-runtime/iframe/src/index'
import type { MessageRejectionReason } from '../../../../sdk-runtime/iframe/src/index'
import { resolveSDKTheme, resolveRefreshStrategy, SDK_VERSION } from '../../../../lib/decision-os/sdk/index'
import type { SDKConfig } from '../../../../lib/decision-os/sdk/types'

const CHILD_ORIGIN = 'https://widgets.allfantasy.app'
const HOST_ORIGIN = 'https://partner.example.com'
const SRC = 'https://widgets.allfantasy.app/embed'
const SECRET = 'tok_facade_test_secret_leak_check'
const WIDGET_ID = 'widget_league_001_commissioner'

function makeSdkConfig(overrides: Partial<SDKConfig> = {}): SDKConfig {
  return {
    version: { sdkVersion: SDK_VERSION, presentationVersion: '7.0.0', widgetContractVersion: '7.3.0', apiVersion: 'v1' },
    auth: { method: 'signed_embed_token', credential: SECRET, tenantId: 'tenant_001', expiresAt: null, scopes: ['intelligence:league:read'] },
    theme: resolveSDKTheme('light'),
    locale: { locale: 'en-US', fallbackLocale: 'en-US', numberFormat: 'western', dateFormat: 'MDY' },
    embedTarget: 'iframe',
    widgetMode: 'commissioner',
    entityId: 'league_001',
    entityType: 'league',
    hostOrigin: HOST_ORIGIN,
    refreshStrategy: resolveRefreshStrategy('manual'),
    capabilities: {
      supportsInteractivity: true, supportsRefresh: true, supportsTelemetry: true,
      supportsThemeOverride: false, supportsOfflineCache: false, maxWidgetsPerHost: 5,
    },
    ...overrides,
  }
}

// Fixed-value (not counter-based) fake — calling it independently in a test
// reproduces the exact same nonce the facade generates internally.
function makeFixedRandomSource(fillValue: number): RandomSource {
  return {
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array) array.fill(fillValue)
      return array
    },
  }
}

function makeMockContentWindow() {
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

function makeMockIframeElement(contentWindow: BrowserWindowSource | null) {
  const attrs = new Map<string, string>()
  const calls: string[] = []
  const element = {
    src: '',
    contentWindow,
    setAttribute: (name: string, value: string) => { attrs.set(name, value) },
    getAttribute: (name: string) => attrs.get(name) ?? null,
    remove: () => { calls.push('remove') },
  }
  return { element: element as unknown as HTMLIFrameElement, attrs, calls }
}

function makeMockDocument(mockIframeElement: HTMLIFrameElement): DocumentSource {
  return { createElement: (tagName: 'iframe') => {
    if (tagName !== 'iframe') throw new Error(`unexpected tag: ${tagName}`)
    return mockIframeElement
  } }
}

function makeMockContainer() {
  const children: unknown[] = []
  return { appendChild: (el: unknown) => { children.push(el); return el }, children }
}

/** A minimal valid WindowLike for tests that don't need to deliver inbound messages. */
function makeMockParentWindow(): BrowserWindowSource {
  return {
    postMessage: () => {},
    addEventListener: (() => {}) as BrowserWindowSource['addEventListener'],
    removeEventListener: (() => {}) as BrowserWindowSource['removeEventListener'],
  }
}

function makeConfig(overrides: Partial<AllFantasyWidgetHostConfig> = {}): AllFantasyWidgetHostConfig {
  return {
    sdkConfig: makeSdkConfig(),
    iframeOrigin: CHILD_ORIGIN,
    allowedOrigins: [HOST_ORIGIN],
    baseSrc: SRC,
    randomSource: makeFixedRandomSource(7),
    ...overrides,
  }
}

/**
 * Mounts a host with mocked browser deps. `IframeHostBootstrap` LISTENS on
 * `parentWindow` (messages arriving FROM the child) and SENDS to
 * `childWindow` — so `parentWindowMock` (not `contentWindow`) is what
 * captures the registered listener a test delivers inbound messages through.
 */
function mountedHost(overrides: Partial<AllFantasyWidgetHostConfig> = {}, fillValue = 7) {
  const contentWindow = makeMockContentWindow()
  const parentWindowMock = makeMockContentWindow()
  const { element, attrs, calls } = makeMockIframeElement(contentWindow.source)
  const doc = makeMockDocument(element)
  const container = makeMockContainer()
  const randomSource = makeFixedRandomSource(fillValue)

  const widgetHost = createAllFantasyWidgetHost(makeConfig({
    document: doc, parentWindow: parentWindowMock.source, randomSource, ...overrides,
  }))
  widgetHost.mount(container)

  // The facade generates its nonce internally via the same deterministic
  // source — recomputing it here (idempotent for a fixed-value source) lets
  // the test construct messages the facade's internal validation accepts.
  const nonce = generateNonce(randomSource)

  return { widgetHost, contentWindow, parentWindowMock, element, attrs, calls, container, nonce }
}

/** Simulates a message arriving at the host's own window, as if the child had posted it — origin defaults to the child's, since the child is the sender. */
function deliverToChild(parentWindowMock: ReturnType<typeof makeMockContentWindow>, data: unknown, origin = CHILD_ORIGIN): void {
  parentWindowMock.listeners[0]({ data, origin } as MessageEvent)
}

// ── Mount ─────────────────────────────────────────────────────────────────────

describe('createAllFantasyWidgetHost — mount', () => {
  it('creates an iframe whose src is baseSrc plus the Phase 7.14 handshake params, with the sandbox attribute, appended to the container', () => {
    const { element, attrs, container, nonce } = mountedHost()

    expect(element.src.startsWith(`${SRC}?`)).toBe(true)
    const query = element.src.slice(SRC.length + 1)
    const parsed = parseIframeWidgetUrlParams(query)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.params.widgetId).toBe(WIDGET_ID)
      expect(parsed.params.nonce).toBe(nonce)
      expect(parsed.params.parentOrigin).toBe(HOST_ORIGIN)
    }

    expect(attrs.get('sandbox')).toBe(IFRAME_SANDBOX_ATTRIBUTE)
    expect(container.children).toEqual([element])
  })

  it('appends handshake params with "&" when baseSrc already has a query string', () => {
    const baseSrcWithQuery = `${SRC}?theme=dark`
    const { element } = mountedHost({ baseSrc: baseSrcWithQuery })

    expect(element.src.startsWith(`${baseSrcWithQuery}&`)).toBe(true)
    const query = element.src.slice(baseSrcWithQuery.length + 1)
    expect(parseIframeWidgetUrlParams(query).ok).toBe(true)
  })

  it('isMounted is false before mount and true after', () => {
    const contentWindow = makeMockContentWindow()
    const { element } = makeMockIframeElement(contentWindow.source)
    const doc = makeMockDocument(element)
    const widgetHost = createAllFantasyWidgetHost(makeConfig({ document: doc, parentWindow: makeMockParentWindow() }))

    expect(widgetHost.isMounted).toBe(false)
    widgetHost.mount(makeMockContainer())
    expect(widgetHost.isMounted).toBe(true)
  })

  it('throws when mounting twice without an intervening unmount', () => {
    const { widgetHost } = mountedHost()
    expect(() => widgetHost.mount(makeMockContainer())).toThrow(/already mounted/)
  })

  it('mounting again after unmount succeeds', () => {
    const { widgetHost } = mountedHost()
    widgetHost.unmount()
    expect(() => widgetHost.mount(makeMockContainer())).not.toThrow()
  })
})

// ── Invalid config ────────────────────────────────────────────────────────────

describe('createAllFantasyWidgetHost — invalid config', () => {
  it('throws at construction when embedTarget is not iframe', () => {
    expect(() => createAllFantasyWidgetHost(makeConfig({
      sdkConfig: makeSdkConfig({ embedTarget: 'js_embed' }),
    }))).toThrow(/Invalid AllFantasyWidgetHost config/)
  })

  it('throws at construction when hostOrigin is not in allowedOrigins', () => {
    expect(() => createAllFantasyWidgetHost(makeConfig({
      allowedOrigins: ['https://someone-else.example.com'],
    }))).toThrow(/Invalid AllFantasyWidgetHost config/)
  })

  it('throws at construction when allowedOrigins is empty', () => {
    expect(() => createAllFantasyWidgetHost(makeConfig({ allowedOrigins: [] }))).toThrow()
  })

  it('throws at construction when iframeOrigin is malformed', () => {
    expect(() => createAllFantasyWidgetHost(makeConfig({ iframeOrigin: 'not-a-url' }))).toThrow()
  })

  it('does not attempt to create an iframe when construction fails', () => {
    let createCalled = false
    const doc: DocumentSource = { createElement: () => { createCalled = true; throw new Error('should not be called') } }
    expect(() => createAllFantasyWidgetHost(makeConfig({
      sdkConfig: makeSdkConfig({ embedTarget: 'js_embed' }), document: doc,
    }))).toThrow()
    expect(createCalled).toBe(false)
  })
})

// ── Origin mismatch ────────────────────────────────────────────────────────────

describe('createAllFantasyWidgetHost — origin mismatch', () => {
  it('mount() throws when baseSrc origin does not match iframeOrigin', () => {
    const contentWindow = makeMockContentWindow()
    const { element } = makeMockIframeElement(contentWindow.source)
    const doc = makeMockDocument(element)
    const widgetHost = createAllFantasyWidgetHost(makeConfig({
      baseSrc: 'https://evil.example.com/embed', document: doc, parentWindow: makeMockParentWindow(),
    }))
    expect(() => widgetHost.mount(makeMockContainer())).toThrow(/does not match expected childOrigin/)
  })
})

// ── Unmount ───────────────────────────────────────────────────────────────────

describe('createAllFantasyWidgetHost — unmount', () => {
  it('unmount is a safe no-op when never mounted', () => {
    const widgetHost = createAllFantasyWidgetHost(makeConfig({ parentWindow: makeMockParentWindow() }))
    expect(() => widgetHost.unmount()).not.toThrow()
    expect(widgetHost.isMounted).toBe(false)
  })

  it('unmount disposes the host and removes the element', () => {
    const { widgetHost, calls } = mountedHost()
    widgetHost.unmount()
    expect(calls).toContain('remove')
    expect(widgetHost.isMounted).toBe(false)
  })

  it('unmount is idempotent', () => {
    const { widgetHost } = mountedHost()
    widgetHost.unmount()
    expect(() => widgetHost.unmount()).not.toThrow()
  })

  it('unmount sends a final dispose message to the child before removing the element', () => {
    const { contentWindow, widgetHost } = mountedHost()
    widgetHost.unmount()
    expect(contentWindow.sent.some((s) => (s.message as { type: string }).type === 'dispose')).toBe(true)
  })
})

// ── Callback behavior ────────────────────────────────────────────────────────

describe('createAllFantasyWidgetHost — callback behavior', () => {
  it('receiving ready auto-sends init and invokes onReady', () => {
    const readyEvents: Array<{ sdkVersion: string }> = []
    const { contentWindow, parentWindowMock, nonce } = mountedHost({ onReady: (info) => readyEvents.push(info) })

    deliverToChild(parentWindowMock, buildChildToParentMessage('ready', WIDGET_ID, nonce, { sdkVersion: '7.4.0' }))

    expect(readyEvents).toEqual([{ sdkVersion: '7.4.0' }])
    expect(contentWindow.sent.some((s) => (s.message as { type: string }).type === 'init')).toBe(true)
  })

  it('lifecycle_change invokes onLifecycleChange with the mapped state', () => {
    const states: string[] = []
    const { parentWindowMock, nonce } = mountedHost({ onLifecycleChange: (s) => states.push(s) })

    deliverToChild(parentWindowMock, buildChildToParentMessage('lifecycle_change', WIDGET_ID, nonce, { state: 'ready' }))

    expect(states).toEqual(['ready'])
  })

  it('degraded invokes onDegraded with the completeness value', () => {
    const values: number[] = []
    const { parentWindowMock, nonce } = mountedHost({ onDegraded: (c) => values.push(c) })

    deliverToChild(parentWindowMock, buildChildToParentMessage('degraded', WIDGET_ID, nonce, { completeness: 55 }))

    expect(values).toEqual([55])
  })

  it('error invokes onError with the sanitized payload', () => {
    const errors: Array<{ code: string; message: string; retryable: boolean }> = []
    const { parentWindowMock, nonce } = mountedHost({ onError: (e) => errors.push(e) })

    deliverToChild(parentWindowMock, buildChildToParentMessage('error', WIDGET_ID, nonce, { code: 'NETWORK', message: 'A network error occurred.', retryable: true }))

    expect(errors).toEqual([{ code: 'NETWORK', message: 'A network error occurred.', retryable: true }])
  })

  it('interaction invokes onInteraction with the target', () => {
    const targets: string[] = []
    const { parentWindowMock, nonce } = mountedHost({ onInteraction: (t) => targets.push(t) })

    deliverToChild(parentWindowMock, buildChildToParentMessage('interaction', WIDGET_ID, nonce, { target: 'cta_upgrade' }))

    expect(targets).toEqual(['cta_upgrade'])
  })

  it('resize invokes onResize with the height', () => {
    const heights: number[] = []
    const { parentWindowMock, nonce } = mountedHost({ onResize: (h) => heights.push(h) })

    deliverToChild(parentWindowMock, buildChildToParentMessage('resize', WIDGET_ID, nonce, { heightPx: 480 }))

    expect(heights).toEqual([480])
  })

  it('onProtocolRejection fires for a message from an unexpected origin', () => {
    const rejections: MessageRejectionReason[] = []
    const { parentWindowMock, nonce } = mountedHost({ onProtocolRejection: (r) => rejections.push(r) })

    deliverToChild(parentWindowMock, buildChildToParentMessage('ready', WIDGET_ID, nonce, { sdkVersion: '7.4.0' }), 'https://evil.example.com')

    expect(rejections).toEqual(['origin_not_allowed'])
  })

  it('send methods delegate to the host when mounted', () => {
    const { widgetHost, contentWindow } = mountedHost()
    contentWindow.sent.length = 0

    widgetHost.sendRefreshRequest()
    widgetHost.sendVisibilityChange(false)
    widgetHost.sendThemeUpdate(resolveSDKTheme('dark'))

    const types = contentWindow.sent.map((s) => (s.message as { type: string }).type)
    expect(types).toEqual(['refresh_request', 'visibility_change', 'theme_update'])
  })

  it('send methods are safe no-ops when not mounted', () => {
    const widgetHost = createAllFantasyWidgetHost(makeConfig({ parentWindow: makeMockContentWindow().source }))
    expect(() => widgetHost.sendRefreshRequest()).not.toThrow()
    expect(() => widgetHost.sendVisibilityChange(true)).not.toThrow()
    expect(() => widgetHost.sendThemeUpdate(resolveSDKTheme('light'))).not.toThrow()
  })
})

// ── No credential leakage ─────────────────────────────────────────────────────

describe('createAllFantasyWidgetHost — no credential leakage', () => {
  it('the auto-sent init message never contains the credential', () => {
    const { contentWindow, parentWindowMock, nonce } = mountedHost()
    deliverToChild(parentWindowMock, buildChildToParentMessage('ready', WIDGET_ID, nonce, { sdkVersion: '7.4.0' }))
    expect(JSON.stringify(contentWindow.sent)).not.toContain(SECRET)
  })

  it('no callback payload across a full ready → lifecycle → error round trip contains the credential', () => {
    const collected: unknown[] = []
    const { contentWindow, parentWindowMock, nonce } = mountedHost({
      onReady: (i) => collected.push(i),
      onLifecycleChange: (s) => collected.push(s),
      onError: (e) => collected.push(e),
    })

    deliverToChild(parentWindowMock, buildChildToParentMessage('ready', WIDGET_ID, nonce, { sdkVersion: '7.4.0' }))
    deliverToChild(parentWindowMock, buildChildToParentMessage('lifecycle_change', WIDGET_ID, nonce, { state: 'error' }))
    deliverToChild(parentWindowMock, buildChildToParentMessage('error', WIDGET_ID, nonce, { code: 'UNAUTHORIZED', message: 'The provided credentials are not authorized for this widget.', retryable: false }))

    expect(JSON.stringify(collected)).not.toContain(SECRET)
    expect(JSON.stringify(contentWindow.sent)).not.toContain(SECRET)
  })
})
