import { describe, expect, it } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useAllFantasyWidget } from '../../../sdk-runtime/react/src/useAllFantasyWidget'
import type { RuntimeClock, RuntimeFetch, RuntimeFetchResponse, RuntimeTimerHandle } from '../../../sdk-runtime/core/src/index'
import type { WidgetConfig } from '../../../lib/decision-os/presentation/widget-contracts'
import type { SDKAuth } from '../../../lib/decision-os/sdk/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeWidgetConfig(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    mode: 'commissioner',
    entityId: 'league_001',
    entityType: 'league',
    tenantConfig: {
      tenantId: 'tenant_001',
      apiKey: 'sk_widget_test_key',
      allowedOrigins: ['https://partner.example.com'],
      rateLimitPerMinute: 60,
      featureFlags: {
        enableBenchmarkComparison: true, enableArchetypeLabel: true,
        enableBehavioralPatterns: true, enableCompanyIntelligence: false,
      },
      whiteLabelPlatform: null,
    },
    presentationVersion: '7.0.0',
    ...overrides,
  }
}

function makeAuth(overrides: Partial<SDKAuth> = {}): SDKAuth {
  return {
    method: 'api_key',
    credential: 'afk_test_abcdefghijklmnop',
    tenantId: 'tenant_001',
    expiresAt: null,
    scopes: ['intelligence:league:read'],
    ...overrides,
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

// ── Initial load ───────────────────────────────────────────────────────────────

describe('useAllFantasyWidget — initial load', () => {
  it('reaches ready with the fetched presentation data', async () => {
    const { fetchImpl, callCount } = makeQueueFetch([makeFakeResponse(200, makeEnvelope())])
    const { result } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig(), auth: makeAuth(),
        baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )

    expect(result.current.renderState).toBe('loading')

    await waitFor(() => expect(result.current.renderState).toBe('ready'))
    expect(result.current.data?.entityId).toBe('league_001')
    expect(callCount()).toBe(1)
  })

  it('starts in loading state before the fetch resolves', () => {
    const { fetchImpl } = makeQueueFetch([makeFakeResponse(200, makeEnvelope())])
    const { result } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig(), auth: makeAuth(),
        baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )
    expect(result.current.renderState).toBe('loading')
    expect(result.current.data).toBeNull()
  })

  it('an invalid widget config (mode/entityType mismatch) surfaces UNSUPPORTED_WIDGET without fetching', async () => {
    const { fetchImpl, callCount } = makeQueueFetch([makeFakeResponse(200, makeEnvelope())])
    const { result } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig({ mode: 'manager', entityType: 'league' }), // manager mode requires entityType 'manager'
        auth: makeAuth(), baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )

    await waitFor(() => expect(result.current.renderState).toBe('error'))
    expect(result.current.error?.code).toBe('UNSUPPORTED_WIDGET')
    expect(callCount()).toBe(0)
  })
})

// ── Lifecycle states ────────────────────────────────────────────────────────────

describe('useAllFantasyWidget — lifecycle states', () => {
  it('lifecycleState progresses to ready and renderState maps to ready', async () => {
    const { fetchImpl } = makeQueueFetch([makeFakeResponse(200, makeEnvelope())])
    const { result } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig(), auth: makeAuth(),
        baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )

    await waitFor(() => expect(result.current.lifecycleState).toBe('ready'))
    expect(result.current.renderState).toBe('ready')
  })

  it('lifecycleState lands in offline for a retryable failure', async () => {
    const { fetchImpl } = makeQueueFetch([new Error('down')])
    const { result } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig(), auth: makeAuth(),
        baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )

    await waitFor(() => expect(result.current.lifecycleState).toBe('offline'))
    expect(result.current.renderState).toBe('offline')
  })

  it('lifecycleState lands in error for a non-retryable failure', async () => {
    const { fetchImpl } = makeQueueFetch([makeFakeResponse(401, {})])
    const { result } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig(), auth: makeAuth(),
        baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )

    await waitFor(() => expect(result.current.lifecycleState).toBe('error'))
    expect(result.current.renderState).toBe('error')
  })

  it('unmounting disposes the underlying engine', async () => {
    const { fetchImpl } = makeQueueFetch([makeFakeResponse(200, makeEnvelope())])
    const { result, unmount } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig(), auth: makeAuth(),
        baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )
    await waitFor(() => expect(result.current.renderState).toBe('ready'))
    const engine = result.current.engine
    unmount()
    expect(engine?.isDisposed).toBe(true)
  })
})

