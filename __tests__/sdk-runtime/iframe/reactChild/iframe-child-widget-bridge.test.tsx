import { afterEach, describe, expect, it } from 'vitest'
import { act, waitFor, within } from '@testing-library/react'
import { mountReactIframeChildBridge } from '../../../../sdk-runtime/iframe/src/reactChild/index'
import type { ReactIframeChildBridgeConfig } from '../../../../sdk-runtime/iframe/src/reactChild/index'
import { buildParentToChildMessage, buildIframeWidgetUrl } from '../../../../sdk-runtime/iframe/src/index'
import type { BrowserWindowSource } from '../../../../sdk-runtime/iframe/src/browser/windowBridge'
import { resolveSDKTheme } from '../../../../lib/decision-os/sdk/index'
import type { SDKAuth } from '../../../../lib/decision-os/sdk/types'
import type { WidgetTenantConfig } from '../../../../lib/decision-os/presentation/widget-contracts'
import type { RuntimeFetch, RuntimeFetchResponse, RuntimeClock, RuntimeTimerHandle } from '../../../../sdk-runtime/core/src/index'

const WIDGET_ID = 'widget_league_001_commissioner'
const NONCE = 'n0nce_abcdef123456'
const PARENT_ORIGIN = 'https://partner.example.com'
const BASE_SRC = 'https://widgets.allfantasy.app/embed'
const SECRET = 'tok_react_iframe_test_secret_leak_check'

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

function deliverToOwn(ownWindowMock: ReturnType<typeof makeMockBrowserWindow>, data: unknown, origin = PARENT_ORIGIN): void {
  ownWindowMock.listeners[0]({ data, origin } as MessageEvent)
}

function makeAuth(): SDKAuth {
  return { method: 'signed_embed_token', credential: SECRET, tenantId: 'tenant_001', expiresAt: null, scopes: ['intelligence:league:read'] }
}

function makeTenantConfig(): WidgetTenantConfig {
  return {
    tenantId: 'tenant_001', apiKey: SECRET, allowedOrigins: [PARENT_ORIGIN], rateLimitPerMinute: 60,
    featureFlags: { enableBenchmarkComparison: true, enableArchetypeLabel: true, enableBehavioralPatterns: true, enableCompanyIntelligence: false },
    whiteLabelPlatform: null,
  }
}

function makeInitPayload() {
  return {
    widgetMode: 'commissioner' as const, entityId: 'league_001', entityType: 'league' as const,
    theme: resolveSDKTheme('light'),
    locale: { locale: 'en-US' as const, fallbackLocale: 'en-US' as const, numberFormat: 'western' as const, dateFormat: 'MDY' as const },
    presentationVersion: '7.0.0',
  }
}

function makeEnvelope(completeness = 100) {
  return {
    data: {
      entityId: 'league_001', entityType: 'league', healthScore: 82,
      healthSeverity: { token: 'positive', priority: 5, displayColorToken: 'success', iconToken: 'check', animationToken: 'none' },
      archetype: 'balanced_league', archetypeLabel: 'Balanced League',
      retentionRisk: 'low', engagementTier: 'active',
      badges: [], topRecommendations: [], metrics: [], benchmarkSummary: null,
      completeness, version: '7.0.0',
    },
    meta: {
      requestId: 'req_1', derivedAt: '2026-07-01T00:00:00.000Z', completeness,
      version: 'v1', tier: 'commissioner', view: 'presentation' as const, presentationVersion: '7.0.0',
    },
  }
}

function makeFakeResponse(status: number, body: unknown): RuntimeFetchResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

function makeQueueFetch(responses: Array<RuntimeFetchResponse | Error>): { fetchImpl: RuntimeFetch; callCount: () => number } {
  let i = 0
  let calls = 0
  const fetchImpl: RuntimeFetch = async () => {
    calls++
    const entry = responses[Math.min(i, responses.length - 1)]
    if (i < responses.length - 1) i++
    if (entry instanceof Error) throw entry
    return entry
  }
  return { fetchImpl, callCount: () => calls }
}

function makeRealClock(): RuntimeClock {
  return {
    now: () => Date.now(),
    setTimeout: (cb, ms) => setTimeout(cb, ms) as unknown as RuntimeTimerHandle,
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }
}

function makeLocationSearch(): string {
  const url = buildIframeWidgetUrl({ baseSrc: BASE_SRC, widgetId: WIDGET_ID, nonce: NONCE, parentOrigin: PARENT_ORIGIN })
  return url.slice(BASE_SRC.length)
}

interface Harness {
  config: ReactIframeChildBridgeConfig
  ownWindow: ReturnType<typeof makeMockBrowserWindow>
  parentWindow: ReturnType<typeof makeMockBrowserWindow>
  container: HTMLElement
  callCount: () => number
}

const mountedContainers: HTMLElement[] = []

afterEach(() => {
  for (const el of mountedContainers.splice(0)) {
    el.remove()
  }
})

