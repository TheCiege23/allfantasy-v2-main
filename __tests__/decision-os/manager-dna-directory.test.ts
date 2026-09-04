/**
 * The commissioner Manager DNA directory — the league-wide view the per-manager route deliberately
 * withholds.
 *
 * Three things are asserted here that nothing else in the suite can assert:
 *
 * 1. THE PRIVACY GATE IS REAL. A manager-tier key is refused and a commissioner-tier key is not.
 *    This endpoint is the one place DNA for people other than the caller crosses a boundary, so the
 *    refusal is the feature, not an edge case.
 * 2. THE DIRECTORY IS NOT NARROWED. `resolveManagerIntelligencePayload` computes every manager and
 *    returns one; this must return every one. A test that only checked "some rows came back" would
 *    pass against the old narrowing.
 * 3. AN ABSENT TREND STAYS ABSENT. A manager with fewer than two snapshots has no direction, and
 *    'steady' is a measurement — back-filling it from `engagementReliability` is the exact
 *    misrepresentation the `managers` namespace refused to make for months.
 *
 * Tests run through the real handler, not just the helpers: a helper suite goes green on a feature
 * wired to nothing.
 */
import { vi, describe, it, expect, afterEach, beforeEach } from 'vitest'
import type { IntelligenceApiContext } from '../../lib/decision-os/behavioral/api/intelligence-handlers'
import type { IntelligenceApiError } from '../../lib/decision-os/behavioral/api/contracts'
import type { BehavioralSnapshotRecord } from '../../lib/decision-os/snapshot/behavioralSnapshotCapture'
import type { ManagerDnaProfile } from '../../lib/decision-os/phase6/dna/types'

vi.mock('../../lib/decision-os/dashboard-intelligence', () => ({
  computeLeagueDna: vi.fn(),
}))
vi.mock('../../lib/decision-os/snapshot/prismaBehavioralSnapshotStore', () => ({
  defaultListManagerBehavioralTrends: vi.fn(),
}))

import { computeLeagueDna } from '../../lib/decision-os/dashboard-intelligence'
import { defaultListManagerBehavioralTrends } from '../../lib/decision-os/snapshot/prismaBehavioralSnapshotStore'
import {
  resolveManagerDnaDirectory,
  deriveManagerEngagementTrend,
} from '../../lib/decision-os/managerDnaDirectory'
import { leagueManagerDnaIntelligenceHandler } from '../../lib/decision-os/behavioral/api/intelligence-handlers'

const TEST_KEY_COMMISSIONER = 'afk_test_abcdefghijklmnop2'
const TEST_KEY_MANAGER = 'afk_test_abcdefghijklmnop3'
const TEST_KEY_PLATFORM = 'afk_test_abcdefghijklmnop4'

const TEST_KEYS_MAP = JSON.stringify({
  [TEST_KEY_COMMISSIONER]: 'commissioner',
  [TEST_KEY_MANAGER]: 'manager',
  [TEST_KEY_PLATFORM]: 'platform',
})

function enableApi() {
  vi.stubEnv('DECISION_OS_INTELLIGENCE_API_ENABLED', 'true')
  vi.stubEnv('INTELLIGENCE_API_TEST_KEYS', TEST_KEYS_MAP)
}

function makeCtx(apiKey?: string, searchParams: Record<string, string> = {}): IntelligenceApiContext {
  const headers = new Map<string, string>()
  if (apiKey) headers.set('x-allfantasy-api-key', apiKey)
  return {
    headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
    searchParams: new URLSearchParams(searchParams),
  }
}

function errCode(body: unknown): string {
  return (body as IntelligenceApiError).code
}

function makeProfile(overrides: Partial<ManagerDnaProfile> = {}): ManagerDnaProfile {
  return {
    managerId: 'mgr-1',
    leagueId: 'lg-1',
    primaryIdentity: 'committed_grinder',
    confidence: 0.8,
    decisionStyle: 'methodical',
    transactionStyle: 'balanced',
    riskTendency: 'neutral',
    engagementReliability: 'reliable',
    traits: [],
    derivation: ['classifier: committed_grinder scored 0.8'],
    warnings: [],
    completeness: 90,
    ...overrides,
  }
}

function makeSnapshot(periodKey: string, eventCount: number): BehavioralSnapshotRecord {
  return {
    scope: 'manager',
    leagueId: 'lg-1',
    managerId: 'mgr-1',
    cadence: 'weekly',
    periodKey,
    capturedAt: `2026-01-0${periodKey.slice(-1)}T00:00:00.000Z`,
    lookbackDays: 7,
    eventCount,
    completeness: 100,
    facts: {} as never,
  }
}

