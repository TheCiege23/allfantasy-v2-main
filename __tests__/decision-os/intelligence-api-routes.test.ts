/**
 * Phase 5.7 — Intelligence API route handler tests.
 *
 * Tests the handler cores (gate, scope, params, resolver wiring) without HTTP.
 * Route files are thin wrappers; all logic lives in intelligence-handlers.ts.
 *
 * Coverage:
 *   - Disabled state (feature flag off) → 503 on all handlers
 *   - Auth: missing key, invalid format, unknown live key → 401
 *   - Test-env key resolution (INTELLIGENCE_API_TEST_KEYS lookup)
 *   - Scope gating: basic/commissioner/manager/platform tier matrix
 *   - Query param validation: missing leagueId, missing managerId
 *   - Data unavailable (stubDataProvider) → 503
 *   - Successful resolver call → 200 with IntelligenceApiResponse envelope
 *   - Platform: basic tier → basic resolver (meta.tier='basic')
 *   - Platform: platform tier → full resolver (meta.tier='platform')
 *   - Error shape contract (code, message, requestId on every error)
 *   - No mutation of input intelligence
 */

import { vi, describe, it, expect, afterEach } from 'vitest'
import type { ManagerBehavioralIntelligence } from '../../lib/decision-os/behavioral/manager-intelligence'
import type { LeagueBehavioralIntelligence }  from '../../lib/decision-os/behavioral/league-intelligence'
import type { PlatformBehavioralIntelligence } from '../../lib/decision-os/behavioral/platform-intelligence'
import {
  platformIntelligenceHandler,
  leagueIntelligenceHandler,
  managerIntelligenceHandler,
  stubDataProvider,
} from '../../lib/decision-os/behavioral/api/intelligence-handlers'
import type {
  IntelligenceDataProvider,
  IntelligenceApiContext,
} from '../../lib/decision-os/behavioral/api/intelligence-handlers'
import type { IntelligenceApiError } from '../../lib/decision-os/behavioral/api/contracts'

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_KEY_BASIC        = 'afk_test_abcdefghijklmnop1'   // 16 char token
const TEST_KEY_COMMISSIONER = 'afk_test_abcdefghijklmnop2'
const TEST_KEY_MANAGER      = 'afk_test_abcdefghijklmnop3'
const TEST_KEY_PLATFORM     = 'afk_test_abcdefghijklmnop4'
const LIVE_KEY_PLATFORM     = 'afk_live_abcdefghijklmnop5'

const TEST_KEYS_MAP = JSON.stringify({
  [TEST_KEY_COMMISSIONER]: 'commissioner',
  [TEST_KEY_MANAGER]:      'manager',
  [TEST_KEY_PLATFORM]:     'platform',
  [LIVE_KEY_PLATFORM]:     'platform',
})

const NOW_ISO = '2026-06-30T12:00:00.000Z'

// ── Env helpers ───────────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllEnvs()
})

function enableApi(testKeys = TEST_KEYS_MAP) {
  vi.stubEnv('DECISION_OS_INTELLIGENCE_API_ENABLED', 'true')
  vi.stubEnv('INTELLIGENCE_API_TEST_KEYS', testKeys)
}

// ── Context builders ──────────────────────────────────────────────────────────

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

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeManagerIntel(
  overrides: Partial<ManagerBehavioralIntelligence> = {},
): ManagerBehavioralIntelligence {
  return {
    managerId: 'mgr-001', leagueId: 'lgr-001',
    participationTier: 'active', retentionRisk: 'low',
    retentionRiskReasons: ['Manager has set lineups consistently'],
    lineupEngagement: { score: 80, level: 'high',     eventCount: 8, lastEventAt: NOW_ISO, warnings: [] },
    waiverEngagement: { score: 55, level: 'moderate', eventCount: 3, lastEventAt: NOW_ISO, warnings: [] },
    tradeEngagement:  { score: 40, level: 'low',      eventCount: 1, lastEventAt: null,    warnings: [] },
    draftEngagement:  { score: 75, level: 'high',     eventCount: 12, lastEventAt: NOW_ISO, warnings: [] },
    overallEngagementScore: 67,
    daysSinceLastActivity: 1, isInactive: false, inactivityWarning: null,
    nudges: [],
    completeness: 85, derivedFrom: 12, lookbackDays: 90,
    warnings: [], derivedAt: NOW_ISO,
    ...overrides,
  }
}

