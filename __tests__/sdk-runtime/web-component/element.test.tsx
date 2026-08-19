import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, waitFor, within } from '@testing-library/react'
import { AllFantasyWidgetElement } from '../../../sdk-runtime/web-component/src/AllFantasyWidgetElement'
import { defineAllFantasyWidgetElement } from '../../../sdk-runtime/web-component/src/register'
import type { RuntimeClock, RuntimeFetch, RuntimeFetchResponse, RuntimeTimerHandle } from '../../../sdk-runtime/core/src/index'
import { resolveSDKTheme } from '../../../lib/decision-os/sdk/theme'
import type { SDKAuth, SDKTheme } from '../../../lib/decision-os/sdk/types'

const SECRET_API_KEY = 'ak_web_component_test_secret_leak_check'
const SECRET_CREDENTIAL = 'tok_web_component_test_secret_leak_check'

let tagCounter = 0
/**
 * A single custom element CLASS can only ever be registered under ONE tag
 * name (the DOM spec throws `NotSupportedError` on a second `define()` for
 * an already-registered constructor, even under a different tag) — so each
 * test gets its own throwaway subclass rather than re-registering
 * `AllFantasyWidgetElement` itself. `instanceof AllFantasyWidgetElement`
 * still holds for every instance, since the subclass extends it and adds
 * no behavior of its own.
 */
function uniqueTag(): string {
  tagCounter += 1
  const tag = `allfantasy-widget-el-test-${tagCounter}`
  class TestAllFantasyWidgetElement extends AllFantasyWidgetElement {}
  customElements.define(tag, TestAllFantasyWidgetElement)
  return tag
}

function makeAuth(credential = SECRET_CREDENTIAL): SDKAuth {
  return { method: 'api_key', credential, tenantId: 'tenant_abc', expiresAt: null, scopes: ['intelligence:league:read'] }
}