// ── Manual refresh ──────────────────────────────────────────────────────────────

describe('useAllFantasyWidget — manual refresh', () => {
  it('refresh() triggers a new fetch and updates data', async () => {
    const { fetchImpl, callCount } = makeQueueFetch([
      makeFakeResponse(200, makeEnvelope()),
      makeFakeResponse(200, makeEnvelope()),
    ])
    const { result } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig(), auth: makeAuth(),
        baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )

    await waitFor(() => expect(result.current.renderState).toBe('ready'))
    expect(callCount()).toBe(1)

    await act(async () => {
      await result.current.refresh()
    })

    expect(callCount()).toBe(2)
    expect(result.current.renderState).toBe('ready')
  })

  it('refresh() before the initial load completes is a no-op (no engine yet is handled gracefully)', async () => {
    const { fetchImpl } = makeQueueFetch([makeFakeResponse(200, makeEnvelope())])
    const { result } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig(), auth: makeAuth(),
        baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )
    // Calling refresh immediately (engine may already exist by this point synchronously,
    // but lifecycle is not yet 'ready' — refreshNow() should return 'cancelled' internally
    // without throwing).
    await expect(act(async () => { await result.current.refresh() })).resolves.not.toThrow()
  })
})

// ── Degraded response ─────────────────────────────────────────────────────────

describe('useAllFantasyWidget — degraded response', () => {
  it('surfaces degraded:true when completeness < 100', async () => {
    const { fetchImpl } = makeQueueFetch([makeFakeResponse(200, makeEnvelope(58))])
    const { result } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig(), auth: makeAuth(),
        baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )

    await waitFor(() => expect(result.current.renderState).toBe('ready'))
    expect(result.current.degraded).toBe(true)
  })

  it('surfaces degraded:false when completeness is 100', async () => {
    const { fetchImpl } = makeQueueFetch([makeFakeResponse(200, makeEnvelope(100))])
    const { result } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig(), auth: makeAuth(),
        baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )

    await waitFor(() => expect(result.current.renderState).toBe('ready'))
    expect(result.current.degraded).toBe(false)
  })
})

// ── Error state ─────────────────────────────────────────────────────────────────

describe('useAllFantasyWidget — error state', () => {
  it('surfaces the SDKError object from a non-retryable failure', async () => {
    const { fetchImpl } = makeQueueFetch([makeFakeResponse(403, {})])
    const { result } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig(), auth: makeAuth(),
        baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )

    await waitFor(() => expect(result.current.renderState).toBe('error'))
    expect(result.current.error?.code).toBe('INVALID_SCOPE')
    expect(result.current.data).toBeNull()
  })
})

// ── No credential leakage ─────────────────────────────────────────────────────

describe('useAllFantasyWidget — no credential leakage', () => {
  const SECRET = 'afk_live_hook_secret_leak_test'

  it('the hook result never contains the credential on success', async () => {
    const { fetchImpl } = makeQueueFetch([makeFakeResponse(200, makeEnvelope())])
    const { result } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig(), auth: makeAuth({ credential: SECRET }),
        baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )

    await waitFor(() => expect(result.current.renderState).toBe('ready'))
    const serialized = JSON.stringify({ data: result.current.data, error: result.current.error })
    expect(serialized).not.toContain(SECRET)
  })

  it('the hook result never contains the credential on failure', async () => {
    const { fetchImpl } = makeQueueFetch([makeFakeResponse(401, {})])
    const { result } = renderHook(() =>
      useAllFantasyWidget({
        config: makeWidgetConfig(), auth: makeAuth({ credential: SECRET }),
        baseUrl: 'https://api.allfantasy.test', fetchImpl, clock: makeRealClock(),
      }),
    )

    await waitFor(() => expect(result.current.renderState).toBe('error'))
    expect(JSON.stringify(result.current.error)).not.toContain(SECRET)
  })
})