function makeLeagueIntel(
  overrides: Partial<LeagueBehavioralIntelligence> = {},
): LeagueBehavioralIntelligence {
  return {
    leagueId: 'lgr-001',
    leagueEngagementScore: 72, leagueEngagementTier: 'active',
    participationDistribution: { totalManagers: 10, activeManagers: 8, inactiveManagers: 2, activePercent: 80, inactivePercent: 20 },
    inactiveManagerCount: 2,
    tradeActivity:  { tier: 'moderate', count: 8,  perManagerRate: 0.8,  warnings: [] },
    waiverActivity: { tier: 'high',     count: 25, perManagerRate: 2.5,  warnings: [] },
    draftActivity:  { tier: 'high',     count: 90, perManagerRate: 9.0,  warnings: [] },
    retentionRisk: 'low', retentionRiskReasons: [],
    commissionerWorkload: 'light', commissionerWorkloadItems: [],
    recommendations: [],
    healthNarrativeInputs: { engagementSummary: 'ok', topConcern: null, standoutSignal: null },
    completeness: 80, derivedFrom: 100, managerCount: 10, lookbackDays: 90,
    warnings: [], derivedAt: NOW_ISO,
    ...overrides,
  }
}

function makePlatformIntel(
  overrides: Partial<PlatformBehavioralIntelligence> = {},
): PlatformBehavioralIntelligence {
  return {
    platformEngagementScore: 65, platformEngagementTier: 'healthy',
    leagueHealthDistribution: { elite: 2, active: 5, moderate: 2, passive: 1, dormant: 0, totalLeagues: 10, healthyPercent: 70, atRiskPercent: 10 },
    retentionDistribution: {
      managersByCriticalRisk: 3, managersByHighRisk: 7, managersByMediumRisk: 15, managersByLowRisk: 75,
      totalManagers: 100, managerCriticalRiskPercent: 3, managerAtRiskPercent: 10,
      leaguesByCriticalRisk: 1, leaguesByHighRisk: 2, leaguesByMediumRisk: 3, leaguesByLowRisk: 4,
      totalLeagues: 10, leagueCriticalRiskPercent: 10, leagueAtRiskPercent: 30,
    },
    commissionerQualityDistribution: { light: 5, moderate: 3, heavy: 1, critical: 1, totalLeagues: 10, managedPercent: 80, overloadedPercent: 20 },
    tradeEcosystem:    { tier: 'moderate', totalEvents: 80,  activeLeagues: 7,  totalLeagues: 10, activeLeaguePercent: 70,  perLeagueRate: 8.0,  perManagerRate: 0.8, warnings: [] },
    waiverEcosystem:   { tier: 'high',     totalEvents: 250, activeLeagues: 10, totalLeagues: 10, activeLeaguePercent: 100, perLeagueRate: 25.0, perManagerRate: 2.5, warnings: [] },
    draftParticipation:{ tier: 'high',     totalEvents: 900, activeLeagues: 10, totalLeagues: 10, activeLeaguePercent: 100, perLeagueRate: 90.0, perManagerRate: 9.0, warnings: [] },
    engagementTrends: { sevenDayEventCount: 40, thirtyDayEventCount: 150, recentActivityRatio: 0.27, recentlyActiveManagerPercent: 60, momentumSignal: 'steady', trendConfidence: 'medium', warnings: [] },
    activityHeatmap:   { cells: [{ dayOfWeek: 1, hour: 20, count: 12 }], peakCellKey: '1-20', peakDayOfWeek: 1, peakHour: 20, peakCount: 12, totalEventsAnalyzed: 230, warnings: [] },
    interventionOpportunities: [],
    completeness: 75, uncertainty: 'medium',
    warnings: [], provenance: { leagueIntelligenceCount: 10, managerIntelligenceCount: 100, eventCount: 230, avgLeagueLookbackDays: 90, derivedAt: NOW_ISO },
    derivedAt: NOW_ISO,
    ...overrides,
  }
}

