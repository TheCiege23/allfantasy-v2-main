/**
 * Decision OS — Phase 5.7 Intelligence API feature gate + API key validator.
 *
 * Pure — reads only `process.env`. No IO, no DB, no mutations.
 *
 * Feature flag: `DECISION_OS_INTELLIGENCE_API_ENABLED=true` must be set explicitly.
 * Key format:   `X-AllFantasy-API-Key: afk_{env}_{token}` (env ∈ {test, live}; token ≥16 alphanum)
 *
 * Tier resolution:
 *   Reads `INTELLIGENCE_API_TEST_KEYS` env var (JSON map of full key → IntelligenceTier).
 *   - test env + key in map    → mapped tier
 *   - test env + key not found → 'basic' (dev-mode convenience for local integration
 *     testing) **in every environment except Production** — `VERCEL_ENV === 'production'`
 *     always requires a registered key, test or live, with no fallback. Phase L1 (API
 *     Security Hardening) closed this: an unregistered test key is exactly the kind of
 *     permissive fallback that must never reach Production once real, external licensee
 *     credentials exist. Preview/Development are unaffected — Vercel doesn't set
 *     `VERCEL_ENV=production` for either, and local dev never sets it at all.
 *   - live env + key in map   → mapped tier
 *   - live env + key not found → 401 UNAUTHORIZED (live keys must always be registered)
 *
 * ADR: ADR_F5_7_INTELLIGENCE_API_ROUTES.md
 * ADR: API_SECURITY_HARDENING_REPORT.md (Phase L1)
 */

import type { IntelligenceTier, IntelligenceApiError, IntelligenceApiErrorCode } from './contracts'

// ── Key format ─────────────────────────────────────────────────────────────────

const KEY_REGEX = /^afk_(test|live)_([A-Za-z0-9]{16,})$/

export type GateEnv = 'test' | 'live'

// ── Gate result types ─────────────────────────────────────────────────────────

export interface GateOk {
  ok:        true
  tier:      IntelligenceTier
  requestId: string
  env:       GateEnv
}

export interface GateErr {
  ok:     false
  status: number
  error:  IntelligenceApiError
}

export type GateResult = GateOk | GateErr

// ── Internal helpers ──────────────────────────────────────────────────────────

function makeRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function makeError(
  code:      IntelligenceApiErrorCode,
  message:   string,
  requestId: string,
): IntelligenceApiError {
  return { code, message, requestId }
}

function parseTestKeysMap(): Record<string, IntelligenceTier> {
  const raw = process.env.INTELLIGENCE_API_TEST_KEYS
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, IntelligenceTier>
  } catch {
    return {}
  }
}

/**
 * `VERCEL_ENV` is Vercel's own automatically-provided signal, distinct from
 * `NODE_ENV` (which Next.js sets to `'production'` for every deployed
 * build, Preview included — it cannot distinguish Preview from Production).
 * Undefined locally and in any non-Vercel environment, which correctly
 * keeps the dev-mode fallback available there.
 */
function isProductionEnvironment(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

// ── Public gate check ─────────────────────────────────────────────────────────

/**
 * Validates the feature flag, API key header, and resolves the caller's tier.
 * Called once at the top of every Phase 5.7 route handler.
 *
 * @param headers  Any `{ get(key: string): string | null }` — compatible with
 *                 `NextRequest.headers` (which is case-insensitive) and test fakes.
 */
export function checkIntelligenceGate(
  headers: { get(key: string): string | null },
): GateResult {
  // 1. Feature flag (fail-safe: must be explicitly enabled)
  if (process.env.DECISION_OS_INTELLIGENCE_API_ENABLED !== 'true') {
    return {
      ok: false,
      status: 503,
      error: makeError(
        'INTELLIGENCE_UNAVAILABLE',
        'Intelligence API is not enabled on this environment.',
        makeRequestId(),
      ),
    }
  }

  const requestId = makeRequestId()

  // 2. API key header (NextRequest.headers.get() is already case-insensitive)
  const rawKey = headers.get('x-allfantasy-api-key')
  if (!rawKey) {
    return {
      ok: false,
      status: 401,
      error: makeError('UNAUTHORIZED', 'Missing X-AllFantasy-API-Key header.', requestId),
    }
  }

  // 3. Format validation
  const match = KEY_REGEX.exec(rawKey)
  if (!match) {
    return {
      ok: false,
      status: 401,
      error: makeError(
        'UNAUTHORIZED',
        'Invalid API key format. Expected: afk_{test|live}_{16+ char token}.',
        requestId,
      ),
    }
  }

  const env = match[1] as GateEnv
  const map = parseTestKeysMap()

  // 4. Tier resolution
  if (env === 'test') {
    const mappedTier = map[rawKey]
    if (mappedTier) {
      return { ok: true, tier: mappedTier, requestId, env }
    }
    // Unregistered test key: 'basic'-tier dev-mode convenience everywhere
    // except Production, where every key — test or live — must be
    // registered. No permissive fallback survives in Production.
    if (isProductionEnvironment()) {
      return {
        ok: false,
        status: 401,
        error: makeError('UNAUTHORIZED', 'Unknown API key.', requestId),
      }
    }
    return { ok: true, tier: 'basic', requestId, env }
  }

  // live env — key must always be registered, in every environment
  const tier = map[rawKey]
  if (!tier) {
    return {
      ok: false,
      status: 401,
      error: makeError('UNAUTHORIZED', 'Unknown API key.', requestId),
    }
  }

  return { ok: true, tier, requestId, env }
}