function makeHarness(fetchResponses: Array<RuntimeFetchResponse | Error> = [makeFakeResponse(200, makeEnvelope())]): Harness {
  const ownWindow = makeMockBrowserWindow()
  const parentWindow = makeMockBrowserWindow()
  // toBeInTheDocument() checks document.contains(element) — the container
  // must be attached to a live document, not just created, for that
  // assertion (and waitFor's polling) to work correctly.
  const container = document.createElement('div')
  document.body.appendChild(container)
  mountedContainers.push(container)
  const { fetchImpl, callCount } = makeQueueFetch(fetchResponses)

  const config: ReactIframeChildBridgeConfig = {
    auth: makeAuth(),
    tenantConfig: makeTenantConfig(),
    baseUrl: 'https://api.allfantasy.test',
    fetchImpl,
    clock: makeRealClock(),
    container,
    locationSearch: makeLocationSearch(),
    ownWindow: ownWindow.source,
    parentWindow: parentWindow.source,
  }

  return { config, ownWindow, parentWindow, container, callCount }
}

async function mountAndDeliverInit(harness: Harness): Promise<ReturnType<typeof mountReactIframeChildBridge>> {
  let mounted!: ReturnType<typeof mountReactIframeChildBridge>
  await act(async () => {
    mounted = mountReactIframeChildBridge(harness.config)
  })
  await act(async () => {
    deliverToOwn(harness.ownWindow, buildParentToChildMessage('init', WIDGET_ID, NONCE, makeInitPayload()))
  })
  return mounted
}

// ── Handshake → render ─────────────────────────────────────────────────────────

describe('mountReactIframeChildBridge — handshake → render', () => {
  it('sends ready immediately on mount, before init arrives', async () => {
    const harness = makeHarness()
    await act(async () => {
      mountReactIframeChildBridge(harness.config)
    })

    expect(harness.parentWindow.sent.some((s) => (s.message as { type: string }).type === 'ready')).toBe(true)
  })

  it('renders nothing until init arrives', async () => {
    const harness = makeHarness()
    await act(async () => {
      mountReactIframeChildBridge(harness.config)
    })

    expect(harness.container.textContent).toBe('')
  })

  it('after init arrives, fetches and renders the presentation data', async () => {
    const harness = makeHarness()
    await mountAndDeliverInit(harness)

    await waitFor(() => {
      expect(within(harness.container).getByText('82')).toBeInTheDocument()
    })
  })
})

// ── Refresh ───────────────────────────────────────────────────────────────────

describe('mountReactIframeChildBridge — refresh request handling', () => {
  it('a refresh_request from the parent triggers a new fetch', async () => {
    const harness = makeHarness([makeFakeResponse(200, makeEnvelope()), makeFakeResponse(200, makeEnvelope())])
    await mountAndDeliverInit(harness)
    await waitFor(() => expect(within(harness.container).getByText('82')).toBeInTheDocument())

    expect(harness.callCount()).toBe(1)
    await act(async () => {
      deliverToOwn(harness.ownWindow, buildParentToChildMessage('refresh_request', WIDGET_ID, NONCE, {}))
    })

    await waitFor(() => expect(harness.callCount()).toBe(2))
  })

  it('clicking the in-widget refresh button reports an interaction AND refreshes', async () => {
    const harness = makeHarness([makeFakeResponse(200, makeEnvelope()), makeFakeResponse(200, makeEnvelope())])
    await mountAndDeliverInit(harness)
    await waitFor(() => expect(within(harness.container).getByText('82')).toBeInTheDocument())

    const button = within(harness.container).getByText('Refresh')
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => expect(harness.callCount()).toBe(2))
    expect(harness.parentWindow.sent.some((s) => (s.message as { type: string; payload: { target: string } }).type === 'interaction' && (s.message as { payload: { target: string } }).payload.target === 'refresh_button')).toBe(true)
  })
})

// ── Theme update ───────────────────────────────────────────────────────────────