function makeProvider(overrides: Partial<IntelligenceDataProvider> = {}): IntelligenceDataProvider {
  return {
    getManagerIntelligence:  async () => makeManagerIntel(),
    getLeagueIntelligence:   async () => makeLeagueIntel(),
    getPlatformIntelligence: async () => makePlatformIntel(),
    getLeagueManagerIntelligences: async () => [makeManagerIntel()],
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disabled state — feature flag off
// ─────────────────────────────────────────────────────────────────────────────

describe('disabled state — feature flag not set', () => {
  it('platform handler returns 503', async () => {
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM), makeProvider())
    expect(r.status).toBe(503)
  })

  it('league handler returns 503', async () => {
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM, { leagueId: 'lgr-1' }), makeProvider())
    expect(r.status).toBe(503)
  })

  it('manager handler returns 503', async () => {
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM, { leagueId: 'lgr-1', managerId: 'mgr-1' }), makeProvider())
    expect(r.status).toBe(503)
  })

  it('error body has code INTELLIGENCE_UNAVAILABLE', async () => {
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM), makeProvider())
    const body = r.body as IntelligenceApiError
    expect(body.code).toBe('INTELLIGENCE_UNAVAILABLE')
  })

  it('error body has requestId even when disabled', async () => {
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM), makeProvider())
    const body = r.body as IntelligenceApiError
    expect(typeof body.requestId).toBe('string')
    expect(body.requestId.length).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Auth — API key validation
// ─────────────────────────────────────────────────────────────────────────────

describe('auth — missing API key', () => {
  it('returns 401 when header absent', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(/* no key */), makeProvider())
    expect(r.status).toBe(401)
    expect((r.body as IntelligenceApiError).code).toBe('UNAUTHORIZED')
  })

  it('message describes missing header', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(), makeProvider())
    expect((r.body as IntelligenceApiError).message).toMatch(/missing/i)
  })
})

describe('auth — invalid key format', () => {
  const badKeys = [
    'not-an-api-key',
    'afk_',
    'afk_test_short',   // token < 16 chars
    'afk_prod_abcdefghijklmnop',  // env not 'test' or 'live'
    '',
  ]

  for (const key of badKeys) {
    it(`returns 401 for key "${key}"`, async () => {
      enableApi()
      const r = await platformIntelligenceHandler(makeCtx(key), makeProvider())
      expect(r.status).toBe(401)
      expect((r.body as IntelligenceApiError).code).toBe('UNAUTHORIZED')
    })
  }
})

describe('auth — unknown live key', () => {
  it('returns 401 for live key not in INTELLIGENCE_API_TEST_KEYS map', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx('afk_live_unknownkey1234567'), makeProvider())
    expect(r.status).toBe(401)
    expect((r.body as IntelligenceApiError).code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when INTELLIGENCE_API_TEST_KEYS is not set (live key)', async () => {
    vi.stubEnv('DECISION_OS_INTELLIGENCE_API_ENABLED', 'true')
    // do NOT set INTELLIGENCE_API_TEST_KEYS
    const r = await platformIntelligenceHandler(makeCtx('afk_live_unknownkey1234567'), makeProvider())
    expect(r.status).toBe(401)
  })
})