function mockPipeline(profiles: ManagerDnaProfile[]) {
  vi.mocked(computeLeagueDna).mockResolvedValue({
    dnaResult: {
      leagueId: 'lg-1',
      profiles,
      totalManagersAnalyzed: profiles.length,
      profiledManagers: profiles.filter((p) => p.primaryIdentity !== 'unknown').length,
      insufficientDataManagers: profiles.filter((p) => p.primaryIdentity === 'unknown').length,
      warnings: [],
      version: '6.2.0',
    },
    patternsResult: { managerPatterns: [] } as never,
  })
}

beforeEach(() => {
  vi.mocked(defaultListManagerBehavioralTrends).mockResolvedValue(new Map())
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})

describe('deriveManagerEngagementTrend — an absent trend is never a flat one', () => {
  it('reports no_snapshots for a manager with no history at all', () => {
    expect(deriveManagerEngagementTrend([])).toEqual({ available: false, reason: 'no_snapshots' })
  })

  it('reports insufficient_history for exactly one period — nothing to compare against', () => {
    const trend = deriveManagerEngagementTrend([makeSnapshot('2026-W01', 10)])
    expect(trend).toEqual({ available: false, reason: 'insufficient_history' })
  })

  it('derives rising / declining / steady from the event-count delta', () => {
    const rising = deriveManagerEngagementTrend([makeSnapshot('2026-W01', 5), makeSnapshot('2026-W02', 9)])
    const declining = deriveManagerEngagementTrend([makeSnapshot('2026-W01', 9), makeSnapshot('2026-W02', 5)])
    const steady = deriveManagerEngagementTrend([makeSnapshot('2026-W01', 7), makeSnapshot('2026-W02', 7)])

    expect(rising).toMatchObject({ available: true, direction: 'rising', eventCountDelta: 4 })
    expect(declining).toMatchObject({ available: true, direction: 'declining', eventCountDelta: -4 })
    expect(steady).toMatchObject({ available: true, direction: 'steady', eventCountDelta: 0 })
  })

  it("NEVER returns 'steady' for a manager who simply has no snapshots", () => {
    // The regression this whole field exists to prevent: a reliably-absent manager must read as
    // unknown, not as measured-flat. A LEVEL and a DIRECTION are orthogonal.
    for (const records of [[], [makeSnapshot('2026-W01', 3)]]) {
      const trend = deriveManagerEngagementTrend(records)
      expect(trend.available).toBe(false)
      expect(JSON.stringify(trend)).not.toContain('steady')
    }
  })
})

describe('resolveManagerDnaDirectory', () => {
  it('returns EVERY manager, not just one — the narrowing the per-manager route applies is absent here', async () => {
    mockPipeline([
      makeProfile({ managerId: 'mgr-1' }),
      makeProfile({ managerId: 'mgr-2', primaryIdentity: 'serial_trader' }),
      makeProfile({ managerId: 'mgr-3', primaryIdentity: 'unknown', confidence: 0 }),
    ])

    const directory = await resolveManagerDnaDirectory({ leagueId: 'lg-1' })

    expect(directory.available).toBe(true)
    if (!directory.available) return
    expect(directory.rows.map((r) => r.managerId)).toEqual(['mgr-1', 'mgr-2', 'mgr-3'])
    expect(directory.totalManagersAnalyzed).toBe(3)
    expect(directory.insufficientDataManagers).toBe(1)
    expect(directory.version).toBe('6.2.0')
  })

  it('withholds the derivation trace even from an authorized commissioner', async () => {
    mockPipeline([makeProfile()])
    const directory = await resolveManagerDnaDirectory({ leagueId: 'lg-1' })

    expect(directory.available).toBe(true)
    if (!directory.available) return
    expect(directory.rows[0]).not.toHaveProperty('derivation')
    // But the honest caveats ARE carried — a directory that hides them shows every profile as
    // equally solid when it is not.
    expect(directory.rows[0]).toHaveProperty('warnings')
  })

  it('attaches each manager their OWN trend, and leaves a manager without snapshots unknown', async () => {
    mockPipeline([makeProfile({ managerId: 'mgr-1' }), makeProfile({ managerId: 'mgr-2' })])
    vi.mocked(defaultListManagerBehavioralTrends).mockResolvedValue(
      new Map([['mgr-1', [makeSnapshot('2026-W01', 2), makeSnapshot('2026-W02', 8)]]]),
    )

    const directory = await resolveManagerDnaDirectory({ leagueId: 'lg-1' })
    expect(directory.available).toBe(true)
    if (!directory.available) return

    expect(directory.rows[0].engagementTrend).toMatchObject({ available: true, direction: 'rising' })
    expect(directory.rows[1].engagementTrend).toEqual({ available: false, reason: 'no_snapshots' })
  })

  it('degrades to unavailable — never an empty league — when the pipeline throws', async () => {
    vi.mocked(computeLeagueDna).mockRejectedValue(new Error('events table unreachable'))

    const directory = await resolveManagerDnaDirectory({ leagueId: 'lg-1' })

    expect(directory).toEqual({ available: false, leagueId: 'lg-1', reason: 'pipeline_failed' })
  })

  it('keeps every classification when only the TREND read fails', async () => {
    mockPipeline([makeProfile()])
    vi.mocked(defaultListManagerBehavioralTrends).mockRejectedValue(new Error('snapshot table gone'))

    const directory = await resolveManagerDnaDirectory({ leagueId: 'lg-1' })

    expect(directory.available).toBe(true)
    if (!directory.available) return
    expect(directory.rows[0].primaryIdentity).toBe('committed_grinder')
    expect(directory.rows[0].engagementTrend).toEqual({ available: false, reason: 'no_snapshots' })
  })
})

