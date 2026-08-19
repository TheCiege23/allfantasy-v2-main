import { describe, expect, it } from 'vitest'
import {
  IframeHostBootstrap,
  IframeClientBootstrap,
  buildInitPayloadFromSdkConfig,
} from '../../../sdk-runtime/iframe/src/index'
import type { WindowLike, WindowMessageListener, ChildToParentMessage, ParentToChildMessage } from '../../../sdk-runtime/iframe/src/index'
import { resolveSDKTheme, resolveRefreshStrategy, SDK_VERSION, buildSDKError } from '../../../lib/decision-os/sdk/index'
import type { SDKConfig } from '../../../lib/decision-os/sdk/types'

const WIDGET_ID = 'widget_league_001'
const NONCE = 'n0nce_abcdef123456'
const PARENT_ORIGIN = 'https://partner.example.com'
const CHILD_ORIGIN = 'https://widgets.allfantasy.app'
const SECRET = 'tok_e2e_secret_leak_check'

/**
 * A linked pair of fake windows modeling real postMessage delivery: calling
 * `.postMessage()` on a window fires that SAME window's own registered
 * `addEventListener('message', ...)` listeners (exactly like the real
 * `iframe.contentWindow.postMessage(...)` being observed from inside the
 * iframe via its own `window.addEventListener`, and `window.parent.postMessage(...)`
 * being observed by the parent page's own `window.addEventListener`).
 * Delivery is asynchronous via a microtask queue, matching real browsers.
 */
function createLinkedWindowPair(): {
  parentSideWindow: WindowLike
  childSideWindow: WindowLike
  /** Test-only: bypasses the normal origin tagging to simulate a message
   *  arriving at the child from an arbitrary (possibly spoofed) sender. */
  deliverToChildListeners: (event: { data: unknown; origin: string }) => void
} {
  const parentListeners = new Set<WindowMessageListener>()
  const childListeners = new Set<WindowMessageListener>()

  const parentSideWindow: WindowLike = {
    postMessage: (message) => {
      queueMicrotask(() => {
        for (const l of parentListeners) l({ data: message, origin: CHILD_ORIGIN })
      })
    },
    addEventListener: (_t, l) => { parentListeners.add(l) },
    removeEventListener: (_t, l) => { parentListeners.delete(l) },
  }

  const childSideWindow: WindowLike = {
    postMessage: (message) => {
      queueMicrotask(() => {
        for (const l of childListeners) l({ data: message, origin: PARENT_ORIGIN })
      })
    },
    addEventListener: (_t, l) => { childListeners.add(l) },
    removeEventListener: (_t, l) => { childListeners.delete(l) },
  }

  return {
    parentSideWindow,
    childSideWindow,
    deliverToChildListeners: (event) => {
      for (const l of childListeners) l(event)
    },
  }
}

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
    hostOrigin: PARENT_ORIGIN,
    refreshStrategy: resolveRefreshStrategy('manual'),
    capabilities: {
      supportsInteractivity: true, supportsRefresh: true, supportsTelemetry: true,
      supportsThemeOverride: false, supportsOfflineCache: false, maxWidgetsPerHost: 5,
    },
    ...overrides,
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(() => queueMicrotask(resolve)))
}

