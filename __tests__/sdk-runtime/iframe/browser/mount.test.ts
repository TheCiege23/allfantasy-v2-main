import { describe, expect, it } from 'vitest'
import { mountIframeWidget } from '../../../../sdk-runtime/iframe/src/browser/mount'
import type { DocumentSource } from '../../../../sdk-runtime/iframe/src/browser/mount'
import type { BrowserWindowSource } from '../../../../sdk-runtime/iframe/src/browser/windowBridge'
import { IFRAME_SANDBOX_ATTRIBUTE, buildChildToParentMessage, buildInitPayloadFromSdkConfig } from '../../../../sdk-runtime/iframe/src/index'
import { resolveSDKTheme, resolveRefreshStrategy, SDK_VERSION } from '../../../../lib/decision-os/sdk/index'
import type { SDKConfig } from '../../../../lib/decision-os/sdk/types'

const WIDGET_ID = 'widget_league_001'
const NONCE = 'n0nce_abcdef123456'
const CHILD_ORIGIN = 'https://widgets.allfantasy.app'
const SRC = 'https://widgets.allfantasy.app/embed?widget=league_001'

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
  return {
    createElement: (tagName: 'iframe') => {
      if (tagName !== 'iframe') throw new Error(`unexpected tag: ${tagName}`)
      return mockIframeElement
    },
  }
}

function makeMockContainer() {
  const children: unknown[] = []
  const calls: string[] = []
  return {
    appendChild: (el: unknown) => { children.push(el); calls.push('appendChild'); return el },
    children,
    calls,
  }
}

function makeMockParentWindow(): BrowserWindowSource {
  return {
    postMessage: () => {},
    addEventListener: (() => {}) as BrowserWindowSource['addEventListener'],
    removeEventListener: (() => {}) as BrowserWindowSource['removeEventListener'],
  }
}

describe('mountIframeWidget — element creation', () => {
  it('sets the src attribute to the provided URL', () => {
    const contentWindow = makeMockContentWindow()
    const { element } = makeMockIframeElement(contentWindow.source)
    const doc = makeMockDocument(element)
    const container = makeMockContainer()

    mountIframeWidget({
      container, src: SRC, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      document: doc, parentWindow: makeMockParentWindow(),
    })

    expect(element.src).toBe(SRC)
  })

  it('sets the sandbox attribute to IFRAME_SANDBOX_ATTRIBUTE', () => {
    const contentWindow = makeMockContentWindow()
    const { element, attrs } = makeMockIframeElement(contentWindow.source)
    const doc = makeMockDocument(element)
    const container = makeMockContainer()

    mountIframeWidget({
      container, src: SRC, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      document: doc, parentWindow: makeMockParentWindow(),
    })

    expect(attrs.get('sandbox')).toBe(IFRAME_SANDBOX_ATTRIBUTE)
  })

  it('appends the iframe element to the container', () => {
    const contentWindow = makeMockContentWindow()
    const { element } = makeMockIframeElement(contentWindow.source)
    const doc = makeMockDocument(element)
    const container = makeMockContainer()

    mountIframeWidget({
      container, src: SRC, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      document: doc, parentWindow: makeMockParentWindow(),
    })

    expect(container.children).toEqual([element])
  })

  it('returns the created iframeElement', () => {
    const contentWindow = makeMockContentWindow()
    const { element } = makeMockIframeElement(contentWindow.source)
    const doc = makeMockDocument(element)
    const container = makeMockContainer()

    const mounted = mountIframeWidget({
      container, src: SRC, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      document: doc, parentWindow: makeMockParentWindow(),
    })

    expect(mounted.iframeElement).toBe(element)
  })
})

describe('mountIframeWidget — origin validation', () => {
  it('throws when the src origin does not match childOrigin', () => {
    const contentWindow = makeMockContentWindow()
    const { element } = makeMockIframeElement(contentWindow.source)
    const doc = makeMockDocument(element)
    const container = makeMockContainer()

    expect(() => mountIframeWidget({
      container, src: 'https://evil.example.com/embed', childOrigin: CHILD_ORIGIN,
      widgetId: WIDGET_ID, nonce: NONCE, document: doc, parentWindow: makeMockParentWindow(),
    })).toThrow(/does not match expected childOrigin/)
  })

  it('does not create an iframe element when origin validation fails', () => {
    const contentWindow = makeMockContentWindow()
    const { element } = makeMockIframeElement(contentWindow.source)
    let createCalled = false
    const doc: DocumentSource = {
      createElement: (tagName) => { createCalled = true; return element }
    }
    const container = makeMockContainer()

    expect(() => mountIframeWidget({
      container, src: 'https://evil.example.com/embed', childOrigin: CHILD_ORIGIN,
      widgetId: WIDGET_ID, nonce: NONCE, document: doc, parentWindow: makeMockParentWindow(),
    })).toThrow()
    expect(createCalled).toBe(false)
  })
})

