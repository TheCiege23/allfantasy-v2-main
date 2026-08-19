import { describe, expect, it } from 'vitest'
import { runInitialLoad } from '../../../sdk-runtime/react/src/initialLoad'
import { LifecycleController } from '../../../sdk-runtime/core/src/index'
import type { HttpClientConfig, RuntimeFetch, RuntimeFetchResponse } from '../../../sdk-runtime/core/src/index'
import type { WidgetApiCall } from '../../../lib/decision-os/presentation/widget-contracts'
import type { SDKAuth } from '../../../lib/decision-os/sdk/types'

function makeCall(): WidgetApiCall {
  return {
    endpoint: '/api/v1/intelligence/league',
    queryParams: { view: 'presentation', leagueId: 'league_001' },
    requiredScopes: ['intelligence:league:read'],
    view: 'presentation',
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

function makeFetch(response: RuntimeFetchResponse | Error): RuntimeFetch {
  return async () => {
    if (response instanceof Error) throw response
    return response
  }
}

function makeConfig(fetchImpl: RuntimeFetch): HttpClientConfig {
  return { baseUrl: 'https://api.allfantasy.test', fetchImpl }
}

function expected() {
  return { entityId: 'league_001', entityType: 'league' }
}

describe('runInitialLoad — success', () => {
  it('drives lifecycle initializing → authenticating → loading → rendering → ready', async () => {
    const lifecycle = new LifecycleController()
    const result = await runInitialLoad({
      httpConfig: makeConfig(makeFetch(makeFakeResponse(200, makeEnvelope()))),
      call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle,
    })
    expect(result.error).toBeNull()
    expect(result.data).not.toBeNull()
    expect(lifecycle.history).toEqual(['initializing', 'authenticating', 'loading', 'rendering', 'ready'])
    expect(lifecycle.currentState).toBe('ready')
  })

  it('returns degraded:true when completeness < 100', async () => {
    const lifecycle = new LifecycleController()
    const result = await runInitialLoad({
      httpConfig: makeConfig(makeFetch(makeFakeResponse(200, makeEnvelope(55)))),
      call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle,
    })
    expect(result.degraded).toBe(true)
    expect(result.error).toBeNull()
    expect(lifecycle.currentState).toBe('ready')
  })

  it('returns degraded:false when completeness is 100', async () => {
    const lifecycle = new LifecycleController()
    const result = await runInitialLoad({
      httpConfig: makeConfig(makeFetch(makeFakeResponse(200, makeEnvelope(100)))),
      call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle,
    })
    expect(result.degraded).toBe(false)
  })
})

describe('runInitialLoad — auth pre-check failure', () => {
  it('lands in error without ever calling fetch', async () => {
    let fetchCalled = false
    const fetchImpl: RuntimeFetch = async () => { fetchCalled = true; return makeFakeResponse(200, makeEnvelope()) }
    const lifecycle = new LifecycleController()

    const result = await runInitialLoad({
      httpConfig: makeConfig(fetchImpl), call: makeCall(),
      auth: makeAuth({ credential: '' }), expected: expected(), lifecycle,
    })

    expect(result.error?.code).toBe('UNAUTHORIZED')
    expect(fetchCalled).toBe(false)
    expect(lifecycle.currentState).toBe('error')
    expect(lifecycle.history).toEqual(['initializing', 'authenticating', 'error'])
  })
})

describe('runInitialLoad — fetch failure', () => {
  it('a non-retryable failure (401) lands in error', async () => {
    const lifecycle = new LifecycleController()
    const result = await runInitialLoad({
      httpConfig: makeConfig(makeFetch(makeFakeResponse(401, {}))),
      call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle,
    })
    expect(result.error?.code).toBe('UNAUTHORIZED')
    expect(result.data).toBeNull()
    expect(lifecycle.currentState).toBe('error')
  })

  it('a retryable failure (network) lands in offline', async () => {
    const lifecycle = new LifecycleController()
    const result = await runInitialLoad({
      httpConfig: makeConfig(makeFetch(new Error('down'))),
      call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle,
    })
    expect(result.error?.code).toBe('NETWORK')
    expect(result.data).toBeNull()
    expect(lifecycle.currentState).toBe('offline')
  })

  it('a rate-limited failure (429) lands in offline (retryable)', async () => {
    const lifecycle = new LifecycleController()
    const result = await runInitialLoad({
      httpConfig: makeConfig(makeFetch(makeFakeResponse(429, {}))),
      call: makeCall(), auth: makeAuth(), expected: expected(), lifecycle,
    })
    expect(result.error?.code).toBe('RATE_LIMITED')
    expect(lifecycle.currentState).toBe('offline')
  })
})

describe('runInitialLoad — no credential leakage', () => {
  const SECRET = 'afk_live_initial_load_secret_key'

  it('a success result never contains the credential', async () => {
    const lifecycle = new LifecycleController()
    const result = await runInitialLoad({
      httpConfig: makeConfig(makeFetch(makeFakeResponse(200, makeEnvelope()))),
      call: makeCall(), auth: makeAuth({ credential: SECRET }), expected: expected(), lifecycle,
    })
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('a failure result never contains the credential', async () => {
    const lifecycle = new LifecycleController()
    const result = await runInitialLoad({
      httpConfig: makeConfig(makeFetch(makeFakeResponse(401, {}))),
      call: makeCall(), auth: makeAuth({ credential: SECRET }), expected: expected(), lifecycle,
    })
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })
})