describe('auth — test key defaults', () => {
  it('unknown test key gets basic tier (dev mode) — platform returns 200 basic', async () => {
    enableApi()
    // TEST_KEY_BASIC is not in the map → falls back to basic tier
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    expect(r.status).toBe(200)
    const env = r.body as { meta: { tier: string } }
    expect(env.meta.tier).toBe('basic')
  })

  it('known live key resolves to mapped tier — platform returns 200 full', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(LIVE_KEY_PLATFORM), makeProvider())
    expect(r.status).toBe(200)
    const env = r.body as { meta: { tier: string } }
    expect(env.meta.tier).toBe('platform')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase L1 — API Security Hardening: Production must reject every
// unregistered key, closing the dev-mode test-key fallback specifically
// in Production while leaving Preview/Development unaffected.
// ─────────────────────────────────────────────────────────────────────────────

describe('auth — Production environment hardening (Phase L1)', () => {
  it('unknown test key is rejected (401) when VERCEL_ENV=production', async () => {
    enableApi()
    vi.stubEnv('VERCEL_ENV', 'production')
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    expect(r.status).toBe(401)
    expect((r.body as IntelligenceApiError).code).toBe('UNAUTHORIZED')
  })

  it('unknown live key is still rejected (401) when VERCEL_ENV=production — unaffected, already strict', async () => {
    enableApi()
    vi.stubEnv('VERCEL_ENV', 'production')
    const r = await platformIntelligenceHandler(makeCtx('afk_live_unknownkey1234567'), makeProvider())
    expect(r.status).toBe(401)
    expect((r.body as IntelligenceApiError).code).toBe('UNAUTHORIZED')
  })

  it('a registered test key still resolves its mapped tier in production — hardening only removes the fallback, not registered keys', async () => {
    enableApi()
    vi.stubEnv('VERCEL_ENV', 'production')
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM), makeProvider())
    expect(r.status).toBe(200)
    expect((r.body as { meta: { tier: string } }).meta.tier).toBe('platform')
  })

  it('a registered live key still resolves its mapped tier in production', async () => {
    enableApi()
    vi.stubEnv('VERCEL_ENV', 'production')
    const r = await platformIntelligenceHandler(makeCtx(LIVE_KEY_PLATFORM), makeProvider())
    expect(r.status).toBe(200)
    expect((r.body as { meta: { tier: string } }).meta.tier).toBe('platform')
  })

  it('the dev-mode fallback still works when VERCEL_ENV=preview — Preview is unaffected', async () => {
    enableApi()
    vi.stubEnv('VERCEL_ENV', 'preview')
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    expect(r.status).toBe(200)
    expect((r.body as { meta: { tier: string } }).meta.tier).toBe('basic')
  })

  it('the dev-mode fallback still works when VERCEL_ENV=development — Development is unaffected', async () => {
    enableApi()
    vi.stubEnv('VERCEL_ENV', 'development')
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    expect(r.status).toBe(200)
    expect((r.body as { meta: { tier: string } }).meta.tier).toBe('basic')
  })

  it('the dev-mode fallback still works when VERCEL_ENV is entirely unset (local dev) — unchanged from before this hardening', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    expect(r.status).toBe(200)
    expect((r.body as { meta: { tier: string } }).meta.tier).toBe('basic')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scope gating — platformIntelligenceHandler
// ─────────────────────────────────────────────────────────────────────────────

describe('scope gating — platform endpoint', () => {
  it('basic tier (key not in map) → 200 with basic response', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    expect(r.status).toBe(200)
  })

  it('commissioner tier → 200 with basic response', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER), makeProvider())
    expect(r.status).toBe(200)
    expect((r.body as { meta: { tier: string } }).meta.tier).toBe('basic')
  })

  it('manager tier → 200 with basic response', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_MANAGER), makeProvider())
    expect(r.status).toBe(200)
    expect((r.body as { meta: { tier: string } }).meta.tier).toBe('basic')
  })

  it('platform tier → 200 with full response (meta.tier=platform)', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM), makeProvider())
    expect(r.status).toBe(200)
    expect((r.body as { meta: { tier: string } }).meta.tier).toBe('platform')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scope gating — leagueIntelligenceHandler
// ─────────────────────────────────────────────────────────────────────────────

