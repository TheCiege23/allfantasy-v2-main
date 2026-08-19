/**
 * Decision OS — Phase 7.6 Widget Runtime Core tests.
 *
 * Covers: request construction, auth pre-check, lifecycle transitions, error
 * mapping, degraded responses, no API key leakage, injected fetch behavior.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  buildQueryString,
  buildRequestUrl,
  buildRequestHeaders,
  fetchPresentation,
  authPreCheck,
  LifecycleController,
  InvalidLifecycleTransitionError,
  classifyHttpStatus,
  classifyFailureReason,
  mapHttpFailureToSDKError,
} from '../../../sdk-runtime/core/src/index'
import type {
  HttpClientConfig,
  RuntimeFetch,
  RuntimeFetchResponse,
  PresentationEnvelopeWire,
} from '../../../sdk-runtime/core/src/index'
import type { WidgetApiCall } from '../../../lib/decision-os/presentation/widget-contracts'
import type { SDKAuth, SDKLifecycleState, SDKErrorCode } from '../../../lib/decision-os/sdk/types'
import { buildSDKError, ALL_LIFECYCLE_STATES } from '../../../lib/decision-os/sdk/index'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCall(overrides: Partial<WidgetApiCall> = {}): WidgetApiCall {
  return {
    endpoint: '/api/v1/intelligence/league',
    queryParams: { view: 'presentation', leagueId: 'league_001' },
    requiredScopes: ['intelligence:league:read'],
    view: 'presentation',
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

function makeEnvelope(overrides: Partial<PresentationEnvelopeWire['data']> = {}): PresentationEnvelopeWire {
  return {
    data: {
      entityId: 'league_001',
      entityType: 'league',
      completeness: 100,
      healthScore: 82,
      ...overrides,
    },
    meta: {
      requestId: 'req_001',
      derivedAt: '2026-07-01T00:00:00.000Z',
      completeness: (overrides.completeness as number | undefined) ?? 100,
      version: 'v1',
      tier: 'commissioner',
      view: 'presentation',
      presentationVersion: '7.0.0',
    },
  }
}

function makeFakeResponse(status: number, body: unknown): RuntimeFetchResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

/** Records every call made to the fake fetch for assertion. */
function makeRecordingFetch(response: RuntimeFetchResponse | Error): {
  fetchImpl: RuntimeFetch
  calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string> } }>
} {
  const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string> } }> = []
  const fetchImpl: RuntimeFetch = async (url, init) => {
    calls.push({ url, init })
    if (response instanceof Error) throw response
    return response
  }
  return { fetchImpl, calls }
}

function makeConfig(fetchImpl: RuntimeFetch, baseUrl = 'https://api.allfantasy.test'): HttpClientConfig {
  return { baseUrl, fetchImpl }
}

// ── Request construction ──────────────────────────────────────────────────────

describe('buildQueryString', () => {
  it('serializes queryParams sorted alphabetically', () => {
    const call = makeCall({ queryParams: { view: 'presentation', leagueId: 'l1' } })
    const qs = buildQueryString(call, makeAuth())
    expect(qs).toBe('leagueId=l1&view=presentation')
  })

  it('URL-encodes keys and values', () => {
    const call = makeCall({ queryParams: { 'a b': 'c&d' } })
    const qs = buildQueryString(call, makeAuth())
    expect(qs).toBe('a%20b=c%26d')
  })

  it('appends embed_token for signed_embed_token auth', () => {
    const call = makeCall({ queryParams: { view: 'presentation' } })
    const auth = makeAuth({ method: 'signed_embed_token', credential: 'tok_abc', tenantId: 't1' })
    const qs = buildQueryString(call, auth)
    expect(qs).toContain('embed_token=tok_abc')
  })

  it('appends embed_token for partner_token auth', () => {
    const call = makeCall({ queryParams: {} })
    const auth = makeAuth({ method: 'partner_token', credential: 'ptok_xyz', tenantId: 't1' })
    const qs = buildQueryString(call, auth)
    expect(qs).toBe('embed_token=ptok_xyz')
  })

  it('does not append embed_token for api_key auth', () => {
    const call = makeCall({ queryParams: { view: 'presentation' } })
    const qs = buildQueryString(call, makeAuth({ method: 'api_key' }))
    expect(qs).not.toContain('embed_token')
  })

  it('does not append embed_token for anonymous_public auth', () => {
    const call = makeCall({ queryParams: { view: 'presentation' } })
    const auth = makeAuth({ method: 'anonymous_public', credential: null, tenantId: null })
    const qs = buildQueryString(call, auth)
    expect(qs).not.toContain('embed_token')
  })

  it('is deterministic', () => {
    const call = makeCall()
    const a = buildQueryString(call, makeAuth())
    const b = buildQueryString(call, makeAuth())
    expect(a).toBe(b)
  })
})

