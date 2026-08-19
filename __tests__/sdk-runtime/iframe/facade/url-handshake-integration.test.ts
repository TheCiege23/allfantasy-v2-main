import { describe, expect, it } from 'vitest'
import {
  createAllFantasyWidgetHost,
  createAllFantasyWidgetIframeClientFromUrl,
} from '../../../../sdk-runtime/iframe/src/facade/index'
import type { AllFantasyWidgetHostConfig } from '../../../../sdk-runtime/iframe/src/facade/index'
import type { DocumentSource } from '../../../../sdk-runtime/iframe/src/browser/mount'
import type { BrowserWindowSource } from '../../../../sdk-runtime/iframe/src/browser/windowBridge'
import type { RandomSource } from '../../../../sdk-runtime/iframe/src/browser/nonce'
import { resolveSDKTheme, resolveRefreshStrategy, SDK_VERSION } from '../../../../lib/decision-os/sdk/index'
import type { SDKConfig } from '../../../../lib/decision-os/sdk/types'

/**
 * Genuine end-to-end proof that the Phase 7.14 URL handshake correctly
 * connects the Phase 7.12 host facade and the Phase 7.13/7.14 child facade:
 * the host mounts (embedding widgetId/nonce/parentOrigin in the iframe src
 * it builds internally), the child facade parses THAT SAME src's query
 * string, and a message the child sends is accepted by the host's own
 * validation — proving the two sides actually agree, not just that the
 * parser round-trips values in isolation.
 */

const HOST_ORIGIN = 'https://partner.example.com'
const CHILD_ORIGIN = 'https://widgets.allfantasy.app'
const BASE_SRC = 'https://widgets.allfantasy.app/embed'
const SECRET = 'tok_integration_test_secret_leak_check'

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
    hostOrigin: HOST_ORIGIN,
    refreshStrategy: resolveRefreshStrategy('manual'),
    capabilities: {
      supportsInteractivity: true, supportsRefresh: true, supportsTelemetry: true,
      supportsThemeOverride: false, supportsOfflineCache: false, maxWidgetsPerHost: 5,
    },
  }
}

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

function makeMockIframeElement(contentWindow: BrowserWindowSource | null) {
  const element = {
    src: '',
    contentWindow,
    setAttribute: () => {},
    getAttribute: () => null,
    remove: () => {},
  }
  return element as unknown as HTMLIFrameElement
}

function makeFixedRandomSource(fillValue: number): RandomSource {
  return {
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint8Array) array.fill(fillValue)
      return array
    },
  }
}

describe('URL handshake — host and child facades agree after a full round trip', () => {
  it('a message the child sends is accepted by the host after initializing purely from the parsed URL', () => {
    // 1. Host side: mount, which internally builds the iframe src via buildIframeWidgetUrl.
    const hostChildWindow = makeMockBrowserWindow() // what the HOST posts to / the child's own window
    const hostParentWindowMock = makeMockBrowserWindow() // what the HOST listens on
    const iframeElement = makeMockIframeElement(hostChildWindow.source)
    const doc: DocumentSource = { createElement: () => iframeElement }

    const hostConfig: AllFantasyWidgetHostConfig = {
      sdkConfig: makeSdkConfig(),
      iframeOrigin: CHILD_ORIGIN,
      allowedOrigins: [HOST_ORIGIN],
      baseSrc: BASE_SRC,
      randomSource: makeFixedRandomSource(3),
      document: doc,
      parentWindow: hostParentWindowMock.source,
    }

    let hostSawReady = false
    const host = createAllFantasyWidgetHost({ ...hostConfig, onReady: () => { hostSawReady = true } })
    host.mount({ appendChild: () => {} })

    // 2. Extract the query string the host embedded in the iframe's src — this
    // is exactly what a real browser would expose as the child's own
    // window.location.search once that URL actually navigates.
    const locationSearch = iframeElement.src.slice(BASE_SRC.length)
    expect(locationSearch.startsWith('?')).toBe(true)

    // 3. Child side: initializes PURELY from the parsed URL — never told
    // widgetId/nonce/parentOrigin directly.
    const childOwnWindow = hostChildWindow // the child's "own window" IS what the host posts to
    const childParentWindow = hostParentWindowMock // the child posts TO what the host listens on
    const client = createAllFantasyWidgetIframeClientFromUrl({
      locationSearch,
      ownWindow: childOwnWindow.source,
      parentWindow: childParentWindow.source,
    })

    // 4. The child announces readiness — the host must accept it (matching
    // widgetId/nonce proves the two sides parsed identical values). The mock
    // window records the send but does not auto-deliver (unlike a real
    // browser); redeliver it to the host's own registered listener
    // explicitly, matching the pattern used throughout iframe-host.test.ts.
    client.sendReady(SDK_VERSION)
    expect(hostParentWindowMock.sent).toHaveLength(1)
    hostParentWindowMock.listeners[0]({ data: hostParentWindowMock.sent[0].message, origin: CHILD_ORIGIN } as MessageEvent)

    expect(hostSawReady).toBe(true)
  })

  it('the locationSearch never contains the credential, proving the whole round trip is credential-free', () => {
    const hostChildWindow = makeMockBrowserWindow()
    const hostParentWindowMock = makeMockBrowserWindow()
    const iframeElement = makeMockIframeElement(hostChildWindow.source)
    const doc: DocumentSource = { createElement: () => iframeElement }

    const host = createAllFantasyWidgetHost({
      sdkConfig: makeSdkConfig(),
      iframeOrigin: CHILD_ORIGIN,
      allowedOrigins: [HOST_ORIGIN],
      baseSrc: BASE_SRC,
      randomSource: makeFixedRandomSource(9),
      document: doc,
      parentWindow: hostParentWindowMock.source,
    })
    host.mount({ appendChild: () => {} })

    expect(iframeElement.src).not.toContain(SECRET)
  })
})