function makeEnvelope(completeness = 100) {
  return {
    data: {
      entityId: 'league_123', entityType: 'league', healthScore: 82,
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

const VALID_ATTRS: Record<string, string> = {
  mode: 'commissioner',
  'entity-id': 'league_123',
  'entity-type': 'league',
  'tenant-id': 'tenant_abc',
  'base-url': 'https://api.allfantasy.test',
}

interface MakeElementOptions {
  attrs?: Record<string, string | null>
  fetchResponses?: Array<RuntimeFetchResponse | Error>
  skipCredentials?: boolean
  authCredential?: string
  apiKey?: string
}

function makeElement(options: MakeElementOptions = {}) {
  const tag = uniqueTag()
  const el = document.createElement(tag) as AllFantasyWidgetElement
  el.shadowMode = 'open'

  const attrs = { ...VALID_ATTRS, ...(options.attrs ?? {}) }
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null) continue
    el.setAttribute(name, value)
  }

  const { fetchImpl, callCount } = makeQueueFetch(options.fetchResponses ?? [makeFakeResponse(200, makeEnvelope())])
  el.fetchImpl = fetchImpl
  el.clock = makeRealClock()

  if (!options.skipCredentials) {
    el.setCredentials(makeAuth(options.authCredential ?? SECRET_CREDENTIAL), options.apiKey ?? SECRET_API_KEY)
  }

  return { el, callCount }
}

const mountedHosts: HTMLElement[] = []

afterEach(() => {
  for (const el of mountedHosts.splice(0)) el.remove()
})

async function connect(el: AllFantasyWidgetElement): Promise<void> {
  await act(async () => {
    document.body.appendChild(el)
  })
  mountedHosts.push(el)
}

async function setAttr(el: AllFantasyWidgetElement, name: string, value: string): Promise<void> {
  await act(async () => {
    el.setAttribute(name, value)
  })
}

async function disconnect(el: AllFantasyWidgetElement): Promise<void> {
  await act(async () => {
    el.remove()
  })
}

function shadow(el: AllFantasyWidgetElement): ShadowRoot {
  const root = el.shadowRoot
  if (!root) throw new Error('expected an open shadow root for test inspection')
  return root
}

describe('AllFantasyWidgetElement — mount', () => {
  it('registers as a custom element and instantiates via document.createElement', () => {
    const { el } = makeElement()
    expect(el).toBeInstanceOf(AllFantasyWidgetElement)
    expect(el).toBeInstanceOf(HTMLElement)
  })

  it('fetches and renders presentation data once connected', async () => {
    const { el, callCount } = makeElement()
    await connect(el)

    await waitFor(() => {
      within(shadow(el)).getByText('82')
    })
    expect(callCount()).toBe(1)
  })

  it('attaches a shadow root and mounts a marked container inside it', async () => {
    const { el } = makeElement()
    await connect(el)
    const container = shadow(el).querySelector('[data-allfantasy-widget-root]')
    expect(container).not.toBeNull()
  })

  it('defaults to a closed shadow root when shadowMode is not overridden', async () => {
    const tag = uniqueTag()
    const el = document.createElement(tag) as AllFantasyWidgetElement
    for (const [name, value] of Object.entries(VALID_ATTRS)) el.setAttribute(name, value)
    el.fetchImpl = makeQueueFetch([makeFakeResponse(200, makeEnvelope())]).fetchImpl
    el.clock = makeRealClock()
    el.setCredentials(makeAuth(), SECRET_API_KEY)
    await connect(el)
    expect(el.shadowRoot).toBeNull()
  })
})

describe('AllFantasyWidgetElement — unmount / safe teardown', () => {
  it('clears shadow content on disconnect', async () => {
    const { el } = makeElement()
    await connect(el)
    await waitFor(() => within(shadow(el)).getByText('82'))

    const root = shadow(el)
    await disconnect(el)
    expect(root.childNodes.length).toBe(0)
  })

  it('does not trigger further fetches after disconnect even if attributes still mutate', async () => {
    const { el, callCount } = makeElement()
    await connect(el)
    await waitFor(() => expect(callCount()).toBe(1))
    await disconnect(el)

    // attributeChangedCallback still fires (attribute IS observed) but must
    // no-op while disconnected.
    el.setAttribute('entity-id', 'league_999')
    expect(callCount()).toBe(1)
  })

  it('is safe to disconnect twice in a row', async () => {
    const { el } = makeElement()
    await connect(el)
    await waitFor(() => within(shadow(el)).getByText('82'))
    await disconnect(el)
    await expect(disconnect(el)).resolves.not.toThrow()
  })

  it('reconnecting after a disconnect renders again without re-attaching the shadow root (no double-attachShadow error)', async () => {
    const { el, callCount } = makeElement()
    await connect(el)
    await waitFor(() => expect(callCount()).toBe(1))
    await disconnect(el)

    await expect(connect(el)).resolves.not.toThrow()
    await waitFor(() => within(shadow(el)).getByText('82'))
    expect(callCount()).toBe(2)
  })
})

describe('AllFantasyWidgetElement — attribute parsing', () => {
  it('renders a config-error fallback and never fetches when a required attribute is missing', async () => {
    const { el, callCount } = makeElement({ attrs: { 'entity-id': null } })
    const events: unknown[] = []
    el.addEventListener('af-widget-error', (e) => events.push((e as CustomEvent).detail))

    await connect(el)

    const errorEl = shadow(el).querySelector('[data-widget-state="error"]')
    expect(errorEl).not.toBeNull()
    expect(callCount()).toBe(0)
    expect(events.length).toBe(1)
    expect(el.configErrors.some((e) => e.includes('entity-id'))).toBe(true)
  })

  it('rejects a non-numeric rate-limit-per-minute attribute before ever fetching', async () => {
    const { el, callCount } = makeElement({ attrs: { 'rate-limit-per-minute': 'not-a-number' } })
    await connect(el)
    expect(shadow(el).querySelector('[data-widget-state="error"]')).not.toBeNull()
    expect(callCount()).toBe(0)
  })
})

describe('AllFantasyWidgetElement — config validation', () => {
  it('renders a config-error fallback for an entityType invalid for the given mode', async () => {
    const { el, callCount } = makeElement({ attrs: { mode: 'manager', 'entity-type': 'league' } })
    await connect(el)
    expect(shadow(el).querySelector('[data-widget-state="error"]')).not.toBeNull()
    expect(callCount()).toBe(0)
    expect(el.configErrors.some((e) => e.includes('entityType'))).toBe(true)
  })

  it('renders a config-error fallback when credentials were never set', async () => {
    const { el, callCount } = makeElement({ skipCredentials: true })
    await connect(el)
    expect(shadow(el).querySelector('[data-widget-state="error"]')).not.toBeNull()
    expect(callCount()).toBe(0)
  })
})

describe('AllFantasyWidgetElement — lifecycle (attributeChangedCallback)', () => {
  it('refetches when an entity-identity attribute changes', async () => {
    const { el, callCount } = makeElement()
    await connect(el)
    await waitFor(() => expect(callCount()).toBe(1))

    await setAttr(el, 'entity-id', 'league_456')
    await waitFor(() => expect(callCount()).toBe(2))
  })

  it('does not refetch when a non-identity attribute (theme-mode) changes, but does re-render with the new palette', async () => {
    const { el, callCount } = makeElement()
    await connect(el)
    await waitFor(() => within(shadow(el)).getByText('82'))
    expect(callCount()).toBe(1)

    // No theme-mode attribute set → defaults to 'light' (attributes.ts).
    const before = shadow(el).querySelector('[data-widget-state="ready"]') as HTMLElement
    expect(before.style.background).toBe('rgba(15, 23, 42, 0.04)')

    await setAttr(el, 'theme-mode', 'dark')
    await waitFor(() => {
      const after = shadow(el).querySelector('[data-widget-state="ready"]') as HTMLElement
      expect(after.style.background).toBe('rgba(255, 255, 255, 0.06)')
    })
    expect(callCount()).toBe(1)
  })

  it('setting an attribute to the same value does not trigger a re-render pass', async () => {
    const { el, callCount } = makeElement()
    await connect(el)
    await waitFor(() => expect(callCount()).toBe(1))

    await setAttr(el, 'entity-id', 'league_123')
    expect(callCount()).toBe(1)
  })
})

describe('AllFantasyWidgetElement — refresh()', () => {
  it('calling refresh() triggers another fetch once ready', async () => {
    const { el, callCount } = makeElement()
    await connect(el)
    await waitFor(() => expect(callCount()).toBe(1))

    await act(async () => {
      await el.refresh()
    })
    expect(callCount()).toBe(2)
  })

  it('calling refresh() before the widget has ever rendered is a safe no-op', async () => {
    const tag = uniqueTag()
    const el = document.createElement(tag) as AllFantasyWidgetElement
    await expect(el.refresh()).resolves.toBeUndefined()
  })
})

describe('AllFantasyWidgetElement — error/degraded states', () => {
  it('dispatches af-widget-degraded when completeness < 100', async () => {
    const { el } = makeElement({ fetchResponses: [makeFakeResponse(200, makeEnvelope(60))] })
    let degraded = false
    el.addEventListener('af-widget-degraded', () => { degraded = true })

    await connect(el)
    await waitFor(() => expect(degraded).toBe(true))
    expect(shadow(el).querySelector('[data-widget-degraded="true"]')).not.toBeNull()
  })

  it('dispatches af-widget-error with a sanitized detail on a network failure', async () => {
    const { el } = makeElement({ fetchResponses: [new Error('network down')] })
    let detail: Record<string, unknown> | null = null
    el.addEventListener('af-widget-error', (e) => { detail = (e as CustomEvent).detail })

    await connect(el)
    await waitFor(() => expect(detail).not.toBeNull())
    expect(Object.keys(detail as object).sort()).toEqual(['code', 'message', 'retryable', 'timestamp', 'widgetId'])
  })

  it('dispatches af-widget-ready once the widget reaches the ready state', async () => {
    const { el } = makeElement()
    let ready = false
    el.addEventListener('af-widget-ready', () => { ready = true })

    await connect(el)
    await waitFor(() => expect(ready).toBe(true))
  })
})

describe('AllFantasyWidgetElement — no credential leakage', () => {
  it('never puts the credential or apiKey in an HTML attribute', async () => {
    const { el } = makeElement()
    await connect(el)
    await waitFor(() => within(shadow(el)).getByText('82'))

    expect(el.outerHTML).not.toContain(SECRET_API_KEY)
    expect(el.outerHTML).not.toContain(SECRET_CREDENTIAL)
    for (const name of el.getAttributeNames()) {
      expect(name.toLowerCase()).not.toContain('key')
      expect(name.toLowerCase()).not.toContain('credential')
    }
  })

  it('never puts the credential or apiKey in rendered shadow content', async () => {
    const { el } = makeElement()
    await connect(el)
    await waitFor(() => within(shadow(el)).getByText('82'))

    expect(shadow(el).innerHTML).not.toContain(SECRET_API_KEY)
    expect(shadow(el).innerHTML).not.toContain(SECRET_CREDENTIAL)
  })

  it('never puts the credential or apiKey in a dispatched af-widget-error detail', async () => {
    const { el } = makeElement({ fetchResponses: [new Error('network down')] })
    let detail: unknown = null
    el.addEventListener('af-widget-error', (e) => { detail = (e as CustomEvent).detail })

    await connect(el)
    await waitFor(() => expect(detail).not.toBeNull())

    const serialized = JSON.stringify(detail)
    expect(serialized).not.toContain(SECRET_API_KEY)
    expect(serialized).not.toContain(SECRET_CREDENTIAL)
  })

  it('the auth/apiKey getters only ever return what the host itself supplied — never derived from an attribute', async () => {
    const { el } = makeElement()
    expect(el.apiKey).toBe(SECRET_API_KEY)
    expect(el.auth?.credential).toBe(SECRET_CREDENTIAL)
    // Structural guarantee: OBSERVED_ATTRIBUTES (attribute-changed triggers)
    // has no credential-shaped entry, so no attribute mutation could ever
    // populate these getters.
    expect(AllFantasyWidgetElement.observedAttributes.some((n) => n.toLowerCase().includes('key'))).toBe(false)
  })
})

describe('AllFantasyWidgetElement — theme (Phase 7.18)', () => {
  function makePartnerTheme(overrides: SDKTheme['tokens']['colorTokenMap']): SDKTheme {
    const base = resolveSDKTheme('partner_override', {}, 'partner_acme')
    return { ...base, tokens: { ...base.tokens, colorTokenMap: overrides } }
  }

  it('setting the theme property before connecting renders with the partner override', async () => {
    const { el } = makeElement()
    el.theme = makePartnerTheme({ surface: '#101010' })
    await connect(el)
    await waitFor(() => within(shadow(el)).getByText('82'))

    const ready = shadow(el).querySelector('[data-widget-state="ready"]') as HTMLElement
    expect(ready.style.background).toBe('rgb(16, 16, 16)')
  })

  it('setting the theme property after connecting triggers a re-render with the override, without a refetch', async () => {
    const { el, callCount } = makeElement()
    await connect(el)
    await waitFor(() => within(shadow(el)).getByText('82'))
    expect(callCount()).toBe(1)

    await act(async () => {
      el.theme = makePartnerTheme({ surface: '#202020' })
    })

    await waitFor(() => {
      const ready = shadow(el).querySelector('[data-widget-state="ready"]') as HTMLElement
      expect(ready.style.background).toBe('rgb(32, 32, 32)')
    })
    expect(callCount()).toBe(1)
  })

  it('the theme getter returns exactly what was set', async () => {
    const { el } = makeElement()
    const theme = makePartnerTheme({ accent: '#0a84ff' })
    el.theme = theme
    expect(el.theme).toBe(theme)
  })

  it('an invalid theme-mode attribute falls back to the light default rather than throwing', async () => {
    const { el, callCount } = makeElement({ attrs: { 'theme-mode': 'not-a-real-mode' } })
    await connect(el)
    await waitFor(() => within(shadow(el)).getByText('82'))
    expect(callCount()).toBe(1)

    const ready = shadow(el).querySelector('[data-widget-state="ready"]') as HTMLElement
    // DEFAULT_COLOR_HEX_LIGHT.surface, jsdom-normalized.
    expect(ready.style.background).toBe('rgba(15, 23, 42, 0.04)')
  })
})

describe('AllFantasyWidgetElement — default runtime deps', () => {
  it('uses the real global fetch when fetchImpl is not overridden', async () => {
    const tag = uniqueTag()
    const el = document.createElement(tag) as AllFantasyWidgetElement
    el.shadowMode = 'open'
    for (const [name, value] of Object.entries(VALID_ATTRS)) el.setAttribute(name, value)
    el.setCredentials(makeAuth(), SECRET_API_KEY)

    const originalFetch = globalThis.fetch
    const mockFetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => makeEnvelope(),
    })) as unknown as typeof globalThis.fetch
    globalThis.fetch = mockFetch

    try {
      await connect(el)
      await waitFor(() => within(shadow(el)).getByText('82'))
      expect(mockFetch).toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('defineAllFantasyWidgetElement integration', () => {
  it('an element registered via the convenience helper behaves identically to a directly-defined one', async () => {
    const tag = `allfantasy-widget-register-integration-${++tagCounter}`
    defineAllFantasyWidgetElement(tag)
    const el = document.createElement(tag) as AllFantasyWidgetElement
    el.shadowMode = 'open'
    for (const [name, value] of Object.entries(VALID_ATTRS)) el.setAttribute(name, value)
    el.fetchImpl = makeQueueFetch([makeFakeResponse(200, makeEnvelope())]).fetchImpl
    el.clock = makeRealClock()
    el.setCredentials(makeAuth(), SECRET_API_KEY)

    await connect(el)
    await waitFor(() => within(shadow(el)).getByText('82'))
  })
})