describe('buildRequestUrl', () => {
  it('combines baseUrl + endpoint + query', () => {
    const url = buildRequestUrl('https://api.allfantasy.test', makeCall(), makeAuth())
    expect(url).toBe('https://api.allfantasy.test/api/v1/intelligence/league?leagueId=league_001&view=presentation')
  })

  it('strips a trailing slash from baseUrl', () => {
    const url = buildRequestUrl('https://api.allfantasy.test/', makeCall(), makeAuth())
    expect(url.startsWith('https://api.allfantasy.test/api/v1')).toBe(true)
    expect(url).not.toContain('.test//api')
  })

  it('omits the "?" when there are no query params', () => {
    const call = makeCall({ queryParams: {} })
    const auth = makeAuth({ method: 'anonymous_public', credential: null, tenantId: null })
    const url = buildRequestUrl('https://api.allfantasy.test', call, auth)
    expect(url).toBe('https://api.allfantasy.test/api/v1/intelligence/league')
  })
})

describe('buildRequestHeaders', () => {
  it('api_key uses X-AllFantasy-API-Key header', () => {
    const headers = buildRequestHeaders(makeAuth({ method: 'api_key', credential: 'afk_test_xyz123' }))
    expect(headers).toEqual({ 'X-AllFantasy-API-Key': 'afk_test_xyz123' })
  })

  it('jwt uses Authorization Bearer header', () => {
    const headers = buildRequestHeaders(makeAuth({ method: 'jwt', credential: 'jwt_xyz' }))
    expect(headers).toEqual({ Authorization: 'Bearer jwt_xyz' })
  })

  it('enterprise_tenant_token uses Authorization Bearer header', () => {
    const headers = buildRequestHeaders(makeAuth({ method: 'enterprise_tenant_token', credential: 'ent_xyz' }))
    expect(headers).toEqual({ Authorization: 'Bearer ent_xyz' })
  })

  it('signed_embed_token sends no header', () => {
    const headers = buildRequestHeaders(makeAuth({ method: 'signed_embed_token', credential: 'tok_abc' }))
    expect(headers).toEqual({})
  })

  it('partner_token sends no header', () => {
    const headers = buildRequestHeaders(makeAuth({ method: 'partner_token', credential: 'ptok_abc' }))
    expect(headers).toEqual({})
  })

  it('anonymous_public sends no header', () => {
    const headers = buildRequestHeaders(makeAuth({ method: 'anonymous_public', credential: null, tenantId: null }))
    expect(headers).toEqual({})
  })

  it('is deterministic', () => {
    const auth = makeAuth()
    expect(buildRequestHeaders(auth)).toEqual(buildRequestHeaders(auth))
  })
})

// ── Auth pre-check ────────────────────────────────────────────────────────────