describe('end-to-end: host ↔ client', () => {
  it('init: host sends init, client receives it', async () => {
    const { parentSideWindow, childSideWindow } = createLinkedWindowPair()
    const host = new IframeHostBootstrap({ parentWindow: parentSideWindow, childWindow: childSideWindow, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })
    const client = new IframeClientBootstrap({ ownWindow: childSideWindow, parentWindow: parentSideWindow, parentOrigin: PARENT_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })

    const receivedByClient: ParentToChildMessage[] = []
    client.onParentMessage((m) => receivedByClient.push(m))

    host.sendInit(buildInitPayloadFromSdkConfig(makeSdkConfig()))
    await flush()

    expect(receivedByClient).toHaveLength(1)
    expect(receivedByClient[0].type).toBe('init')

    host.dispose()
    client.dispose()
  })

  it('ready: client sends ready, host receives it', async () => {
    const { parentSideWindow, childSideWindow } = createLinkedWindowPair()
    const host = new IframeHostBootstrap({ parentWindow: parentSideWindow, childWindow: childSideWindow, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })
    const client = new IframeClientBootstrap({ ownWindow: childSideWindow, parentWindow: parentSideWindow, parentOrigin: PARENT_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })

    const receivedByHost: ChildToParentMessage[] = []
    host.onChildMessage((m) => receivedByHost.push(m))

    client.sendReady(SDK_VERSION)
    await flush()

    expect(receivedByHost).toHaveLength(1)
    expect(receivedByHost[0].type).toBe('ready')

    host.dispose()
    client.dispose()
  })

  it('resize: client sends resize, host receives the height', async () => {
    const { parentSideWindow, childSideWindow } = createLinkedWindowPair()
    const host = new IframeHostBootstrap({ parentWindow: parentSideWindow, childWindow: childSideWindow, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })
    const client = new IframeClientBootstrap({ ownWindow: childSideWindow, parentWindow: parentSideWindow, parentOrigin: PARENT_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })

    const receivedByHost: ChildToParentMessage[] = []
    host.onChildMessage((m) => receivedByHost.push(m))

    client.sendResize(640)
    await flush()

    expect((receivedByHost[0] as Extract<ChildToParentMessage, { type: 'resize' }>).payload.heightPx).toBe(640)

    host.dispose()
    client.dispose()
  })

  it('interaction: client sends interaction, host receives the target', async () => {
    const { parentSideWindow, childSideWindow } = createLinkedWindowPair()
    const host = new IframeHostBootstrap({ parentWindow: parentSideWindow, childWindow: childSideWindow, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })
    const client = new IframeClientBootstrap({ ownWindow: childSideWindow, parentWindow: parentSideWindow, parentOrigin: PARENT_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })

    const receivedByHost: ChildToParentMessage[] = []
    host.onChildMessage((m) => receivedByHost.push(m))

    client.sendInteraction('cta_upgrade')
    await flush()

    expect((receivedByHost[0] as Extract<ChildToParentMessage, { type: 'interaction' }>).payload.target).toBe('cta_upgrade')

    host.dispose()
    client.dispose()
  })

  it('error: client sends error, host receives the sanitized payload', async () => {
    const { parentSideWindow, childSideWindow } = createLinkedWindowPair()
    const host = new IframeHostBootstrap({ parentWindow: parentSideWindow, childWindow: childSideWindow, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })
    const client = new IframeClientBootstrap({ ownWindow: childSideWindow, parentWindow: parentSideWindow, parentOrigin: PARENT_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })

    const receivedByHost: ChildToParentMessage[] = []
    host.onChildMessage((m) => receivedByHost.push(m))

    client.sendError(buildSDKError('RATE_LIMITED'))
    await flush()

    const payload = (receivedByHost[0] as Extract<ChildToParentMessage, { type: 'error' }>).payload
    expect(payload.code).toBe('RATE_LIMITED')
    expect(payload.retryable).toBe(true)

    host.dispose()
    client.dispose()
  })

  it('invalid origin: a spoofed sender cannot inject messages into the client', async () => {
    const { parentSideWindow, childSideWindow, deliverToChildListeners } = createLinkedWindowPair()
    const client = new IframeClientBootstrap({ ownWindow: childSideWindow, parentWindow: parentSideWindow, parentOrigin: PARENT_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })

    const received: ParentToChildMessage[] = []
    client.onParentMessage((m) => received.push(m))

    // A well-formed, correctly-addressed message — but delivered as if it
    // arrived from an untrusted origin, exactly what a real browser reports
    // when some OTHER window (not the legitimate parent) calls postMessage
    // on this iframe's window.
    const spoofed = {
      data: {
        direction: 'parent_to_child', type: 'refresh_request', protocolVersion: '1.0.0',
        nonce: NONCE, widgetId: WIDGET_ID, timestamp: '2026-07-01T00:00:00.000Z', payload: {},
      },
      origin: 'https://evil.example.com',
    }
    deliverToChildListeners(spoofed)

    expect(received).toHaveLength(0)
    client.dispose()
  })

  it('malformed message: a well-addressed but schema-invalid message is rejected', async () => {
    const { parentSideWindow, childSideWindow, deliverToChildListeners } = createLinkedWindowPair()
    const client = new IframeClientBootstrap({ ownWindow: childSideWindow, parentWindow: parentSideWindow, parentOrigin: PARENT_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })

    const received: ParentToChildMessage[] = []
    client.onParentMessage((m) => received.push(m))

    deliverToChildListeners({ data: { direction: 'parent_to_child', type: 'init', protocolVersion: '1.0.0', nonce: NONCE, widgetId: WIDGET_ID, timestamp: '2026-07-01T00:00:00.000Z', payload: {} }, origin: PARENT_ORIGIN })

    expect(received).toHaveLength(0)
    client.dispose()
  })

  it('dispose: host disposing tears down the client too', async () => {
    const { parentSideWindow, childSideWindow } = createLinkedWindowPair()
    const host = new IframeHostBootstrap({ parentWindow: parentSideWindow, childWindow: childSideWindow, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })
    const client = new IframeClientBootstrap({ ownWindow: childSideWindow, parentWindow: parentSideWindow, parentOrigin: PARENT_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })

    expect(client.isDisposed).toBe(false)
    host.dispose()
    await flush()

    expect(client.isDisposed).toBe(true)
  })

  it('no credential leakage across a full init → ready → error round trip', async () => {
    const { parentSideWindow, childSideWindow } = createLinkedWindowPair()
    const host = new IframeHostBootstrap({ parentWindow: parentSideWindow, childWindow: childSideWindow, childOrigin: CHILD_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })
    const client = new IframeClientBootstrap({ ownWindow: childSideWindow, parentWindow: parentSideWindow, parentOrigin: PARENT_ORIGIN, widgetId: WIDGET_ID, nonce: NONCE })

    const allReceived: unknown[] = []
    host.onChildMessage((m) => allReceived.push(m))
    client.onParentMessage((m) => allReceived.push(m))

    host.sendInit(buildInitPayloadFromSdkConfig(makeSdkConfig()))
    await flush()
    client.sendReady(SDK_VERSION)
    await flush()
    client.sendError(buildSDKError('UNAUTHORIZED'))
    await flush()

    expect(JSON.stringify(allReceived)).not.toContain(SECRET)

    host.dispose()
    client.dispose()
  })
})