describe('leagueManagerDnaIntelligenceHandler — the authorization boundary', () => {
  it('REFUSES a manager-tier key: a directory of other managers is not manager-tier data', async () => {
    enableApi()
    mockPipeline([makeProfile()])

    const r = await leagueManagerDnaIntelligenceHandler(makeCtx(TEST_KEY_MANAGER, { leagueId: 'lg-1' }))

    expect(r.status).toBe(403)
    expect(errCode(r.body)).toBe('FORBIDDEN')
    // The refusal must happen before any data is computed, not after.
    expect(vi.mocked(computeLeagueDna)).not.toHaveBeenCalled()
  })

  it('allows a commissioner-tier key and returns the whole directory', async () => {
    enableApi()
    mockPipeline([makeProfile({ managerId: 'mgr-1' }), makeProfile({ managerId: 'mgr-2' })])

    const r = await leagueManagerDnaIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, { leagueId: 'lg-1' }))

    expect(r.status).toBe(200)
    const body = r.body as { data: { available: boolean; rows: unknown[] }; meta: { tier: string; completeness: number } }
    expect(body.data.available).toBe(true)
    expect(body.data.rows).toHaveLength(2)
    expect(body.meta.tier).toBe('commissioner')
    expect(body.meta.completeness).toBe(90)
  })

  it('allows a platform-tier key too — it holds the same league scope', async () => {
    enableApi()
    mockPipeline([makeProfile()])

    const r = await leagueManagerDnaIntelligenceHandler(makeCtx(TEST_KEY_PLATFORM, { leagueId: 'lg-1' }))

    expect(r.status).toBe(200)
  })

  it('rejects a missing leagueId with 400, not a silent league-wide read', async () => {
    enableApi()
    const r = await leagueManagerDnaIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER))

    expect(r.status).toBe(400)
    expect(errCode(r.body)).toBe('INVALID_REQUEST')
    expect(vi.mocked(computeLeagueDna)).not.toHaveBeenCalled()
  })

  it('refuses an unkeyed request before touching the pipeline', async () => {
    enableApi()
    const r = await leagueManagerDnaIntelligenceHandler(makeCtx(undefined, { leagueId: 'lg-1' }))

    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(vi.mocked(computeLeagueDna)).not.toHaveBeenCalled()
  })

  it('reports 503 rather than an empty directory when the pipeline fails', async () => {
    enableApi()
    vi.mocked(computeLeagueDna).mockRejectedValue(new Error('down'))

    const r = await leagueManagerDnaIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, { leagueId: 'lg-1' }))

    expect(r.status).toBe(503)
    expect(errCode(r.body)).toBe('INTELLIGENCE_UNAVAILABLE')
  })

  it('reports 0 completeness for an empty league, never 100', async () => {
    enableApi()
    mockPipeline([])

    const r = await leagueManagerDnaIntelligenceHandler(makeCtx(TEST_KEY_COMMISSIONER, { leagueId: 'lg-1' }))
    const body = r.body as { meta: { completeness: number } }

    expect(r.status).toBe(200)
    expect(body.meta.completeness).toBe(0)
  })
})