describe('scope gating — league endpoint', () => {
  const league = { leagueId: 'lgr-001' }

  it('basic tier → 403 FORBIDDEN', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_BASIC, league), makeProvider())
    expect(r.status).toBe(403)
    expect((r.body as IntelligenceApiError).code).toBe('FORBIDDEN')
  })

  it('manager tier → 403 FORBIDDEN (no league:read scope)', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_MANAGER, league), makeProvider())
    expect(r.status).toBe(403)
  })

  it('commissioner tier → 200', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, league), makeProvider())
    expect(r.status).toBe(200)
  })

  it('platform tier → 200', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM, league), makeProvider())
    expect(r.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scope gating — managerIntelligenceHandler
// ─────────────────────────────────────────────────────────────────────────────

describe('scope gating — manager endpoint', () => {
  const params = { leagueId: 'lgr-001', managerId: 'mgr-001' }

  it('basic tier → 403 FORBIDDEN', async () => {
    enableApi()
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_BASIC, params), makeProvider())
    expect(r.status).toBe(403)
    expect((r.body as IntelligenceApiError).code).toBe('FORBIDDEN')
  })

  it('commissioner tier → 403 FORBIDDEN (no manager:read scope)', async () => {
    enableApi()
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, params), makeProvider())
    expect(r.status).toBe(403)
  })

  it('manager tier → 200', async () => {
    enableApi()
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_MANAGER, params), makeProvider())
    expect(r.status).toBe(200)
  })

  it('platform tier → 200', async () => {
    enableApi()
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM, params), makeProvider())
    expect(r.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Query param validation
// ─────────────────────────────────────────────────────────────────────────────

describe('query param validation — league endpoint', () => {
  it('missing leagueId → 400 INVALID_REQUEST', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER), makeProvider())
    expect(r.status).toBe(400)
    expect((r.body as IntelligenceApiError).code).toBe('INVALID_REQUEST')
  })

  it('empty leagueId → 400', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, { leagueId: '   ' }), makeProvider())
    expect(r.status).toBe(400)
  })

  it('error message names the missing param', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER), makeProvider())
    expect((r.body as IntelligenceApiError).message).toMatch(/leagueId/)
  })
})

describe('query param validation — manager endpoint', () => {
  it('missing leagueId → 400', async () => {
    enableApi()
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_MANAGER, { managerId: 'mgr-1' }), makeProvider())
    expect(r.status).toBe(400)
    expect((r.body as IntelligenceApiError).message).toMatch(/leagueId/)
  })

  it('missing managerId → 400', async () => {
    enableApi()
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_MANAGER, { leagueId: 'lgr-1' }), makeProvider())
    expect(r.status).toBe(400)
    expect((r.body as IntelligenceApiError).message).toMatch(/managerId/)
  })

  it('both missing → 400 names leagueId first', async () => {
    enableApi()
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_MANAGER), makeProvider())
    expect(r.status).toBe(400)
    expect((r.body as IntelligenceApiError).message).toMatch(/leagueId/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Data unavailable — stub provider (Phase 5.7 default)
// ─────────────────────────────────────────────────────────────────────────────

describe('data unavailable — stubDataProvider', () => {
  it('platform → 503 INTELLIGENCE_UNAVAILABLE', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), stubDataProvider)
    expect(r.status).toBe(503)
    expect((r.body as IntelligenceApiError).code).toBe('INTELLIGENCE_UNAVAILABLE')
  })

  it('league → 503', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, { leagueId: 'lgr-1' }), stubDataProvider)
    expect(r.status).toBe(503)
  })

  it('manager → 503', async () => {
    enableApi()
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_MANAGER, { leagueId: 'lgr-1', managerId: 'mgr-1' }), stubDataProvider)
    expect(r.status).toBe(503)
  })

  it('error body has requestId', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), stubDataProvider)
    expect(typeof (r.body as IntelligenceApiError).requestId).toBe('string')
    expect((r.body as IntelligenceApiError).requestId.length).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Successful resolver call — 200 envelope shape
// ─────────────────────────────────────────────────────────────────────────────

describe('successful call — platform basic resolver', () => {
  it('returns 200', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    expect(r.status).toBe(200)
  })

  it('body has data and meta', () => {
    enableApi()
    const r = platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    return r.then((result) => {
      const body = result.body as { data: unknown; meta: unknown }
      expect(body.data).toBeDefined()
      expect(body.meta).toBeDefined()
    })
  })

  it('meta has version v1', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    expect((r.body as { meta: { version: string } }).meta.version).toBe('v1')
  })

  it('meta.tier is basic for basic key', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    expect((r.body as { meta: { tier: string } }).meta.tier).toBe('basic')
  })

  it('meta.completeness matches intel completeness', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    expect((r.body as { meta: { completeness: number } }).meta.completeness).toBe(75)
  })

  it('meta.requestId is a non-empty string', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    const reqId = (r.body as { meta: { requestId: string } }).meta.requestId
    expect(typeof reqId).toBe('string')
    expect(reqId.length).toBeGreaterThan(0)
  })

  it('basic response has no ecosystem rates (privacy)', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    const data = (r.body as { data: Record<string, unknown> }).data
    expect('tradeEcosystem' in data).toBe(false)
    expect('waiverEcosystem' in data).toBe(false)
    expect('draftParticipation' in data).toBe(false)
  })

  it('basic response has no interventionOpportunities (privacy)', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), makeProvider())
    const data = (r.body as { data: Record<string, unknown> }).data
    expect('interventionOpportunities' in data).toBe(false)
  })
})

