/**
 * Decision OS — Phase 5.9 Intelligence API provider selection tests.
 *
 * Tests the resolveDataProvider() selector and end-to-end handler behavior
 * across provider/env combinations. Auth/scope enforcement is verified as still
 * working regardless of provider selection.
 *
 * Coverage:
 * - Selection: no env → stubDataProvider
 * - Selection: env=real → realDataProvider (exact reference)
 * - Selection: any other value → stubDataProvider
 * - Disabled API: gate blocks before provider is reached (503 SERVICE_UNAVAILABLE)
 * - Enabled + stub (default): provider returns null → 503 INTELLIGENCE_UNAVAILABLE
 * - Enabled + real (mock deps succeeding): handler returns 200
 * - Real provider unavailable (mock deps throwing): handler returns 503 INTELLIGENCE_UNAVAILABLE
 * - Auth: missing key → 401 regardless of provider
 * - Auth: insufficient scope → 403 regardless of provider
 * - Tier: platform tier → full response; basic tier → basic response
 * - Route thin-wrapper: route files call resolveDataProvider(), contain no provider selection logic
 */

import { vi, describe, it, expect, afterEach } from 'vitest'
import { resolveDataProvider }   from '@/lib/decision-os/behavioral/api/provider-selector'
import { stubDataProvider }      from '@/lib/decision-os/behavioral/api/intelligence-handlers'
import { realDataProvider, createRealDataProvider } from '@/lib/decision-os/behavioral/api/real-data-provider'
import {
  platformIntelligenceHandler,
  leagueIntelligenceHandler,
  managerIntelligenceHandler,
  type IntelligenceApiContext,
  type IntelligenceDataProvider,
} from '@/lib/decision-os/behavioral/api/intelligence-handlers'
import type { IntelligenceApiError } from '@/lib/decision-os/behavioral/api/contracts'

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_KEY_BASIC        = 'afk_test_abcdefghijklmnop1'
const TEST_KEY_COMMISSIONER = 'afk_test_abcdefghijklmnop2'
const TEST_KEY_MANAGER      = 'afk_test_abcdefghijklmnop3'
const TEST_KEY_PLATFORM     = 'afk_test_abcdefghijklmnop4'

const TEST_KEYS_MAP = JSON.stringify({
  [TEST_KEY_COMMISSIONER]: 'commissioner',
  [TEST_KEY_MANAGER]:      'manager',
  [TEST_KEY_PLATFORM]:     'platform',
})

afterEach(() => vi.unstubAllEnvs())

// ── Helpers ───────────────────────────────────────────────────────────────────

function enableApi() {
  vi.stubEnv('DECISION_OS_INTELLIGENCE_API_ENABLED', 'true')
  vi.stubEnv('INTELLIGENCE_API_TEST_KEYS', TEST_KEYS_MAP)
}

function makeCtx(
  apiKey?: string,
  searchParams: Record<string, string> = {},
): IntelligenceApiContext {
  const headers = new Map<string, string>()
  if (apiKey) headers.set('x-allfantasy-api-key', apiKey)
  return {
    headers:      { get: (k) => headers.get(k.toLowerCase()) ?? null },
    searchParams: new URLSearchParams(searchParams),
  }
}

/** Mock deps that load empty events → degraded but valid intelligence (non-null). */
function makeEmptyDeps() {
  return {
    loadWaiverClaimRows: vi.fn().mockResolvedValue([]),
    loadLeagueTradeRows: vi.fn().mockResolvedValue([]),
    loadRosterMoveRows:  vi.fn().mockResolvedValue([]),
    loadDraftRows:       vi.fn().mockResolvedValue({ session: null, picks: [] }),
    findLeagueIds:       vi.fn().mockResolvedValue([]),
  }
}

