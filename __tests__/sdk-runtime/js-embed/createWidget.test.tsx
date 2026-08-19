import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, waitFor, within } from '@testing-library/react'
import { createAllFantasyWidget } from '../../../sdk-runtime/js-embed/src/createWidget'
import type { CreateWidgetOptions } from '../../../sdk-runtime/js-embed/src/types'
import type { JsEmbedWidgetConfig } from '../../../sdk-runtime/js-embed/src/types'
import type { RuntimeClock, RuntimeFetch, RuntimeFetchResponse, RuntimeTimerHandle } from '../../../sdk-runtime/core/src/index'
import { resolveSDKTheme } from '../../../lib/decision-os/sdk/theme'
import type { SDKAuth, SDKTheme } from '../../../lib/decision-os/sdk/types'

const SECRET_API_KEY = 'ak_js_embed_test_secret_leak_check'
const SECRET_CREDENTIAL = 'tok_js_embed_test_secret_leak_check'

function makeAuth(credential = SECRET_CREDENTIAL): SDKAuth {
  return { method: 'api_key', credential, tenantId: 'tenant_abc', expiresAt: null, scopes: ['intelligence:league:read'] }
}

function makeConfig(overrides: Partial<JsEmbedWidgetConfig> = {}): JsEmbedWidgetConfig {
  return {
    mode: 'commissioner',
    entityId: 'league_123',
    entityType: 'league',
    tenantConfig: {
      tenantId: 'tenant_abc',
      allowedOrigins: [],
      rateLimitPerMinute: 60,
      featureFlags: {
        enableBenchmarkComparison: false,
        enableArchetypeLabel: false,
        enableBehavioralPatterns: false,
        enableCompanyIntelligence: false,
      },
      whiteLabelPlatform: null,
    },
    presentationVersion: '7.0.0',
    ...overrides,
  }
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

const mountedContainers: HTMLElement[] = []
afterEach(() => {
  for (const el of mountedContainers.splice(0)) el.remove()
})

function makeContainer(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  mountedContainers.push(el)
  return el
}

interface MakeOptionsExtra {
  fetchResponses?: Array<RuntimeFetchResponse | Error>
  onReady?: CreateWidgetOptions['onReady']
  onDegraded?: CreateWidgetOptions['onDegraded']
  onError?: CreateWidgetOptions['onError']
  onInteraction?: CreateWidgetOptions['onInteraction']
}

function makeOptions(container: unknown, overrides: Partial<CreateWidgetOptions> = {}, extra: MakeOptionsExtra = {}): { options: CreateWidgetOptions; callCount: () => number } {
  const { fetchImpl, callCount } = makeQueueFetch(extra.fetchResponses ?? [makeFakeResponse(200, makeEnvelope())])
  const options: CreateWidgetOptions = {
    container,
    config: makeConfig(),
    auth: makeAuth(),
    apiKey: SECRET_API_KEY,
    baseUrl: 'https://api.allfantasy.test',
    fetchImpl,
    clock: makeRealClock(),
    onReady: extra.onReady,
    onDegraded: extra.onDegraded,
    onError: extra.onError,
    onInteraction: extra.onInteraction,
    ...overrides,
  }
  return { options, callCount }
}

async function createAsync(options: CreateWidgetOptions) {
  let instance!: ReturnType<typeof createAllFantasyWidget>
  await act(async () => {
    instance = createAllFantasyWidget(options)
  })
  return instance
}

describe('createAllFantasyWidget — create + mount', () => {
  it('fetches and renders presentation data on creation (mount is automatic)', async () => {
    const container = makeContainer()
    const { options, callCount } = makeOptions(container)
    await createAsync(options)

    await waitFor(() => {
      within(container).getByText('82')
    })
    expect(callCount()).toBe(1)
  })

  it('returns an instance with mount/unmount/refresh and read-only state getters', async () => {
    const container = makeContainer()
    const { options } = makeOptions(container)
    const instance = await createAsync(options)

    expect(typeof instance.mount).toBe('function')
    expect(typeof instance.unmount).toBe('function')
    expect(typeof instance.refresh).toBe('function')
    await waitFor(() => expect(instance.renderState).toBe('ready'))
    expect(instance.configErrors).toEqual([])
  })
})

describe('createAllFantasyWidget — invalid container', () => {
  it('throws synchronously for a null container', () => {
    const { options } = makeOptions(null)
    expect(() => createAllFantasyWidget(options)).toThrow(/container/i)
  })

  it('throws synchronously for a non-Element container', () => {
    const { options } = makeOptions({ notReallyAnElement: true })
    expect(() => createAllFantasyWidget(options)).toThrow(/DOM Element/i)
  })

  it('throws when the container already has another AllFantasy widget mounted', async () => {
    const container = makeContainer()
    const { options: firstOptions } = makeOptions(container)
    await createAsync(firstOptions)

    const { options: secondOptions } = makeOptions(container)
    expect(() => createAllFantasyWidget(secondOptions)).toThrow(/already has an AllFantasy widget mounted/)
  })

  it('mounting into the same container again after unmount succeeds', async () => {
    const container = makeContainer()
    const { options: firstOptions } = makeOptions(container)
    const first = await createAsync(firstOptions)
    await act(async () => {
      first.unmount()
    })

    const { options: secondOptions, callCount } = makeOptions(container)
    await createAsync(secondOptions)
    await waitFor(() => expect(callCount()).toBe(1))
  })
})

describe('createAllFantasyWidget — invalid config', () => {
  it('renders a config-error fallback into the container and never fetches for a semantically invalid config', async () => {
    const container = makeContainer()
    const errors: unknown[] = []
    const { options, callCount } = makeOptions(
      container,
      { config: makeConfig({ mode: 'manager', entityType: 'league' }) },
      { onError: (e) => errors.push(e) },
    )
    const instance = await createAsync(options)

    expect(container.querySelector('[data-widget-state="error"]')).not.toBeNull()
    expect(callCount()).toBe(0)
    expect(instance.configErrors.some((e) => e.includes('entityType'))).toBe(true)
    expect(errors.length).toBe(1)
  })

  it('renders a config-error fallback for a malformed (non-TypeScript-shaped) config without throwing', async () => {
    const container = makeContainer()
    const { options, callCount } = makeOptions(container, {
      config: { mode: 'commissioner' } as unknown as JsEmbedWidgetConfig,
    })
    const instance = await createAsync(options)

    expect(container.querySelector('[data-widget-state="error"]')).not.toBeNull()
    expect(callCount()).toBe(0)
    expect(instance.configErrors.length).toBeGreaterThan(0)
  })

  it('renders a config-error fallback for an invalid auth (missing credential)', async () => {
    const container = makeContainer()
    const { options, callCount } = makeOptions(container, { auth: { ...makeAuth(), credential: null } })
    const instance = await createAsync(options)

    expect(container.querySelector('[data-widget-state="error"]')).not.toBeNull()
    expect(callCount()).toBe(0)
    expect(instance.configErrors.some((e) => e.includes('credential'))).toBe(true)
  })

  it('rejects a missing apiKey', async () => {
    const container = makeContainer()
    const { options, callCount } = makeOptions(container, { apiKey: '' })
    const instance = await createAsync(options)

    expect(container.querySelector('[data-widget-state="error"]')).not.toBeNull()
    expect(callCount()).toBe(0)
    expect(instance.configErrors.some((e) => e.includes('apiKey'))).toBe(true)
  })
})

describe('createAllFantasyWidget — unmount / safe teardown', () => {
  it('clears the container on unmount', async () => {
    const container = makeContainer()
    const { options } = makeOptions(container)
    const instance = await createAsync(options)
    await waitFor(() => within(container).getByText('82'))

    await act(async () => {
      instance.unmount()
    })
    expect(container.innerHTML).toBe('')
  })

  it('is safe to unmount twice in a row', async () => {
    const container = makeContainer()
    const { options } = makeOptions(container)
    const instance = await createAsync(options)
    await waitFor(() => within(container).getByText('82'))

    await act(async () => {
      instance.unmount()
    })
    expect(() => instance.unmount()).not.toThrow()
  })

  it('resets renderState to null after unmount', async () => {
    const container = makeContainer()
    const { options } = makeOptions(container)
    const instance = await createAsync(options)
    await waitFor(() => expect(instance.renderState).toBe('ready'))

    await act(async () => {
      instance.unmount()
    })
    expect(instance.renderState).toBeNull()
  })

  it('calling mount() again after unmount() re-renders and re-fetches', async () => {
    const container = makeContainer()
    const { options, callCount } = makeOptions(container)
    const instance = await createAsync(options)
    await waitFor(() => expect(callCount()).toBe(1))

    await act(async () => {
      instance.unmount()
    })
    await act(async () => {
      instance.mount()
    })
    await waitFor(() => within(container).getByText('82'))
    expect(callCount()).toBe(2)
  })

  it('calling mount() while already mounted is a no-op', async () => {
    const container = makeContainer()
    const { options, callCount } = makeOptions(container)
    const instance = await createAsync(options)
    await waitFor(() => expect(callCount()).toBe(1))

    await act(async () => {
      instance.mount()
    })
    expect(callCount()).toBe(1)
  })
})

describe('createAllFantasyWidget — refresh()', () => {
  it('calling refresh() triggers another fetch once ready', async () => {
    const container = makeContainer()
    const { options, callCount } = makeOptions(container)
    const instance = await createAsync(options)
    await waitFor(() => expect(callCount()).toBe(1))

    await act(async () => {
      await instance.refresh()
    })
    expect(callCount()).toBe(2)
  })

  it('calling the in-widget refresh button reports an interaction', async () => {
    const container = makeContainer()
    const interactions: string[] = []
    const { options } = makeOptions(container, {}, { onInteraction: (t) => interactions.push(t) })
    await createAsync(options)
    await waitFor(() => within(container).getByText('82'))

    const button = within(container).getByRole('button', { name: /refresh/i })
    await act(async () => {
      button.click()
    })
    await waitFor(() => expect(interactions).toEqual(['refresh_button']))
  })
})

describe('createAllFantasyWidget — lifecycle callbacks / degraded / error states', () => {
  it('invokes onReady once the widget reaches the ready state', async () => {
    const container = makeContainer()
    let readyInfo: { degraded: boolean } | null = null
    const { options } = makeOptions(container, {}, { onReady: (info) => { readyInfo = info } })
    await createAsync(options)

    await waitFor(() => expect(readyInfo).not.toBeNull())
    expect(readyInfo).toEqual({ degraded: false })
  })

  it('invokes onDegraded when completeness < 100', async () => {
    const container = makeContainer()
    let degraded = false
    const { options } = makeOptions(container, {}, { onDegraded: () => { degraded = true } })
    options.fetchImpl = makeQueueFetch([makeFakeResponse(200, makeEnvelope(60))]).fetchImpl
    await createAsync(options)

    await waitFor(() => expect(degraded).toBe(true))
    expect(container.querySelector('[data-widget-degraded="true"]')).not.toBeNull()
  })

  it('invokes onError with a sanitized SDKError on a network failure', async () => {
    const container = makeContainer()
    let error: Record<string, unknown> | null = null
    const { options } = makeOptions(container, {}, { onError: (e) => { error = e as unknown as Record<string, unknown> } })
    options.fetchImpl = makeQueueFetch([new Error('network down')]).fetchImpl
    await createAsync(options)

    await waitFor(() => expect(error).not.toBeNull())
    expect(Object.keys(error as object).sort()).toEqual(['code', 'message', 'retryable', 'timestamp', 'widgetId'])
  })
})

describe('createAllFantasyWidget — no internal leakage', () => {
  it('never puts the credential or apiKey in the rendered container content', async () => {
    const container = makeContainer()
    const { options } = makeOptions(container)
    await createAsync(options)
    await waitFor(() => within(container).getByText('82'))

    expect(container.innerHTML).not.toContain(SECRET_API_KEY)
    expect(container.innerHTML).not.toContain(SECRET_CREDENTIAL)
  })

  it('never puts the credential or apiKey in an onError callback payload', async () => {
    const container = makeContainer()
    let error: unknown = null
    const { options } = makeOptions(container, {}, { onError: (e) => { error = e } })
    options.fetchImpl = makeQueueFetch([new Error('network down')]).fetchImpl
    await createAsync(options)

    await waitFor(() => expect(error).not.toBeNull())
    const serialized = JSON.stringify(error)
    expect(serialized).not.toContain(SECRET_API_KEY)
    expect(serialized).not.toContain(SECRET_CREDENTIAL)
  })

  it('the returned instance has no property that exposes auth or apiKey', async () => {
    const container = makeContainer()
    const { options } = makeOptions(container)
    const instance = await createAsync(options)
    await waitFor(() => within(container).getByText('82'))

    const serialized = JSON.stringify(Object.keys(instance))
    expect(serialized.toLowerCase()).not.toContain('auth')
    expect(serialized.toLowerCase()).not.toContain('key')
    expect(serialized.toLowerCase()).not.toContain('credential')
  })
})

describe('createAllFantasyWidget — default runtime deps', () => {
  it('uses the real global fetch when fetchImpl is not overridden', async () => {
    const container = makeContainer()
    const originalFetch = globalThis.fetch
    const mockFetch = vi.fn(async () => ({ status: 200, ok: true, json: async () => makeEnvelope() })) as unknown as typeof globalThis.fetch
    globalThis.fetch = mockFetch

    try {
      let instance!: ReturnType<typeof createAllFantasyWidget>
      await act(async () => {
        instance = createAllFantasyWidget({
          container,
          config: makeConfig(),
          auth: makeAuth(),
          apiKey: SECRET_API_KEY,
          baseUrl: 'https://api.allfantasy.test',
          clock: makeRealClock(),
        })
      })
      await waitFor(() => within(container).getByText('82'))
      expect(mockFetch).toHaveBeenCalled()
      expect(instance.renderState).toBe('ready')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('createAllFantasyWidget — theme (Phase 7.18)', () => {
  function makePartnerTheme(overrides: SDKTheme['tokens']['colorTokenMap']): SDKTheme {
    const base = resolveSDKTheme('partner_override', {}, 'partner_acme')
    return { ...base, tokens: { ...base.tokens, colorTokenMap: overrides } }
  }

  it('renders the default (dark) palette when no theme option is supplied', async () => {
    const container = makeContainer()
    const { options } = makeOptions(container)
    await createAsync(options)
    await waitFor(() => within(container).getByText('82'))

    const ready = container.querySelector('[data-widget-state="ready"]') as HTMLElement
    expect(ready.style.background).toBe('rgba(255, 255, 255, 0.06)')
  })

  it('renders with a partner_override theme\'s color overrides applied', async () => {
    const container = makeContainer()
    const theme = makePartnerTheme({ surface: '#101010', accent: '#0a84ff' })
    const { options } = makeOptions(container, { theme })
    await createAsync(options)
    await waitFor(() => within(container).getByText('82'))

    const ready = container.querySelector('[data-widget-state="ready"]') as HTMLElement
    expect(ready.style.background).toBe('rgb(16, 16, 16)')
  })

  it('surfaces theme.partnerBrandId as a data attribute on the rendered wrapper', async () => {
    const container = makeContainer()
    const theme = makePartnerTheme({ accent: '#0a84ff' })
    const { options } = makeOptions(container, { theme })
    await createAsync(options)
    await waitFor(() => within(container).getByText('82'))

    expect(container.querySelector('[data-partner-brand-id="partner_acme"]')).not.toBeNull()
  })

  it('gracefully falls back to the default for a token missing from the partner override', async () => {
    const container = makeContainer()
    const theme = makePartnerTheme({ accent: '#0a84ff' }) // no override for 'surface'
    const { options } = makeOptions(container, { theme })
    await createAsync(options)
    await waitFor(() => within(container).getByText('82'))

    const ready = container.querySelector('[data-widget-state="ready"]') as HTMLElement
    expect(ready.style.background).toBe('rgba(255, 255, 255, 0.06)')
  })

  it('never leaks internal terminology through a theme override value', async () => {
    const container = makeContainer()
    const theme = makePartnerTheme({ accent: 'decision-os-internal-token' })
    const { options } = makeOptions(container, { theme })
    await createAsync(options)
    await waitFor(() => within(container).getByText('82'))

    expect(container.textContent).not.toContain('decision-os-internal-token')
  })
})