describe('successful call — platform full resolver (platform tier)', () => {
  it('returns 200', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM), makeProvider())
    expect(r.status).toBe(200)
  })

  it('meta.tier is platform', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM), makeProvider())
    expect((r.body as { meta: { tier: string } }).meta.tier).toBe('platform')
  })

  it('full response has leagueHealthDistribution', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM), makeProvider())
    const data = (r.body as { data: Record<string, unknown> }).data
    expect('leagueHealthDistribution' in data).toBe(true)
  })

  it('full response has ecosystem rates', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM), makeProvider())
    const data = (r.body as { data: Record<string, unknown> }).data
    expect('tradeEcosystem' in data).toBe(true)
    expect('waiverEcosystem' in data).toBe(true)
  })

  it('full response ecosystem does not include totalEvents (privacy)', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM), makeProvider())
    const ecosystem = (r.body as { data: { tradeEcosystem: Record<string, unknown> } }).data.tradeEcosystem
    expect('totalEvents' in ecosystem).toBe(false)
  })

  it('full response has no provenance (privacy)', async () => {
    enableApi()
    const r = await platformIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM), makeProvider())
    const data = (r.body as { data: Record<string, unknown> }).data
    expect('provenance' in data).toBe(false)
  })
})

describe('successful call — league resolver (commissioner tier)', () => {
  const params = { leagueId: 'lgr-001' }

  it('returns 200', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, params), makeProvider())
    expect(r.status).toBe(200)
  })

  it('meta.tier is commissioner', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, params), makeProvider())
    expect((r.body as { meta: { tier: string } }).meta.tier).toBe('commissioner')
  })

  it('data has leagueId', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, params), makeProvider())
    expect((r.body as { data: { leagueId: string } }).data.leagueId).toBe('lgr-001')
  })

  it('data has no raw count on tradeActivity (privacy)', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, params), makeProvider())
    const trade = (r.body as { data: { tradeActivity: Record<string, unknown> } }).data.tradeActivity
    expect('count' in trade).toBe(false)
  })

  it('data has no warnings (privacy)', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, params), makeProvider())
    const data = (r.body as { data: Record<string, unknown> }).data
    expect('warnings' in data).toBe(false)
  })

  it('Phase 3.3: data has healthNarrative — the same real, already-computed healthNarrativeInputs, no longer stripped', async () => {
    enableApi()
    const r = await leagueIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, params), makeProvider())
    const data = (r.body as { data: { healthNarrative: { engagementSummary: string; topConcern: string | null; standoutSignal: string | null } } }).data
    expect(data.healthNarrative).toEqual({ engagementSummary: 'ok', topConcern: null, standoutSignal: null })
  })
})