/** Mock deps that throw on first call → provider returns null → 503. */
function makeFailingDeps() {
  return {
    loadWaiverClaimRows: vi.fn().mockRejectedValue(new Error('DB unavailable')),
    loadLeagueTradeRows: vi.fn().mockRejectedValue(new Error('DB unavailable')),
    loadRosterMoveRows:  vi.fn().mockRejectedValue(new Error('DB unavailable')),
    loadDraftRows:       vi.fn().mockRejectedValue(new Error('DB unavailable')),
    findLeagueIds:       vi.fn().mockRejectedValue(new Error('DB unavailable')),
  }
}

function errCode(body: unknown): string {
  return (body as IntelligenceApiError).code
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider selection unit
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveDataProvider() — selection', () => {
  it('returns stubDataProvider when env var is not set', () => {
    expect(resolveDataProvider()).toBe(stubDataProvider)
  })

  it('returns stubDataProvider when env var is empty string', () => {
    vi.stubEnv('DECISION_OS_INTELLIGENCE_API_PROVIDER', '')
    expect(resolveDataProvider()).toBe(stubDataProvider)
  })

  it('returns realDataProvider when DECISION_OS_INTELLIGENCE_API_PROVIDER=real', () => {
    vi.stubEnv('DECISION_OS_INTELLIGENCE_API_PROVIDER', 'real')
    expect(resolveDataProvider()).toBe(realDataProvider)
  })

  it.each(['Real', 'REAL', 'staging', 'true', '1', 'enabled'])(
    'returns stubDataProvider for env value "%s" (only "real" activates real provider)',
    (val) => {
      vi.stubEnv('DECISION_OS_INTELLIGENCE_API_PROVIDER', val)
      expect(resolveDataProvider()).toBe(stubDataProvider)
    },
  )

  it('provider selection is stable across multiple calls with same env', () => {
    vi.stubEnv('DECISION_OS_INTELLIGENCE_API_PROVIDER', 'real')
    expect(resolveDataProvider()).toBe(resolveDataProvider())
  })

  it('switches provider immediately when env changes (call-time read)', () => {
    vi.stubEnv('DECISION_OS_INTELLIGENCE_API_PROVIDER', 'real')
    expect(resolveDataProvider()).toBe(realDataProvider)

    vi.stubEnv('DECISION_OS_INTELLIGENCE_API_PROVIDER', '')
    expect(resolveDataProvider()).toBe(stubDataProvider)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Disabled API — gate blocks before provider is reached
// ─────────────────────────────────────────────────────────────────────────────

describe('disabled API', () => {
  it('returns 503 when API disabled, provider env=real — gate blocks at feature-flag check', async () => {
    // API not enabled (DECISION_OS_INTELLIGENCE_API_ENABLED unset); provider env=real irrelevant.
    // Gate uses INTELLIGENCE_UNAVAILABLE code for disabled-API (see gate.ts line ~87).
    vi.stubEnv('DECISION_OS_INTELLIGENCE_API_PROVIDER', 'real')
    const ctx = makeCtx(TEST_KEY_PLATFORM)
    const result = await platformIntelligenceHandler(ctx, resolveDataProvider())
    expect(result.status).toBe(503)
    expect(errCode(result.body)).toBe('INTELLIGENCE_UNAVAILABLE')
    const body = result.body as IntelligenceApiError
    expect(body.message).toContain('not enabled')
  })

  it('returns 503 when API disabled, provider env unset', async () => {
    const ctx = makeCtx(TEST_KEY_PLATFORM)
    const result = await platformIntelligenceHandler(ctx, resolveDataProvider())
    expect(result.status).toBe(503)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Enabled + stub provider (default — no env var)
// ─────────────────────────────────────────────────────────────────────────────

describe('enabled + stub provider', () => {
  it('platform: returns 503 INTELLIGENCE_UNAVAILABLE (stub → null)', async () => {
    enableApi()
    const ctx = makeCtx(TEST_KEY_PLATFORM)
    const result = await platformIntelligenceHandler(ctx, resolveDataProvider())
    expect(result.status).toBe(503)
    expect(errCode(result.body)).toBe('INTELLIGENCE_UNAVAILABLE')
  })

  it('league: returns 503 INTELLIGENCE_UNAVAILABLE (stub → null)', async () => {
    enableApi()
    const ctx = makeCtx(TEST_KEY_COMMISSIONER, { leagueId: 'lg-1' })
    const result = await leagueIntelligenceHandler(ctx, resolveDataProvider())
    expect(result.status).toBe(503)
    expect(errCode(result.body)).toBe('INTELLIGENCE_UNAVAILABLE')
  })

  it('manager: returns 503 INTELLIGENCE_UNAVAILABLE (stub → null)', async () => {
    enableApi()
    const ctx = makeCtx(TEST_KEY_MANAGER, { leagueId: 'lg-1', managerId: 'mgr-1' })
    const result = await managerIntelligenceHandler(ctx, resolveDataProvider())
    expect(result.status).toBe(503)
    expect(errCode(result.body)).toBe('INTELLIGENCE_UNAVAILABLE')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Enabled + real provider (mock deps succeeding) → 200
// ─────────────────────────────────────────────────────────────────────────────

describe('enabled + real provider (mock deps succeeding)', () => {
  it('platform: returns 200 with IntelligenceApiResponse envelope', async () => {
    enableApi()
    const provider = createRealDataProvider(makeEmptyDeps())
    const ctx = makeCtx(TEST_KEY_PLATFORM)
    const result = await platformIntelligenceHandler(ctx, provider)
    expect(result.status).toBe(200)
    const body = result.body as { data: unknown; meta: { requestId: string } }
    expect(body.data).toBeDefined()
    expect(body.meta.requestId).toMatch(/^[0-9a-z]+-[0-9a-z]+$/)
  })

  it('league: returns 200 with leagueId in response data', async () => {
    enableApi()
    const provider = createRealDataProvider({
      ...makeEmptyDeps(),
      findLeagueIds: vi.fn().mockResolvedValue([]),
    })
    const ctx = makeCtx(TEST_KEY_COMMISSIONER, { leagueId: 'lg-test-1' })
    const result = await leagueIntelligenceHandler(ctx, provider)
    expect(result.status).toBe(200)
    const body = result.body as { data: { leagueId: string } }
    expect(body.data.leagueId).toBe('lg-test-1')
  })

  it('manager: returns 200 with managerId in response data', async () => {
    enableApi()
    const provider = createRealDataProvider(makeEmptyDeps())
    const ctx = makeCtx(TEST_KEY_MANAGER, { leagueId: 'lg-1', managerId: 'mgr-abc' })
    const result = await managerIntelligenceHandler(ctx, provider)
    expect(result.status).toBe(200)
    const body = result.body as { data: { managerId: string } }
    expect(body.data.managerId).toBe('mgr-abc')
  })

  it('platform basic tier: response meta.tier is basic (not full)', async () => {
    enableApi()
    const provider = createRealDataProvider(makeEmptyDeps())
    const ctx = makeCtx(TEST_KEY_BASIC)
    const result = await platformIntelligenceHandler(ctx, provider)
    // basic tier has platform:basic scope
    expect(result.status).toBe(200)
    const body = result.body as { meta: { tier: string } }
    expect(body.meta.tier).toBe('basic')
  })

  it('platform platform tier: response meta.tier is platform (full response)', async () => {
    enableApi()
    const provider = createRealDataProvider(makeEmptyDeps())
    const ctx = makeCtx(TEST_KEY_PLATFORM)
    const result = await platformIntelligenceHandler(ctx, provider)
    expect(result.status).toBe(200)
    const body = result.body as { meta: { tier: string } }
    expect(body.meta.tier).toBe('platform')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Real provider unavailable (mock deps throwing) → 503
// ─────────────────────────────────────────────────────────────────────────────

describe('real provider unavailable', () => {
  it('platform: returns 503 INTELLIGENCE_UNAVAILABLE when provider DB fails', async () => {
    enableApi()
    const provider = createRealDataProvider({
      ...makeFailingDeps(),
      findLeagueIds: vi.fn().mockRejectedValue(new Error('DB down')),
    })
    const ctx = makeCtx(TEST_KEY_PLATFORM)
    const result = await platformIntelligenceHandler(ctx, provider)
    expect(result.status).toBe(503)
    expect(errCode(result.body)).toBe('INTELLIGENCE_UNAVAILABLE')
  })

  it('league: returns 503 INTELLIGENCE_UNAVAILABLE when provider DB fails', async () => {
    enableApi()
    const provider = createRealDataProvider(makeFailingDeps())
    const ctx = makeCtx(TEST_KEY_COMMISSIONER, { leagueId: 'lg-1' })
    const result = await leagueIntelligenceHandler(ctx, provider)
    expect(result.status).toBe(503)
    expect(errCode(result.body)).toBe('INTELLIGENCE_UNAVAILABLE')
  })

  it('manager: returns 503 INTELLIGENCE_UNAVAILABLE when provider DB fails', async () => {
    enableApi()
    const provider = createRealDataProvider(makeFailingDeps())
    const ctx = makeCtx(TEST_KEY_MANAGER, { leagueId: 'lg-1', managerId: 'mgr-1' })
    const result = await managerIntelligenceHandler(ctx, provider)
    expect(result.status).toBe(503)
    expect(errCode(result.body)).toBe('INTELLIGENCE_UNAVAILABLE')
  })

  it('503 body carries INTELLIGENCE_UNAVAILABLE code and requestId', async () => {
    enableApi()
    const provider = createRealDataProvider(makeFailingDeps())
    const ctx = makeCtx(TEST_KEY_PLATFORM)
    const result = await platformIntelligenceHandler(ctx, provider)
    const body = result.body as IntelligenceApiError
    expect(body.code).toBe('INTELLIGENCE_UNAVAILABLE')
    expect(body.message).toBeTruthy()
    expect(body.requestId).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Auth / scope enforcement — unaffected by provider selection
// ─────────────────────────────────────────────────────────────────────────────

describe('auth / scope enforcement (independent of provider)', () => {
  it('missing API key → 401 UNAUTHORIZED even with real provider enabled', async () => {
    enableApi()
    vi.stubEnv('DECISION_OS_INTELLIGENCE_API_PROVIDER', 'real')
    const ctx = makeCtx(/* no key */)
    const result = await platformIntelligenceHandler(ctx, resolveDataProvider())
    expect(result.status).toBe(401)
    expect(errCode(result.body)).toBe('UNAUTHORIZED')
  })

  it('invalid key format → 401 UNAUTHORIZED regardless of provider', async () => {
    enableApi()
    vi.stubEnv('DECISION_OS_INTELLIGENCE_API_PROVIDER', 'real')
    const ctx = makeCtx('not-a-valid-key')
    const result = await platformIntelligenceHandler(ctx, resolveDataProvider())
    expect(result.status).toBe(401)
    expect(errCode(result.body)).toBe('UNAUTHORIZED')
  })

  it('basic tier → 403 FORBIDDEN for league scope (commissioner+ required)', async () => {
    enableApi()
    const provider = createRealDataProvider(makeEmptyDeps())
    const ctx = makeCtx(TEST_KEY_BASIC, { leagueId: 'lg-1' })
    const result = await leagueIntelligenceHandler(ctx, provider)
    expect(result.status).toBe(403)
    expect(errCode(result.body)).toBe('FORBIDDEN')
  })

  it('commissioner tier → 403 FORBIDDEN for manager scope (manager+ required)', async () => {
    enableApi()
    const provider = createRealDataProvider(makeEmptyDeps())
    const ctx = makeCtx(TEST_KEY_COMMISSIONER, { leagueId: 'lg-1', managerId: 'mgr-1' })
    const result = await managerIntelligenceHandler(ctx, provider)
    expect(result.status).toBe(403)
    expect(errCode(result.body)).toBe('FORBIDDEN')
  })

  it('param validation: missing leagueId → 400 INVALID_REQUEST (before provider called)', async () => {
    enableApi()
    const provider: IntelligenceDataProvider = {
      getManagerIntelligence:  vi.fn(),
      getLeagueIntelligence:   vi.fn(),
      getPlatformIntelligence: vi.fn(),
      getLeagueManagerIntelligences: vi.fn(),
    }
    const ctx = makeCtx(TEST_KEY_COMMISSIONER /* no leagueId */)
    const result = await leagueIntelligenceHandler(ctx, provider)
    expect(result.status).toBe(400)
    expect(errCode(result.body)).toBe('INVALID_REQUEST')
    // Provider was never called — validation happens before data load
    expect(provider.getLeagueIntelligence).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Route file thin-wrapper assertion (structural)
// ─────────────────────────────────────────────────────────────────────────────

describe('route file thin-wrapper structure', () => {
  /**
   * 🛑 `manager/route.ts` IS NO LONGER IN THIS LIST, AND ITS ABSENCE IS AN ASSERTION IN ITSELF.
   * Milestone 32's privacy pass replaced that handler with `retiredProfileRoute` — a constant 410 —
   * so it neither has nor should have any provider wiring. Leaving it here made this suite demand
   * `resolveDataProvider()` from a file that deliberately no longer selects a provider, which is a
   * test asserting the contract the milestone removed. It is covered by its own case below instead.
   */
  const routeFiles = [
    'app/api/v1/intelligence/platform/route.ts',
    'app/api/v1/intelligence/league/route.ts',
  ]

  it.each(routeFiles)('%s calls resolveDataProvider() and contains no inline selection logic', async (relPath) => {
    const { readFileSync } = await import('node:fs')
    const { resolve }      = await import('node:path')
    const content = readFileSync(resolve(process.cwd(), relPath), 'utf8')

    // Must delegate provider selection to the selector
    expect(content).toContain('resolveDataProvider()')

    // Must NOT import providers directly or read env inline — selection belongs in the selector
    expect(content).not.toMatch(/import.*stubDataProvider/)
    expect(content).not.toMatch(/import.*realDataProvider/)
    expect(content).not.toContain("process.env['DECISION_OS_INTELLIGENCE_API_PROVIDER']")
    expect(content).not.toContain('process.env.DECISION_OS_INTELLIGENCE_API_PROVIDER')
  })

  /**
   * The retired sibling. This is the inverse assertion: the file must reach NO provider at all.
   *
   * ⚠ IT PINS ABSENCE AS WELL AS PRESENCE, BECAUSE `retiredProfileRoute` ALONE WOULD NOT. A file
   * could import the retirement helper AND still carry live provider wiring underneath it; only the
   * negative clauses catch that. This is the same reasoning as the positive case above, pointed the
   * other way — and it is why the route was moved to its own test rather than deleted from the list.
   */
  it('app/api/v1/intelligence/manager/route.ts is RETIRED and reaches no provider at all', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve }      = await import('node:path')
    const content = readFileSync(resolve(process.cwd(), 'app/api/v1/intelligence/manager/route.ts'), 'utf8')

    expect(content).toContain('retiredProfileRoute')

    expect(content).not.toContain('resolveDataProvider()')
    expect(content).not.toMatch(/import.*stubDataProvider/)
    expect(content).not.toMatch(/import.*realDataProvider/)
    expect(content).not.toContain("process.env['DECISION_OS_INTELLIGENCE_API_PROVIDER']")
    expect(content).not.toContain('process.env.DECISION_OS_INTELLIGENCE_API_PROVIDER')
  })
})
