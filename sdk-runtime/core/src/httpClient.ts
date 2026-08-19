/**
 * Decision OS — Phase 7.6 Widget Runtime Core: HTTP client.
 *
 * Framework-agnostic fetch of Presentation API responses. Every network call
 * goes through an injected `RuntimeFetch` — never a global `fetch` — so no
 * browser globals are required and every test runs against a fake.
 *
 * Consumes ONLY:
 *   - `WidgetApiCall` (Phase 7.3, `mapWidgetModeToApiCall`) for endpoint/query shape
 *   - `SDKAuth` (Phase 7.4) for credential attachment
 *   - `mapHttpFailureToSDKError` (this module's own errorMapper) for failure classification
 *
 * Never imports `lib/decision-os/behavioral/*` or `lib/decision-os/world/*`.
 * Only ever requests the exact call shape `mapWidgetModeToApiCall` produced —
 * no Phase 5/6 internals are reachable from this module.
 */

import type { WidgetApiCall } from '../../../lib/decision-os/presentation/widget-contracts'
import type { SDKAuth } from '../../../lib/decision-os/sdk/types'
import { mapHttpFailureToSDKError } from './errorMapper'
import type {
  ExpectedEntity,
  HttpClientConfig,
  PresentationEnvelopeWire,
  PresentationFetchResult,
  RuntimeFetchResponse,
} from './types'

// ── Pure request-construction helpers ──────────────────────────────────────────

/**
 * Builds the query string for a WidgetApiCall's params, plus an `embed_token`
 * param for auth methods that carry their credential in the URL rather than
 * a header (signed_embed_token, partner_token). Keys are sorted so the
 * output is deterministic. No global URLSearchParams — built manually so
 * this module has zero ambient API dependencies.
 */
export function buildQueryString(call: WidgetApiCall, auth: SDKAuth): string {
  const params: Record<string, string> = { ...call.queryParams }
  if ((auth.method === 'signed_embed_token' || auth.method === 'partner_token') && auth.credential) {
    params.embed_token = auth.credential
  }
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&')
}

/** Builds the full request URL for a WidgetApiCall against a base URL. */
export function buildRequestUrl(baseUrl: string, call: WidgetApiCall, auth: SDKAuth): string {
  const query = buildQueryString(call, auth)
  const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  return query.length > 0 ? `${trimmedBase}${call.endpoint}?${query}` : `${trimmedBase}${call.endpoint}`
}

/**
 * Builds request headers for a given auth method.
 *
 * Only 'api_key' matches the live Intelligence API gate's
 * `X-AllFantasy-API-Key` header (`lib/decision-os/behavioral/api/gate.ts`).
 * 'jwt'/'enterprise_tenant_token' use a standard Authorization Bearer header
 * for forward compatibility with auth methods not yet implemented
 * server-side. 'signed_embed_token'/'partner_token' carry their credential
 * as a URL param (see buildQueryString), not a header. 'anonymous_public'
 * sends no credential at all.
 */
export function buildRequestHeaders(auth: SDKAuth): Record<string, string> {
  switch (auth.method) {
    case 'api_key':
      return auth.credential ? { 'X-AllFantasy-API-Key': auth.credential } : {}
    case 'jwt':
    case 'enterprise_tenant_token':
      return auth.credential ? { Authorization: `Bearer ${auth.credential}` } : {}
    case 'signed_embed_token':
    case 'partner_token':
    case 'anonymous_public':
      return {}
    default:
      return {}
  }
}

// ── Response validation ────────────────────────────────────────────────────────

function isPresentationEnvelope(body: unknown): body is PresentationEnvelopeWire {
  if (typeof body !== 'object' || body === null) return false
  const rec = body as Record<string, unknown>
  if (typeof rec.data !== 'object' || rec.data === null) return false
  if (typeof rec.meta !== 'object' || rec.meta === null) return false
  const data = rec.data as Record<string, unknown>
  const meta = rec.meta as Record<string, unknown>
  return (
    typeof data.entityId === 'string' &&
    typeof data.entityType === 'string' &&
    typeof data.completeness === 'number' &&
    typeof meta.completeness === 'number' &&
    typeof meta.requestId === 'string'
  )
}

// ── Fetch orchestration ────────────────────────────────────────────────────────

/**
 * Fetches presentation data for a WidgetApiCall. Returns a discriminated
 * result — never throws for a network/HTTP/shape failure (those are all
 * mapped to a typed SDKError via errorMapper). Only a programmer error in
 * the caller's own `fetchImpl` would throw uncaught, and that is
 * intentional — it indicates a runtime bug in the injected dependency, not
 * a data-fetch failure this function should mask.
 */
export async function fetchPresentation(
  config: HttpClientConfig,
  call: WidgetApiCall,
  auth: SDKAuth,
  expected: ExpectedEntity,
): Promise<PresentationFetchResult> {
  const url = buildRequestUrl(config.baseUrl, call, auth)
  const headers = buildRequestHeaders(auth)

  let response: RuntimeFetchResponse
  try {
    response = await config.fetchImpl(url, { method: 'GET', headers })
  } catch (err) {
    return {
      ok: false,
      error: mapHttpFailureToSDKError({
        kind: 'network',
        detail: err instanceof Error ? err.message : String(err),
      }),
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: mapHttpFailureToSDKError({ kind: 'http_status', status: response.status }),
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (err) {
    return {
      ok: false,
      error: mapHttpFailureToSDKError({
        kind: 'parse_error',
        detail: err instanceof Error ? err.message : String(err),
      }),
    }
  }

  if (!isPresentationEnvelope(body)) {
    return { ok: false, error: mapHttpFailureToSDKError({ kind: 'malformed_body' }) }
  }

  if (body.data.entityId !== expected.entityId || body.data.entityType !== expected.entityType) {
    return {
      ok: false,
      error: mapHttpFailureToSDKError({
        kind: 'tenant_mismatch',
        expectedEntityId: expected.entityId,
        actualEntityId: body.data.entityId,
      }),
    }
  }

  return {
    ok: true,
    data: body.data,
    meta: body.meta,
    degraded: body.meta.completeness < 100,
  }
}