describe('successful call — manager resolver (manager tier)', () => {
  const params = { leagueId: 'lgr-001', managerId: 'mgr-001' }

  it('returns 200', async () => {
    enableApi()
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_MANAGER, params), makeProvider())
    expect(r.status).toBe(200)
  })

  it('meta.tier is manager', async () => {
    enableApi()
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_MANAGER, params), makeProvider())
    expect((r.body as { meta: { tier: string } }).meta.tier).toBe('manager')
  })

  it('data has managerId', async () => {
    enableApi()
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_MANAGER, params), makeProvider())
    expect((r.body as { data: { managerId: string } }).data.managerId).toBe('mgr-001')
  })

  it('data.nudges strips signal (privacy)', async () => {
    enableApi()
    const intel = makeManagerIntel({
      nudges: [{ nudgeId: 'n1', priority: 'low', category: 'engagement', signal: 'internal_sig', message: 'msg', supportingEventIds: [] }],
    })
    const provider = makeProvider({ getManagerIntelligence: async () => intel })
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_MANAGER, params), provider)
    const nudge = (r.body as { data: { nudges: Record<string, unknown>[] } }).data.nudges[0]
    expect('signal' in nudge).toBe(false)
    expect('supportingEventIds' in nudge).toBe(false)
  })

  it('engagement dimensions strip eventCount (privacy)', async () => {
    enableApi()
    const r = await managerIntelligenceHandler(makeCtx(TEST_KEY_MANAGER, params), makeProvider())
    const lineup = (r.body as { data: { engagementDimensions: { lineup: Record<string, unknown> } } }).data.engagementDimensions.lineup
    expect('eventCount' in lineup).toBe(false)
    expect('lastEventAt' in lineup).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error shape contract
// ─────────────────────────────────────────────────────────────────────────────

describe('error shape contract', () => {
  const errorScenarios: Array<{ label: string; fn: () => Promise<{ status: number; body: unknown }> }> = [
    {
      label: 'disabled state',
      fn: () => platformIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM), makeProvider()),
    },
    {
      label: 'missing API key',
      fn: () => { enableApi(); return platformIntelligenceHandler(makeCtx(), makeProvider()) },
    },
    {
      label: 'invalid key format',
      fn: () => { enableApi(); return platformIntelligenceHandler(makeCtx('bad-key'), makeProvider()) },
    },
    {
      label: 'scope FORBIDDEN',
      fn: () => { enableApi(); return leagueIntelligenceHandler(makeCtx(TEST_KEY_BASIC, { leagueId: 'lgr-1' }), makeProvider()) },
    },
    {
      label: 'missing param',
      fn: () => { enableApi(); return leagueIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER), makeProvider()) },
    },
    {
      label: 'data unavailable',
      fn: () => { enableApi(); return platformIntelligenceHandler(makeCtx(TEST_KEY_BASIC), stubDataProvider) },
    },
  ]

  for (const scenario of errorScenarios) {
    it(`error body has code, message, requestId — ${scenario.label}`, async () => {
      const r = await scenario.fn()
      const body = r.body as IntelligenceApiError
      expect(typeof body.code).toBe('string')
      expect(body.code.length).toBeGreaterThan(0)
      expect(typeof body.message).toBe('string')
      expect(body.message.length).toBeGreaterThan(0)
      expect(typeof body.requestId).toBe('string')
      expect(body.requestId.length).toBeGreaterThan(0)
    })
  }

  it('requestId differs between calls (not static)', async () => {
    enableApi()
    const [a, b] = await Promise.all([
      platformIntelligenceHandler(makeCtx(), makeProvider()),
      platformIntelligenceHandler(makeCtx(), makeProvider()),
    ])
    const idA = (a.body as IntelligenceApiError).requestId
    const idB = (b.body as IntelligenceApiError).requestId
    expect(idA).not.toBe(idB)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// No mutation
// ─────────────────────────────────────────────────────────────────────────────

describe('no mutation', () => {
  it('platform handler does not mutate input intel', async () => {
    enableApi()
    const intel = makePlatformIntel()
    const before = JSON.stringify(intel)
    const provider = makeProvider({ getPlatformIntelligence: async () => intel })
    await platformIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM), provider)
    expect(JSON.stringify(intel)).toBe(before)
  })

  it('league handler does not mutate input intel', async () => {
    enableApi()
    const intel = makeLeagueIntel()
    const before = JSON.stringify(intel)
    const provider = makeProvider({ getLeagueIntelligence: async () => intel })
    await leagueIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, { leagueId: 'lgr-1' }), provider)
    expect(JSON.stringify(intel)).toBe(before)
  })

  it('manager handler does not mutate input intel', async () => {
    enableApi()
    const intel = makeManagerIntel()
    const before = JSON.stringify(intel)
    const provider = makeProvider({ getManagerIntelligence: async () => intel })
    await managerIntelligenceHandler(makeCtx(TEST_KEY_MANAGER, { leagueId: 'lgr-1', managerId: 'mgr-1' }), provider)
    expect(JSON.stringify(intel)).toBe(before)
  })
})