describe('mountReactIframeChildBridge — theme update handling', () => {
  it('the init payload\'s theme (light) is applied to the initial render', async () => {
    const harness = makeHarness()
    await mountAndDeliverInit(harness)
    await waitFor(() => expect(within(harness.container).getByText('82')).toBeInTheDocument())

    const el = harness.container.querySelector('[data-widget-state="ready"]') as HTMLElement
    // DEFAULT_COLOR_HEX_LIGHT.surface — makeInitPayload() carries theme: resolveSDKTheme('light').
    expect(el.style.background).toBe('rgba(15, 23, 42, 0.04)')
  })

  it('a theme_update from the parent re-renders with the new theme\'s palette', async () => {
    const harness = makeHarness()
    await mountAndDeliverInit(harness)
    await waitFor(() => expect(within(harness.container).getByText('82')).toBeInTheDocument())

    await act(async () => {
      deliverToOwn(harness.ownWindow, buildParentToChildMessage('theme_update', WIDGET_ID, NONCE, { theme: resolveSDKTheme('dark') }))
    })

    await waitFor(() => {
      const el = harness.container.querySelector('[data-widget-state="ready"]') as HTMLElement
      // DEFAULT_COLOR_HEX_DARK.surface — distinct from the light palette's surface value above.
      expect(el.style.background).toBe('rgba(255, 255, 255, 0.06)')
    })
  })

  it('a partner_override theme_update applies the partner\'s color overrides and surfaces partnerBrandId', async () => {
    const harness = makeHarness()
    await mountAndDeliverInit(harness)
    await waitFor(() => expect(within(harness.container).getByText('82')).toBeInTheDocument())

    const base = resolveSDKTheme('partner_override', {}, 'partner_acme')
    const partnerTheme = { ...base, tokens: { ...base.tokens, colorTokenMap: { surface: '#101010' } } }

    await act(async () => {
      deliverToOwn(harness.ownWindow, buildParentToChildMessage('theme_update', WIDGET_ID, NONCE, { theme: partnerTheme }))
    })

    await waitFor(() => {
      const el = harness.container.querySelector('[data-widget-state="ready"]') as HTMLElement
      expect(el.style.background).toBe('rgb(16, 16, 16)')
    })
    expect(harness.container.querySelector('[data-partner-brand-id="partner_acme"]')).not.toBeNull()
  })
})

// ── Error ─────────────────────────────────────────────────────────────────────

describe('mountReactIframeChildBridge — error handling', () => {
  it('a fetch failure results in an error message posted to the parent', async () => {
    const harness = makeHarness([makeFakeResponse(401, {})])
    await mountAndDeliverInit(harness)

    await waitFor(() => {
      expect(harness.parentWindow.sent.some((s) => (s.message as { type: string }).type === 'error')).toBe(true)
    })
  })

  it('the error message carries a sanitized payload (code/message/retryable only)', async () => {
    const harness = makeHarness([makeFakeResponse(401, {})])
    await mountAndDeliverInit(harness)

    await waitFor(() => {
      const errorMsg = harness.parentWindow.sent.find((s) => (s.message as { type: string }).type === 'error')
      expect(errorMsg).toBeDefined()
      const payload = (errorMsg!.message as { payload: { code: string; message: string; retryable: boolean } }).payload
      expect(payload.code).toBe('UNAUTHORIZED')
      expect(Object.keys(payload).sort()).toEqual(['code', 'message', 'retryable'])
    })
  })
})

// ── Resize ────────────────────────────────────────────────────────────────────

describe('mountReactIframeChildBridge — resize helper', () => {
  it('sends a resize message once the widget renders', async () => {
    const harness = makeHarness()
    await mountAndDeliverInit(harness)

    await waitFor(() => {
      expect(harness.parentWindow.sent.some((s) => (s.message as { type: string }).type === 'resize')).toBe(true)
    })
  })
})

// ── Dispose ───────────────────────────────────────────────────────────────────

describe('mountReactIframeChildBridge — dispose handling', () => {
  it('receiving dispose from the parent unmounts the React tree and calls onDisposed', async () => {
    const harness = makeHarness()
    let disposedCalled = false
    harness.config.onDisposed = () => { disposedCalled = true }

    await mountAndDeliverInit(harness)
    await waitFor(() => expect(within(harness.container).getByText('82')).toBeInTheDocument())

    await act(async () => {
      deliverToOwn(harness.ownWindow, buildParentToChildMessage('dispose', WIDGET_ID, NONCE, {}))
    })

    expect(disposedCalled).toBe(true)
    expect(harness.container.textContent).toBe('')
  })

  it('calling unmount() directly tears everything down without a received message', async () => {
    const harness = makeHarness()
    const mounted = await mountAndDeliverInit(harness)
    await waitFor(() => expect(within(harness.container).getByText('82')).toBeInTheDocument())

    await act(async () => {
      mounted.unmount()
    })

    expect(harness.container.textContent).toBe('')
  })
})

// ── No credential leakage ─────────────────────────────────────────────────────

describe('mountReactIframeChildBridge — no credential leakage', () => {
  it('nothing posted to the parent across a full handshake+render+error round trip ever contains the credential', async () => {
    const harness = makeHarness([makeFakeResponse(401, {})])
    await mountAndDeliverInit(harness)

    await waitFor(() => {
      expect(harness.parentWindow.sent.some((s) => (s.message as { type: string }).type === 'error')).toBe(true)
    })

    expect(JSON.stringify(harness.parentWindow.sent)).not.toContain(SECRET)
  })

  it('the rendered DOM never contains the credential', async () => {
    const harness = makeHarness()
    await mountAndDeliverInit(harness)
    await waitFor(() => expect(within(harness.container).getByText('82')).toBeInTheDocument())

    expect(harness.container.innerHTML).not.toContain(SECRET)
  })
})