describe('authPreCheck', () => {
  it('valid api_key auth passes', () => {
    const result = authPreCheck(makeAuth())
    expect(result.ok).toBe(true)
  })

  it('invalid auth (missing credential) fails with UNAUTHORIZED', () => {
    const result = authPreCheck(makeAuth({ credential: '' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('UNAUTHORIZED')
      expect(result.reasons.length).toBeGreaterThan(0)
    }
  })

  it('valid anonymous_public auth passes', () => {
    const result = authPreCheck({
      method: 'anonymous_public', credential: null, tenantId: null, expiresAt: null,
      scopes: ['intelligence:platform:basic'],
    })
    expect(result.ok).toBe(true)
  })

  it('anonymous_public with a credential fails', () => {
    const result = authPreCheck({
      method: 'anonymous_public', credential: 'should_not_be_here', tenantId: null, expiresAt: null, scopes: [],
    })
    expect(result.ok).toBe(false)
  })

  it('never includes the credential value in failure reasons', () => {
    const result = authPreCheck(makeAuth({ credential: '', tenantId: '' }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const serialized = JSON.stringify(result.reasons)
      expect(serialized).not.toContain('afk_test_abcdefghijklmnop')
    }
  })

  it('is deterministic', () => {
    const auth = makeAuth({ credential: '' })
    const a = authPreCheck(auth)
    const b = authPreCheck(auth)
    expect(a).toEqual(b)
  })
})

// ── Lifecycle controller ──────────────────────────────────────────────────────

describe('LifecycleController', () => {
  it('defaults to initializing', () => {
    const controller = new LifecycleController()
    expect(controller.currentState).toBe('initializing')
  })

  it('accepts a custom initial state', () => {
    const controller = new LifecycleController('ready')
    expect(controller.currentState).toBe('ready')
  })

  it('valid transition updates currentState', () => {
    const controller = new LifecycleController()
    controller.transition('authenticating')
    expect(controller.currentState).toBe('authenticating')
  })

  it('drives a full valid sequence', () => {
    const controller = new LifecycleController()
    controller.transition('authenticating')
    controller.transition('loading')
    controller.transition('rendering')
    controller.transition('ready')
    controller.transition('refreshing')
    controller.transition('ready')
    controller.transition('disposed')
    expect(controller.currentState).toBe('disposed')
  })

  it('throws InvalidLifecycleTransitionError on an invalid transition', () => {
    const controller = new LifecycleController()
    expect(() => controller.transition('ready')).toThrow(InvalidLifecycleTransitionError)
  })

  it('the thrown error carries fromState and toState', () => {
    const controller = new LifecycleController()
    try {
      controller.transition('ready')
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidLifecycleTransitionError)
      const typed = err as InvalidLifecycleTransitionError
      expect(typed.fromState).toBe('initializing')
      expect(typed.toState).toBe('ready')
    }
  })

  it('disposed is terminal — every further transition throws', () => {
    const controller = new LifecycleController('disposed')
    for (const state of ALL_LIFECYCLE_STATES) {
      if (state === 'disposed') continue
      expect(() => controller.transition(state)).toThrow(InvalidLifecycleTransitionError)
    }
  })

  it('history accumulates transitions in order, including the initial state', () => {
    const controller = new LifecycleController()
    controller.transition('authenticating')
    controller.transition('loading')
    expect(controller.history).toEqual(['initializing', 'authenticating', 'loading'])
  })

  it('canTransition matches the Phase 7.4 lifecycle table', () => {
    const controller = new LifecycleController()
    expect(controller.canTransition('authenticating')).toBe(true)
    expect(controller.canTransition('ready')).toBe(false)
  })

  it('nextStates matches the Phase 7.4 lifecycle table', () => {
    const controller = new LifecycleController('ready')
    expect(controller.nextStates().sort()).toEqual(['disposed', 'error', 'offline', 'refreshing'].sort())
  })

  it('error state can retry back to initializing', () => {
    const controller = new LifecycleController('error')
    controller.transition('initializing')
    expect(controller.currentState).toBe('initializing')
  })
})

// ── Error mapper ──────────────────────────────────────────────────────────────

describe('classifyHttpStatus', () => {
  it('maps 401 to UNAUTHORIZED', () => {
    expect(classifyHttpStatus(401)).toBe('UNAUTHORIZED')
  })
  it('maps 403 to INVALID_SCOPE', () => {
    expect(classifyHttpStatus(403)).toBe('INVALID_SCOPE')
  })
  it('maps 404 to PRESENTATION_MISSING', () => {
    expect(classifyHttpStatus(404)).toBe('PRESENTATION_MISSING')
  })
  it('maps 429 to RATE_LIMITED', () => {
    expect(classifyHttpStatus(429)).toBe('RATE_LIMITED')
  })
  it('maps 503 to PRESENTATION_MISSING', () => {
    expect(classifyHttpStatus(503)).toBe('PRESENTATION_MISSING')
  })
  it('maps an unmapped status (500) to NETWORK', () => {
    expect(classifyHttpStatus(500)).toBe('NETWORK')
  })
  it('maps an unmapped status (418) to NETWORK', () => {
    expect(classifyHttpStatus(418)).toBe('NETWORK')
  })
})

describe('classifyFailureReason', () => {
  it('network → NETWORK', () => {
    expect(classifyFailureReason({ kind: 'network', detail: 'x' })).toBe('NETWORK')
  })
  it('parse_error → NETWORK', () => {
    expect(classifyFailureReason({ kind: 'parse_error', detail: 'x' })).toBe('NETWORK')
  })
  it('malformed_body → INCOMPLETE_PRESENTATION', () => {
    expect(classifyFailureReason({ kind: 'malformed_body' })).toBe('INCOMPLETE_PRESENTATION')
  })
  it('tenant_mismatch → TENANT_MISMATCH', () => {
    expect(classifyFailureReason({ kind: 'tenant_mismatch', expectedEntityId: 'a', actualEntityId: 'b' })).toBe('TENANT_MISMATCH')
  })
  it('http_status delegates to classifyHttpStatus', () => {
    expect(classifyFailureReason({ kind: 'http_status', status: 429 })).toBe('RATE_LIMITED')
  })
})

describe('mapHttpFailureToSDKError', () => {
  it('delegates message/retryable to the frozen buildSDKError — never reimplements them', () => {
    const mapped = mapHttpFailureToSDKError({ kind: 'http_status', status: 401 }, { widgetId: 'w1' })
    const direct = buildSDKError('UNAUTHORIZED', { widgetId: 'w1' })
    expect(mapped.message).toBe(direct.message)
    expect(mapped.retryable).toBe(direct.retryable)
    expect(mapped.code).toBe('UNAUTHORIZED')
  })

  it('is deterministic', () => {
    const a = mapHttpFailureToSDKError({ kind: 'network', detail: 'x' }, { timestamp: '2026-01-01T00:00:00.000Z' })
    const b = mapHttpFailureToSDKError({ kind: 'network', detail: 'x' }, { timestamp: '2026-01-01T00:00:00.000Z' })
    expect(a).toEqual(b)
  })

  it('covers every SDKErrorCode reachable from an HTTP status', () => {
    const codes: SDKErrorCode[] = ['UNAUTHORIZED', 'INVALID_SCOPE', 'PRESENTATION_MISSING', 'RATE_LIMITED', 'NETWORK']
    const statuses = [401, 403, 404, 429, 500]
    statuses.forEach((status, i) => {
      const err = mapHttpFailureToSDKError({ kind: 'http_status', status })
      expect(err.code).toBe(codes[i])
    })
  })
})

// ── fetchPresentation — success path ──────────────────────────────────────────

describe('fetchPresentation — success', () => {
  it('returns ok:true with degraded:false when completeness is 100', async () => {
    const envelope = makeEnvelope({ completeness: 100 })
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(200, envelope))
    const result = await fetchPresentation(
      makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.degraded).toBe(false)
      expect(result.data.entityId).toBe('league_001')
      expect(result.meta.requestId).toBe('req_001')
    }
  })

  it('returns degraded:true when completeness < 100', async () => {
    const envelope = makeEnvelope({ completeness: 65 })
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(200, envelope))
    const result = await fetchPresentation(
      makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.degraded).toBe(true)
  })

  it('returns degraded:false when completeness is exactly 100 at the boundary', async () => {
    const envelope = makeEnvelope({ completeness: 100 })
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(200, envelope))
    const result = await fetchPresentation(
      makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' },
    )
    expect(result.ok && result.degraded).toBe(false)
  })

  it('constructs the request with the correct URL and headers', async () => {
    const { fetchImpl, calls } = makeRecordingFetch(makeFakeResponse(200, makeEnvelope()))
    const auth = makeAuth({ method: 'api_key', credential: 'afk_test_realkey12345' })
    await fetchPresentation(makeConfig(fetchImpl), makeCall(), auth, { entityId: 'league_001', entityType: 'league' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v1/intelligence/league')
    expect(calls[0].init?.method).toBe('GET')
    expect(calls[0].init?.headers).toEqual({ 'X-AllFantasy-API-Key': 'afk_test_realkey12345' })
  })

  it('calls fetchImpl exactly once — no retries in core', async () => {
    const { fetchImpl, calls } = makeRecordingFetch(makeFakeResponse(200, makeEnvelope()))
    await fetchPresentation(makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    expect(calls).toHaveLength(1)
  })
})

// ── fetchPresentation — failure paths / error mapping ─────────────────────────

describe('fetchPresentation — failure paths', () => {
  it('network error (fetchImpl throws) → NETWORK, retryable', async () => {
    const { fetchImpl } = makeRecordingFetch(new Error('connection reset'))
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NETWORK')
      expect(result.error.retryable).toBe(true)
    }
  })

  it('401 response → UNAUTHORIZED, not retryable', async () => {
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(401, { code: 'UNAUTHORIZED' }))
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('UNAUTHORIZED')
      expect(result.error.retryable).toBe(false)
    }
  })

  it('429 response → RATE_LIMITED, retryable', async () => {
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(429, {}))
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('RATE_LIMITED')
  })

  it('503 response → PRESENTATION_MISSING', async () => {
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(503, {}))
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('PRESENTATION_MISSING')
  })

  it('unmapped 500 response → NETWORK', async () => {
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(500, {}))
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NETWORK')
  })

  it('malformed JSON (json() rejects) → NETWORK', async () => {
    const response: RuntimeFetchResponse = { status: 200, ok: true, json: async () => { throw new Error('bad json') } }
    const { fetchImpl } = makeRecordingFetch(response)
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NETWORK')
  })

  it('malformed body (missing meta) → INCOMPLETE_PRESENTATION', async () => {
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(200, { data: { entityId: 'league_001', entityType: 'league', completeness: 90 } }))
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INCOMPLETE_PRESENTATION')
  })

  it('malformed body (missing data.entityId) → INCOMPLETE_PRESENTATION', async () => {
    const badEnvelope = { data: { entityType: 'league', completeness: 90 }, meta: makeEnvelope().meta }
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(200, badEnvelope))
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INCOMPLETE_PRESENTATION')
  })

  it('malformed body (not an object) → INCOMPLETE_PRESENTATION', async () => {
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(200, 'not an object'))
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INCOMPLETE_PRESENTATION')
  })

  it('entityId mismatch → TENANT_MISMATCH', async () => {
    const envelope = makeEnvelope({ entityId: 'league_999' } as never)
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(200, envelope))
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TENANT_MISMATCH')
  })

  it('entityType mismatch → TENANT_MISMATCH', async () => {
    const envelope = makeEnvelope()
    envelope.data.entityType = 'manager'
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(200, envelope))
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TENANT_MISMATCH')
  })
})

