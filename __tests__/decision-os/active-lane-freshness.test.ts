import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  findUniqueLeague: vi.fn(),
  findUniqueSyncState: vi.fn(),
  findManyRoster: vi.fn(),
  countIdentity: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.findUniqueLeague },
    leagueSyncState: { findUnique: h.findUniqueSyncState },
    roster: { findMany: h.findManyRoster },
    playerIdentityMap: { count: h.countIdentity },
  },
}))

import { certifiedFreshnessFor, isConclusive, isConclusiveFor, type FactDependency } from '@/lib/decision-os/conclusive'
import { ACTIVE_LANE_SCOPES, loadImportAssertions, type ImportAssertions } from '@/lib/decision-os/import/assertions'
import { ACTIVE_SYNC_SCOPES } from '@/lib/import-os/collector/activeSyncLane'

/*
 * 2026-09-28, KBFL and BB Dynasty: an answer headed "synced 10:45 PM" (the five-minute lane's
 * stamp on League.lastSyncedAt, 25 minutes earlier) went on to say "the last successful sync was
 * ~4 hours ago" and refuse a lineup call — Decision OS read only the full lane's row. These pin the
 * second clock, and pin that it vouches ONLY for the scopes it actually collects.
 */
const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.parse('2026-09-28T03:12:00.000Z')

function assertions(over: Partial<ImportAssertions> = {}): ImportAssertions {
  return {
    leagueId: 'kbfl', provider: 'sleeper', externalLeagueId: 'x1', season: 2026,
    lastAttemptedSyncAt: new Date(NOW - 4 * HOUR).toISOString(),
    lastSuccessfulSyncAt: new Date(NOW - 4 * HOUR).toISOString(),
    staleMs: 4 * HOUR,
    syncStatus: 'completed', consecutiveFailures: 0,
    scopes: [
      { scope: 'league_state', completedLastRun: true, incomplete: false, hasCheckpoint: true },
      { scope: 'teams_rosters', completedLastRun: true, incomplete: false, hasCheckpoint: true },
      { scope: 'traded_picks', completedLastRun: true, incomplete: false, hasCheckpoint: true },
    ],
    parity: 'matched', parityNote: null,
    rosterCoverage: 1, rostersHeld: 32, rostersExpected: 32,
    managerIdentityCoverage: 1, managersMapped: 32, managersTotal: 32,
    playerIdentityCoverage: 1, playersResolved: 500, playersTotal: 500,
    activeLane: null,
    ...over,
  }
}

const lane = (ageMs: number) => ({
  lastSuccessfulSyncAt: new Date(NOW - ageMs).toISOString(),
  staleMs: ageMs,
  scopes: ACTIVE_LANE_SCOPES,
})

/** A fact that also needs traded picks — which the active lane never collects. */
const needsPicks: FactDependency = {
  scopes: ['teams_rosters', 'traded_picks'],
  needsManagerIdentity: false, needsParity: false, maxStaleMs: 2 * HOUR, minCoverage: null, minIdentityResolution: null,
}

describe('certifiedFreshnessFor', () => {
  it('uses the active lane for a rosters-only fact when it is newer', () => {
    const f = certifiedFreshnessFor(['teams_rosters'], assertions({ activeLane: lane(25 * MIN) }))
    expect(f).toMatchObject({ lane: 'active', staleMs: 25 * MIN })
  })

  it('🛑 never lets the active lane vouch for a scope it does not collect', () => {
    const f = certifiedFreshnessFor(['teams_rosters', 'traded_picks'], assertions({ activeLane: lane(25 * MIN) }))
    expect(f).toMatchObject({ lane: 'full', staleMs: 4 * HOUR })
  })

  it('keeps the full lane when it is the newer of the two', () => {
    const f = certifiedFreshnessFor(['teams_rosters'], assertions({ staleMs: 10 * MIN, activeLane: lane(40 * MIN) }))
    expect(f.lane).toBe('full')
  })

  it('ignores a lane that has never completed', () => {
    const f = certifiedFreshnessFor(['teams_rosters'], assertions({ activeLane: { lastSuccessfulSyncAt: null, staleMs: null, scopes: ACTIVE_LANE_SCOPES } }))
    expect(f.lane).toBe('full')
  })
})