describe('mountIframeWidget — init/ready round trip via the returned host', () => {
  it('sendInit posts to the mock contentWindow with the correct targetOrigin', () => {
    const contentWindow = makeMockContentWindow()
    const { element } = makeMockIframeElement(contentWindow.source)
    const doc = makeMockDocument(element)
    const container = makeMockContainer()

    const { host } = mountIframeWidget({
      container, src: SRC, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      document: doc, parentWindow: makeMockParentWindow(),
      generateTimestamp: () => '2026-07-01T00:00:00.000Z',
    })

    host.sendInit({
      widgetMode: 'commissioner', entityId: 'league_001', entityType: 'league',
      theme: { mode: 'light', tokens: { colorTokenMap: {}, iconTokenMap: {}, radiusToken: 'soft', densityToken: 'comfortable' }, partnerBrandId: null },
      locale: { locale: 'en-US', fallbackLocale: 'en-US', numberFormat: 'western', dateFormat: 'MDY' },
      presentationVersion: '7.0.0',
    })

    expect(contentWindow.sent).toHaveLength(1)
    expect(contentWindow.sent[0].targetOrigin).toBe(CHILD_ORIGIN)
    expect((contentWindow.sent[0].message as { type: string }).type).toBe('init')
  })

  it('the host receives a ready message delivered via the mock contentWindow listener', () => {
    const contentWindow = makeMockContentWindow()
    const { element } = makeMockIframeElement(contentWindow.source)
    const doc = makeMockDocument(element)
    const container = makeMockContainer()
    const parentWindow = makeMockParentWindow()

    const receivedByParent: Array<(e: MessageEvent) => void> = []
    const parentSource: BrowserWindowSource = {
      postMessage: () => {},
      addEventListener: ((_t: string, l: (e: MessageEvent) => void) => { receivedByParent.push(l) }) as BrowserWindowSource['addEventListener'],
      removeEventListener: (() => {}) as BrowserWindowSource['removeEventListener'],
    }

    const { host } = mountIframeWidget({
      container, src: SRC, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      document: doc, parentWindow: parentSource,
    })

    const received: unknown[] = []
    host.onChildMessage((m) => received.push(m))

    const readyMessage = buildChildToParentMessage('ready', WIDGET_ID, NONCE, { sdkVersion: '7.4.0' })
    expect(receivedByParent).toHaveLength(1)
    receivedByParent[0]({ data: readyMessage, origin: CHILD_ORIGIN } as MessageEvent)

    expect(received).toHaveLength(1)
    void parentWindow
  })
})

describe('mountIframeWidget — unmount', () => {
  it('unmount() disposes the host (sends dispose) before removing the element', () => {
    const contentWindow = makeMockContentWindow()
    const { element, calls } = makeMockIframeElement(contentWindow.source)
    const doc = makeMockDocument(element)
    const container = makeMockContainer()

    const order: string[] = []
    const trackedContentWindow: BrowserWindowSource = {
      postMessage: (message) => { order.push('dispose_sent'); void message },
      addEventListener: (() => {}) as BrowserWindowSource['addEventListener'],
      removeEventListener: (() => {}) as BrowserWindowSource['removeEventListener'],
    }
    const trackedElement = { ...element, contentWindow: trackedContentWindow, remove: () => { order.push('element_removed') } } as unknown as HTMLIFrameElement
    const trackedDoc = makeMockDocument(trackedElement)

    const { unmount } = mountIframeWidget({
      container, src: SRC, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      document: trackedDoc, parentWindow: makeMockParentWindow(),
    })

    unmount()

    expect(order).toEqual(['dispose_sent', 'element_removed'])
    void calls
  })

  it('unmount() actually removes the iframe element', () => {
    const contentWindow = makeMockContentWindow()
    const { element, calls } = makeMockIframeElement(contentWindow.source)
    const doc = makeMockDocument(element)
    const container = makeMockContainer()

    const { unmount } = mountIframeWidget({
      container, src: SRC, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      document: doc, parentWindow: makeMockParentWindow(),
    })

    unmount()
    expect(calls).toContain('remove')
  })
})

describe('mountIframeWidget — no credential leakage', () => {
  const SECRET = 'tok_mount_test_secret_leak_check'

  function makeSdkConfig(): SDKConfig {
    return {
      version: { sdkVersion: SDK_VERSION, presentationVersion: '7.0.0', widgetContractVersion: '7.3.0', apiVersion: 'v1' },
      auth: { method: 'signed_embed_token', credential: SECRET, tenantId: 'tenant_001', expiresAt: null, scopes: ['intelligence:league:read'] },
      theme: resolveSDKTheme('light'),
      locale: { locale: 'en-US', fallbackLocale: 'en-US', numberFormat: 'western', dateFormat: 'MDY' },
      embedTarget: 'iframe',
      widgetMode: 'commissioner',
      entityId: 'league_001',
      entityType: 'league',
      hostOrigin: 'https://partner.example.com',
      refreshStrategy: resolveRefreshStrategy('manual'),
      capabilities: {
        supportsInteractivity: true, supportsRefresh: true, supportsTelemetry: true,
        supportsThemeOverride: false, supportsOfflineCache: false, maxWidgetsPerHost: 5,
      },
    }
  }

  it('a real init flow (SDKConfig with a real credential → buildInitPayloadFromSdkConfig → sendInit) never posts the credential', () => {
    const contentWindow = makeMockContentWindow()
    const { element } = makeMockIframeElement(contentWindow.source)
    const doc = makeMockDocument(element)
    const container = makeMockContainer()

    const { host } = mountIframeWidget({
      container, src: SRC, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE,
      document: doc, parentWindow: makeMockParentWindow(),
    })

    // buildInitPayloadFromSdkConfig (Phase 7.9) never reads sdkConfig.auth —
    // this is the realistic call path a production caller uses.
    host.sendInit(buildInitPayloadFromSdkConfig(makeSdkConfig()))

    expect(JSON.stringify(contentWindow.sent)).not.toContain(SECRET)
  })
})
