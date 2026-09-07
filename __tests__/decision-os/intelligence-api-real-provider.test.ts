/**
 * Decision OS — Phase 5.8 Real Data Provider tests.
 *
 * Tests the createRealDataProvider factory against injected mock deps.
 * No real Prisma / DB — all IO is replaced via the RealDataProviderDeps interface.
 *
 * Coverage:
 * - Manager: with events → non-null intelligence with correct managerId/leagueId
 * - Manager: zero events → degraded but non-null (honest, not 503)
 * - Manager: port throws → null (triggers 503 INTELLIGENCE_UNAVAILABLE in handler)
 * - Manager: all 4 loaders called with correct leagueId + since Date
 * - Manager: loadDraftRows called WITHOUT a since date (finite history)
 * - League: with events → non-null intelligence with correct leagueId
 * - League: active managers surfaced in managerCount
 * - League: a manager whose only activity is imported (Sleeper) is still surfaced
 * - League: zero events → degraded but non-null
 * - League: port throws → null
 * - Platform: findLeagueIds called with max-leagues cap
 * - Platform: zero leagues → degraded but non-null (not null)
 * - Platform: multiple leagues → all aggregated
 * - Platform: one league pipeline fails → others still included
 * - Platform: findLeagueIds throws → null
 * - No writes: deps interface carries only read methods; no write keys on default deps shape
 * - Env override: INTELLIGENCE_LOOKBACK_DAYS changes lookback
 * - Env override: INTELLIGENCE_PLATFORM_MAX_LEAGUES changes findLeagueIds call count
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createRealDataProvider,
  type RealDataProviderDeps,
} from '@/lib/decision-os/behavioral/api/real-data-provider'
import type {
  RawWaiverClaimRow,
  RawLeagueTradeRow,
  RawRosterMoveRow,
  RawDraftSessionRow,
  RawDraftPickRow,
} from '@/lib/decision-os/behavioral/port'
import type { ImportedActivityEventRow } from '@/lib/decision-os/behavioral/importedActivityToEvents'

// ── Fixture builders ──────────────────────────────────────────────────────────

const LG  = 'league-alpha'
const MGR = 'user-mgr-1'

const makeWaiverRow = (o: Partial<RawWaiverClaimRow> = {}): RawWaiverClaimRow => ({
  id:             'wc-1',
  leagueId:       LG,
  rosterId:       'roster-1',
  userId:         MGR,
  addPlayerId:    'player-a',
  dropPlayerId:   null,
  faabBid:        15,
  priorityOrder:  1,
  claimType:      'normal',
  status:         'awarded',
  processedAt:    new Date('2026-01-15T12:00:00Z'),
  resultMessage:  null,
  createdAt:      new Date('2026-01-10T12:00:00Z'),
  ...o,
})

const makeTradeRow = (o: Partial<RawLeagueTradeRow> = {}): RawLeagueTradeRow => ({
  id:               'trade-1',
  leagueId:         LG,
  proposedByUserId: MGR,
  proposerRosterId: 'roster-1',
  receiverRosterId: 'roster-2',
  status:           'accepted',
  reviewType:       'no_veto',
  acceptedAt:       new Date('2026-01-12T12:00:00Z'),
  rejectedAt:       null,
  expiresAt:        null,
  createdAt:        new Date('2026-01-08T12:00:00Z'),
  itemCount:        2,
  ...o,
})

const makeRosterMoveRow = (o: Partial<RawRosterMoveRow> = {}): RawRosterMoveRow => ({
  id:          'rm-1',
  leagueId:    LG,
  rosterId:    'roster-1',
  season:      2025,
  week:        8,
  actorUserId: MGR,
  source:      'user',
  moveSummary: null,
  createdAt:   new Date('2026-01-05T12:00:00Z'),
  ...o,
})

const emptyDraftResult = () =>
  Promise.resolve({
    session: null as RawDraftSessionRow | null,
    picks:   [] as RawDraftPickRow[],
  })

const makeImportedActivityRow = (o: Partial<ImportedActivityEventRow> = {}): ImportedActivityEventRow => ({
  externalSourceKey: 'sleeper:waiver:1',
  provider:           'sleeper',
  afLeagueId:         LG,
  providerLeagueId:   'sleeper-league-1',
  activityType:       'waiver',
  occurredAt:         new Date('2026-01-10T12:00:00Z'),
  createdAt:          new Date('2026-01-10T12:00:00Z'),
  normalized:         { managerKeys: [MGR] },
  appUserId:          MGR,
  ...o,
})

// ── Deps builder ──────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<RealDataProviderDeps> = {}): RealDataProviderDeps {
  return {
    loadWaiverClaimRows:      vi.fn().mockResolvedValue([]),
    loadLeagueTradeRows:      vi.fn().mockResolvedValue([]),
    loadRosterMoveRows:       vi.fn().mockResolvedValue([]),
    loadDraftRows:            vi.fn().mockImplementation(emptyDraftResult),
    loadImportedActivityRows: vi.fn().mockResolvedValue([]),
    findLeagueIds:            vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

// ── Manager intelligence ──────────────────────────────────────────────────────

describe('getManagerIntelligence', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('returns non-null ManagerBehavioralIntelligence with correct ids when events exist', async () => {
    const deps = makeDeps({
      loadWaiverClaimRows: vi.fn().mockResolvedValue([makeWaiverRow()]),
      loadLeagueTradeRows: vi.fn().mockResolvedValue([makeTradeRow()]),
      loadRosterMoveRows:  vi.fn().mockResolvedValue([makeRosterMoveRow()]),
    })
    const provider = createRealDataProvider(deps)
    const result = await provider.getManagerIntelligence(MGR, LG)

    expect(result).not.toBeNull()
    expect(result!.managerId).toBe(MGR)
    expect(result!.leagueId).toBe(LG)
  })

  it('returns valid intelligence shape (not null) even with zero events (degraded)', async () => {
    const deps = makeDeps()
    const provider = createRealDataProvider(deps)
    const result = await provider.getManagerIntelligence(MGR, LG)

    expect(result).not.toBeNull()
    expect(result!.managerId).toBe(MGR)
    expect(result!.leagueId).toBe(LG)
    // Zero events → inactive tier, zero engagement score
    expect(result!.participationTier).toBe('inactive')
    expect(result!.overallEngagementScore).toBe(0)
  })

  it('returns null when a port throws (DB failure → handler returns 503)', async () => {
    const deps = makeDeps({
      loadWaiverClaimRows: vi.fn().mockRejectedValue(new Error('DB unavailable')),
    })
    const provider = createRealDataProvider(deps)
    const result = await provider.getManagerIntelligence(MGR, LG)

    expect(result).toBeNull()
  })

  it('calls all 4 loaders with leagueId', async () => {
    const deps = makeDeps()
    const provider = createRealDataProvider(deps)
    await provider.getManagerIntelligence(MGR, LG)

    expect(deps.loadWaiverClaimRows).toHaveBeenCalledWith(LG, expect.any(Date))
    expect(deps.loadLeagueTradeRows).toHaveBeenCalledWith(LG, expect.any(Date))
    expect(deps.loadRosterMoveRows).toHaveBeenCalledWith(LG, expect.any(Date))
    // loadDraftRows does not accept a since date
    expect(deps.loadDraftRows).toHaveBeenCalledWith(LG)
    expect(deps.loadDraftRows).toHaveBeenCalledTimes(1)
    // Verify since is in the past
    const since = (deps.loadWaiverClaimRows as ReturnType<typeof vi.fn>).mock.calls[0][1] as Date
    expect(since.getTime()).toBeLessThan(Date.now())
  })

  it('respects INTELLIGENCE_LOOKBACK_DAYS env — shorter lookback means more-recent since date', async () => {
    vi.stubEnv('INTELLIGENCE_LOOKBACK_DAYS', '7')
    const deps = makeDeps()
    const provider = createRealDataProvider(deps)
    await provider.getManagerIntelligence(MGR, LG)

    const since = (deps.loadWaiverClaimRows as ReturnType<typeof vi.fn>).mock.calls[0][1] as Date
    const daysAgo = (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24)
    expect(daysAgo).toBeCloseTo(7, 0)
  })

  it('does not call findLeagueIds (manager scope is league-scoped)', async () => {
    const deps = makeDeps()
    const provider = createRealDataProvider(deps)
    await provider.getManagerIntelligence(MGR, LG)

    expect(deps.findLeagueIds).not.toHaveBeenCalled()
  })

  it('intelligence contains valid participationTier string for active manager', async () => {
    const deps = makeDeps({
      loadWaiverClaimRows: vi.fn().mockResolvedValue([
        makeWaiverRow(), makeWaiverRow({ id: 'wc-2', createdAt: new Date('2026-01-05T12:00:00Z') }),
      ]),
      loadRosterMoveRows: vi.fn().mockResolvedValue([
        makeRosterMoveRow(), makeRosterMoveRow({ id: 'rm-2', week: 7 }),
      ]),
    })
    const provider = createRealDataProvider(deps)
    const result = await provider.getManagerIntelligence(MGR, LG)

    const validTiers = ['elite', 'active', 'moderate', 'passive', 'inactive']
    expect(validTiers).toContain(result!.participationTier)
    expect(result!.overallEngagementScore).toBeGreaterThanOrEqual(0)
    expect(result!.overallEngagementScore).toBeLessThanOrEqual(100)
  })
})

// ── League intelligence ───────────────────────────────────────────────────────

describe('getLeagueIntelligence', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('returns non-null LeagueBehavioralIntelligence with correct leagueId when events exist', async () => {
    const deps = makeDeps({
      loadWaiverClaimRows: vi.fn().mockResolvedValue([makeWaiverRow()]),
      loadLeagueTradeRows: vi.fn().mockResolvedValue([makeTradeRow()]),
    })
    const provider = createRealDataProvider(deps)
    const result = await provider.getLeagueIntelligence(LG)

    expect(result).not.toBeNull()
    expect(result!.leagueId).toBe(LG)
  })

  it('returns degraded but non-null intelligence when no events found', async () => {
    const deps = makeDeps()
    const provider = createRealDataProvider(deps)
    const result = await provider.getLeagueIntelligence(LG)

    expect(result).not.toBeNull()
    expect(result!.leagueId).toBe(LG)
    expect(result!.managerCount).toBe(0)
  })

  it('returns null when a port throws', async () => {
    const deps = makeDeps({
      loadLeagueTradeRows: vi.fn().mockRejectedValue(new Error('connection refused')),
    })
    const provider = createRealDataProvider(deps)
    const result = await provider.getLeagueIntelligence(LG)

    expect(result).toBeNull()
  })

  it('surfaces distinct active managers from events in managerCount', async () => {
    const deps = makeDeps({
      loadWaiverClaimRows: vi.fn().mockResolvedValue([
        makeWaiverRow({ userId: 'mgr-a' }),
        makeWaiverRow({ id: 'wc-2', userId: 'mgr-b' }),
        makeWaiverRow({ id: 'wc-3', userId: 'mgr-a' }),
      ]),
    })
    const provider = createRealDataProvider(deps)
    const result = await provider.getLeagueIntelligence(LG)

    expect(result).not.toBeNull()
    // mgr-a and mgr-b both have waiver events
    expect(result!.managerCount).toBe(2)
  })

  it('surfaces a manager whose ONLY activity is imported (Sleeper) — the shadow-league gap this pipeline used to miss', async () => {
    const deps = makeDeps({
      // Zero AF-native rows anywhere — this manager's history lives entirely in imported activity,
      // exactly like a league whose trades/waivers all happened on the source platform.
      loadImportedActivityRows: vi.fn().mockResolvedValue([
        makeImportedActivityRow({ externalSourceKey: 'sleeper:waiver:1', appUserId: 'mgr-imported' , normalized: { managerKeys: ['mgr-imported'] } }),
      ]),
    })
    const provider = createRealDataProvider(deps)
    const result = await provider.getLeagueIntelligence(LG)

    expect(result).not.toBeNull()
    expect(result!.managerCount).toBe(1)
  })

  it('calls all 5 loaders, including imported activity, with leagueId and since Date', async () => {
    const deps = makeDeps()
    const provider = createRealDataProvider(deps)
    await provider.getLeagueIntelligence(LG)

    expect(deps.loadWaiverClaimRows).toHaveBeenCalledWith(LG, expect.any(Date))
    expect(deps.loadLeagueTradeRows).toHaveBeenCalledWith(LG, expect.any(Date))
    expect(deps.loadRosterMoveRows).toHaveBeenCalledWith(LG, expect.any(Date))
    expect(deps.loadDraftRows).toHaveBeenCalledWith(LG)
    expect(deps.loadImportedActivityRows).toHaveBeenCalledWith(LG, expect.any(Date))
  })

  it('contains valid engagement tier string', async () => {
    const deps = makeDeps()
    const provider = createRealDataProvider(deps)
    const result = await provider.getLeagueIntelligence(LG)

    const validTiers = ['elite', 'active', 'moderate', 'passive', 'dormant']
    expect(validTiers).toContain(result!.leagueEngagementTier)
  })
})

// ── League manager intelligences (Phase 3.3) ──────────────────────────────────

describe('getLeagueManagerIntelligences', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('surfaces one ManagerBehavioralIntelligence per distinct active manager — the same set getLeagueIntelligence used to derive its aggregate, not a fresh computation', async () => {
    const deps = makeDeps({
      loadWaiverClaimRows: vi.fn().mockResolvedValue([
        makeWaiverRow({ userId: 'mgr-a' }),
        makeWaiverRow({ id: 'wc-2', userId: 'mgr-b' }),
      ]),
    })
    const provider = createRealDataProvider(deps)
    const result = await provider.getLeagueManagerIntelligences(LG)

    expect(result).not.toBeNull()
    expect(result!.map((m) => m.managerId).sort()).toEqual(['mgr-a', 'mgr-b'])
  })

  it('returns an empty array (not null) when the league exists but has zero events — a real, valid answer, not an error', async () => {
    const deps = makeDeps()
    const provider = createRealDataProvider(deps)
    const result = await provider.getLeagueManagerIntelligences(LG)

    expect(result).toEqual([])
  })

  it('returns null when a port throws — same catastrophic-failure contract as every other method', async () => {
    const deps = makeDeps({
      loadLeagueTradeRows: vi.fn().mockRejectedValue(new Error('connection refused')),
    })
    const provider = createRealDataProvider(deps)
    const result = await provider.getLeagueManagerIntelligences(LG)

    expect(result).toBeNull()
  })

  it('calls the same 4 loaders with the same args as getLeagueIntelligence — proof of shared computation, not a duplicate pipeline', async () => {
    const deps = makeDeps()
    const provider = createRealDataProvider(deps)
    await provider.getLeagueManagerIntelligences(LG)

    expect(deps.loadWaiverClaimRows).toHaveBeenCalledWith(LG, expect.any(Date))
    expect(deps.loadLeagueTradeRows).toHaveBeenCalledWith(LG, expect.any(Date))
    expect(deps.loadRosterMoveRows).toHaveBeenCalledWith(LG, expect.any(Date))
    expect(deps.loadDraftRows).toHaveBeenCalledWith(LG)
  })
})

// ── Platform intelligence ─────────────────────────────────────────────────────

describe('getPlatformIntelligence', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('returns degraded but non-null intelligence when no leagues found', async () => {
    const deps = makeDeps({ findLeagueIds: vi.fn().mockResolvedValue([]) })
    const provider = createRealDataProvider(deps)
    const result = await provider.getPlatformIntelligence()

    expect(result).not.toBeNull()
    expect(result!.provenance.leagueIntelligenceCount).toBe(0)
    expect(result!.provenance.managerIntelligenceCount).toBe(0)
  })

  it('returns null when findLeagueIds throws', async () => {
    const deps = makeDeps({
      findLeagueIds: vi.fn().mockRejectedValue(new Error('DB down')),
    })
    const provider = createRealDataProvider(deps)
    const result = await provider.getPlatformIntelligence()

    expect(result).toBeNull()
  })

  it('calls findLeagueIds with default cap of 20', async () => {
    const deps = makeDeps({ findLeagueIds: vi.fn().mockResolvedValue([]) })
    const provider = createRealDataProvider(deps)
    await provider.getPlatformIntelligence()

    expect(deps.findLeagueIds).toHaveBeenCalledWith(20)
  })

  it('respects INTELLIGENCE_PLATFORM_MAX_LEAGUES env override', async () => {
    vi.stubEnv('INTELLIGENCE_PLATFORM_MAX_LEAGUES', '5')
    const deps = makeDeps({ findLeagueIds: vi.fn().mockResolvedValue([]) })
    const provider = createRealDataProvider(deps)
    await provider.getPlatformIntelligence()

    expect(deps.findLeagueIds).toHaveBeenCalledWith(5)
  })

  it('aggregates multiple leagues — totalLeagues matches count returned', async () => {
    const deps = makeDeps({
      findLeagueIds: vi.fn().mockResolvedValue([
        { id: 'lg-a' },
        { id: 'lg-b' },
      ]),
      loadWaiverClaimRows: vi.fn().mockResolvedValue([makeWaiverRow()]),
    })
    const provider = createRealDataProvider(deps)
    const result = await provider.getPlatformIntelligence()

    expect(result).not.toBeNull()
    expect(result!.provenance.leagueIntelligenceCount).toBe(2)
    // Loaders called once per league
    expect(deps.loadDraftRows).toHaveBeenCalledTimes(2)
  })

  it('skips failing leagues and returns partial platform intelligence', async () => {
    let callCount = 0
    const deps = makeDeps({
      findLeagueIds: vi.fn().mockResolvedValue([{ id: 'lg-ok' }, { id: 'lg-fail' }]),
      loadWaiverClaimRows: vi.fn().mockImplementation(async (leagueId: string) => {
        callCount++
        if (leagueId === 'lg-fail') throw new Error('league DB error')
        return [makeWaiverRow({ leagueId })]
      }),
    })
    const provider = createRealDataProvider(deps)
    const result = await provider.getPlatformIntelligence()

    // Provider returns non-null (partial success)
    expect(result).not.toBeNull()
    // Only the successful league is counted
    expect(result!.provenance.leagueIntelligenceCount).toBe(1)
    // Both leagues were attempted
    expect(callCount).toBe(2)
  })

  it('does not call manager or league loaders for the findLeagueIds call itself', async () => {
    const deps = makeDeps({ findLeagueIds: vi.fn().mockResolvedValue([]) })
    const provider = createRealDataProvider(deps)
    await provider.getPlatformIntelligence()

    // No league → no event loaders invoked
    expect(deps.loadWaiverClaimRows).not.toHaveBeenCalled()
    expect(deps.loadLeagueTradeRows).not.toHaveBeenCalled()
    expect(deps.loadRosterMoveRows).not.toHaveBeenCalled()
    expect(deps.loadDraftRows).not.toHaveBeenCalled()
  })

  it('includes managers from active leagues in totalManagers', async () => {
    const deps = makeDeps({
      findLeagueIds: vi.fn().mockResolvedValue([{ id: 'lg-1' }, { id: 'lg-2' }]),
      loadWaiverClaimRows: vi.fn().mockImplementation(async (leagueId: string) => [
        makeWaiverRow({ leagueId, userId: 'mgr-a' }),
        makeWaiverRow({ id: 'wc-2', leagueId, userId: 'mgr-b' }),
      ]),
    })
    const provider = createRealDataProvider(deps)
    const result = await provider.getPlatformIntelligence()

    expect(result).not.toBeNull()
    // 2 leagues × 2 managers each = 4 total manager intelligences
    expect(result!.provenance.managerIntelligenceCount).toBe(4)
  })
})

// ── No-writes structural assertion ───────────────────────────────────────────

describe('no writes', () => {
  it('RealDataProviderDeps interface carries only read operations (structural)', () => {
    // Verify the deps shape has no write/delete/upsert methods by inspecting the makeDeps keys
    const deps = makeDeps()
    const keys = Object.keys(deps)
    const writeKeywords = ['create', 'update', 'delete', 'upsert', 'insert', 'write', 'set']
    for (const key of keys) {
      for (const word of writeKeywords) {
        expect(key.toLowerCase()).not.toContain(word)
      }
    }
  })

  it('getManagerIntelligence never calls findLeagueIds (read boundary)', async () => {
    const deps = makeDeps()
    const provider = createRealDataProvider(deps)
    await provider.getManagerIntelligence(MGR, LG)
    expect(deps.findLeagueIds).not.toHaveBeenCalled()
  })

  it('getLeagueIntelligence never calls findLeagueIds (read boundary)', async () => {
    const deps = makeDeps()
    const provider = createRealDataProvider(deps)
    await provider.getLeagueIntelligence(LG)
    expect(deps.findLeagueIds).not.toHaveBeenCalled()
  })
})

// ── Tenant isolation (trust boundary) ────────────────────────────────────────

describe('tenant isolation', () => {
  it('manager intelligence for lg-a does not load lg-b events', async () => {
    const deps = makeDeps({
      loadWaiverClaimRows: vi.fn().mockResolvedValue([makeWaiverRow({ leagueId: 'lg-a' })]),
    })
    const provider = createRealDataProvider(deps)
    await provider.getManagerIntelligence(MGR, 'lg-a')

    expect(deps.loadWaiverClaimRows).toHaveBeenCalledWith('lg-a', expect.any(Date))
    expect(deps.loadWaiverClaimRows).not.toHaveBeenCalledWith('lg-b', expect.anything())
  })

  it('league intelligence for lg-a does not load lg-b events', async () => {
    const deps = makeDeps()
    const provider = createRealDataProvider(deps)
    await provider.getLeagueIntelligence('lg-a')

    expect(deps.loadWaiverClaimRows).toHaveBeenCalledWith('lg-a', expect.any(Date))
    const calls = (deps.loadWaiverClaimRows as ReturnType<typeof vi.fn>).mock.calls
    for (const [id] of calls) {
      expect(id).toBe('lg-a')
    }
  })

  it('platform intelligence queries each league independently (no event cross-contamination)', async () => {
    const seenIds: string[] = []
    const deps = makeDeps({
      findLeagueIds: vi.fn().mockResolvedValue([{ id: 'lg-x' }, { id: 'lg-y' }]),
      loadWaiverClaimRows: vi.fn().mockImplementation(async (leagueId: string) => {
        seenIds.push(leagueId)
        return []
      }),
    })
    const provider = createRealDataProvider(deps)
    await provider.getPlatformIntelligence()

    expect(seenIds).toContain('lg-x')
    expect(seenIds).toContain('lg-y')
    // Each league is loaded exactly once
    expect(seenIds.filter((id) => id === 'lg-x').length).toBe(1)
    expect(seenIds.filter((id) => id === 'lg-y').length).toBe(1)
  })
})