describe('isConclusive with the five-minute lane', () => {
  it('🛑 the KBFL case: rosters read 25 minutes ago, full sync 4 hours ago — a lineup call is answerable', () => {
    expect(isConclusiveFor('lineupDecision', assertions({ activeLane: lane(25 * MIN) }), NOW)).toEqual({ ok: true })
  })

  it('the same lineup call with no active lane is still refused, and names what the age is of', () => {
    const v = isConclusiveFor('lineupDecision', assertions(), NOW)
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.blockedBy[0]!.detail).toBe(
      "The last complete sync of this league's rosters was 4 hours ago, and this answer needs data no older than 2 hours.",
    )
  })

  it('a fact that also needs traded picks stays on the full clock, and says so', () => {
    const v = isConclusive(needsPicks, assertions({ activeLane: lane(25 * MIN) }), NOW)
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.blockedBy[0]!.detail).toContain("this league's rosters and traded picks was 4 hours ago")
  })

  it('a stale active lane does not rescue a stale full lane', () => {
    const v = isConclusiveFor('lineupDecision', assertions({ activeLane: lane(3 * HOUR) }), NOW)
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.blockedBy[0]!.detail).toContain('was 3 hours ago')
  })

  it('a full lane that never completed is not a blocker for rosters the active lane certified', () => {
    const neverFull = assertions({ lastSuccessfulSyncAt: null, staleMs: null, activeLane: lane(10 * MIN) })
    expect(isConclusiveFor('lineupDecision', neverFull, NOW)).toEqual({ ok: true })
    const picks = isConclusive(needsPicks, neverFull, NOW)
    expect(picks.ok).toBe(false)
    if (picks.ok) return
    expect(picks.blockedBy[0]!.detail).toMatch(/never completed a full sync/)
  })

  it('an incomplete rosters scope from the full run is cleared only by a LATER active-lane success', () => {
    const scopes = [
      { scope: 'league_state', completedLastRun: true, incomplete: false, hasCheckpoint: true },
      { scope: 'teams_rosters', completedLastRun: false, incomplete: true, hasCheckpoint: true },
    ]
    const later = assertions({ scopes, activeLane: lane(25 * MIN) }) // full attempt 4h ago, lane 25m ago
    expect(isConclusiveFor('lineupDecision', later, NOW)).toEqual({ ok: true })

    const earlier = assertions({
      scopes,
      lastAttemptedSyncAt: new Date(NOW - 5 * MIN).toISOString(), // the failing full run came AFTER the lane
      activeLane: lane(25 * MIN),
    })
    const v = isConclusiveFor('lineupDecision', earlier, NOW)
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.blockedBy.some((b) => b.scope === 'teams_rosters')).toBe(true)
  })
})

describe('loadImportAssertions reads the active lane row', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    h.findUniqueLeague.mockResolvedValue({ id: 'kbfl', platform: 'sleeper', platformLeagueId: 'ext1', season: 2026, leagueSize: 32 })
    h.findManyRoster.mockResolvedValue([])
    h.countIdentity.mockResolvedValue(0)
  })

  it('carries <runKey>:active as activeLane, separately from the full row', async () => {
    const fullAt = new Date(Date.now() - 4 * HOUR)
    const laneAt = new Date(Date.now() - 25 * MIN)
    h.findUniqueSyncState.mockImplementation(async ({ where }: { where: { runKey: string } }) =>
      where.runKey === 'sleeper:ext1:2026'
        ? { lastSuccessfulSyncAt: fullAt, lastAttemptedSyncAt: fullAt, syncStatus: 'completed', consecutiveFailures: 0, completedScopes: [], incompleteScopes: [], checkpoints: {} }
        : where.runKey === 'sleeper:ext1:2026:active'
        ? { lastSuccessfulSyncAt: laneAt }
        : null,
    )
    const a = await loadImportAssertions('kbfl')
    expect(a?.lastSuccessfulSyncAt).toBe(fullAt.toISOString())
    expect(a?.activeLane?.lastSuccessfulSyncAt).toBe(laneAt.toISOString())
    expect(a?.activeLane?.staleMs).toBeGreaterThanOrEqual(25 * MIN)
    expect(a?.activeLane?.staleMs).toBeLessThan(26 * MIN)
    expect(a?.activeLane?.scopes).toEqual(ACTIVE_LANE_SCOPES)
  })

  it('no lane row → activeLane null, not a fabricated stamp', async () => {
    h.findUniqueSyncState.mockResolvedValue(null)
    const a = await loadImportAssertions('kbfl')
    expect(a?.activeLane).toBeNull()
  })
})

describe('the mirrored scope list', () => {
  it('matches the collector ACTIVE_SYNC_SCOPES exactly', () => {
    expect([...ACTIVE_LANE_SCOPES].sort()).toEqual([...ACTIVE_SYNC_SCOPES].sort())
  })
})