// ── No API key leakage ────────────────────────────────────────────────────────

describe('no API key leakage', () => {
  const SECRET = 'afk_live_super_secret_leak_test_key'

  it('a successful fetch result never contains the credential', async () => {
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(200, makeEnvelope()))
    const auth = makeAuth({ credential: SECRET })
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), auth, { entityId: 'league_001', entityType: 'league' })
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('a network-error result never contains the credential', async () => {
    const { fetchImpl } = makeRecordingFetch(new Error(`failed for ${SECRET}`))
    const auth = makeAuth({ credential: SECRET })
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), auth, { entityId: 'league_001', entityType: 'league' })
    // The mapped SDKError uses only the frozen deterministic message — never the raw exception detail.
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('a 401 result never contains the credential', async () => {
    const { fetchImpl } = makeRecordingFetch(makeFakeResponse(401, {}))
    const auth = makeAuth({ credential: SECRET })
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), auth, { entityId: 'league_001', entityType: 'league' })
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('an authPreCheck failure never contains the credential', () => {
    const result = authPreCheck(makeAuth({ credential: SECRET, tenantId: '' }))
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('the credential legitimately appears ONLY in the outbound request headers, not in the result', async () => {
    const { fetchImpl, calls } = makeRecordingFetch(makeFakeResponse(200, makeEnvelope()))
    const auth = makeAuth({ credential: SECRET })
    const result = await fetchPresentation(makeConfig(fetchImpl), makeCall(), auth, { entityId: 'league_001', entityType: 'league' })
    // Sent correctly as the actual credential (this is the mechanism working, not a leak):
    expect(calls[0].init?.headers).toEqual({ 'X-AllFantasy-API-Key': SECRET })
    // But absent from anything the caller could log/telemetry from the result:
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })
})

// ── Injected fetch behavior ───────────────────────────────────────────────────

describe('injected fetch behavior', () => {
  it('fully drives behavior from the injected fetchImpl — two independent fetchImpls never share state', async () => {
    const { fetchImpl: fetchA } = makeRecordingFetch(makeFakeResponse(200, makeEnvelope({ entityId: 'league_001' })))
    const { fetchImpl: fetchB } = makeRecordingFetch(makeFakeResponse(200, makeEnvelope({ entityId: 'league_001' } )))

    const resultA = await fetchPresentation(makeConfig(fetchA), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    const resultB = await fetchPresentation(makeConfig(fetchB), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })

    expect(resultA.ok).toBe(true)
    expect(resultB.ok).toBe(true)
  })

  it('respects a vi.fn()-based fetchImpl (mock-tooling compatible)', async () => {
    const mockFetch = vi.fn(async () => makeFakeResponse(200, makeEnvelope()))
    const result = await fetchPresentation(makeConfig(mockFetch), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    expect(result.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('different injected responses produce independently correct results', async () => {
    const { fetchImpl: okFetch } = makeRecordingFetch(makeFakeResponse(200, makeEnvelope()))
    const { fetchImpl: failFetch } = makeRecordingFetch(makeFakeResponse(401, {}))

    const okResult = await fetchPresentation(makeConfig(okFetch), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })
    const failResult = await fetchPresentation(makeConfig(failFetch), makeCall(), makeAuth(), { entityId: 'league_001', entityType: 'league' })

    expect(okResult.ok).toBe(true)
    expect(failResult.ok).toBe(false)
  })
})
