import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const { findUniqueLeague, findUniqueSyncState, findManyRoster, countIdentity } = vi.hoisted(() => ({
  findUniqueLeague: vi.fn(),
  findUniqueSyncState: vi.fn(),
  findManyRoster: vi.fn(),
  countIdentity: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: findUniqueLeague },
    leagueSyncState: { findUnique: findUniqueSyncState },
    roster: { findMany: findManyRoster },
    playerIdentityMap: { count: countIdentity },
  },
}))

import { loadImportAssertions } from '@/lib/decision-os/import/assertions'

/**
 * ── R4, Identity OS — `playerIdentityCoverage` on `ImportAssertions` ───────────────────────────
 *
 * Every other read in Decision OS silently depends on `PlayerIdentityMap` resolution and none
 * reported on it — the audit's measured case was a roster where all 27 players came back as
 * `{ playerId: '6804', name: '6804' }` and still graded itself `conclusive: ok`. These tests pin
 * the measurement this gap needed: what fraction of a league's ROSTERED players (not registry
 * rows in general) resolve, using the SAME parser (`getNormalizedLineupSections`) production code
 * reads rosters through, not a second one.
 */
describe('R4 — loadImportAssertions: playerIdentityCoverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUniqueSyncState.mockResolvedValue(null)
  })

  function league(platform: string) {
    return { id: 'L1', platform, platformLeagueId: 'ext1', season: 2026, leagueSize: 12 }
  }

  it('a sleeper league checks ids against sleeperId, not another column', async () => {
    findUniqueLeague.mockResolvedValue(league('sleeper'))
    findManyRoster.mockResolvedValue([
      { platformUserId: 'u1', playerData: { lineup_sections: { starters: ['p1', 'p2'], bench: ['p3'] } } },
    ])
    countIdentity.mockResolvedValue(2)

    const a = await loadImportAssertions('L1')
    expect(countIdentity).toHaveBeenCalledTimes(1)
    expect(countIdentity.mock.calls[0][0].where).toEqual({ sleeperId: { in: expect.arrayContaining(['p1', 'p2', 'p3']) } })
    expect(a?.playersTotal).toBe(3)
    expect(a?.playersResolved).toBe(2)
    expect(a?.playerIdentityCoverage).toBeCloseTo(2 / 3)
  })

  it('🛑 catches the measured trap: a roster where nothing resolves reports coverage near zero, not ok', async () => {
    findUniqueLeague.mockResolvedValue(league('sleeper'))
    findManyRoster.mockResolvedValue([
      {
        platformUserId: 'u1',
        playerData: {
          lineup_sections: {
            starters: Array.from({ length: 27 }, (_, i) => `${6800 + i}`),
          },
        },
      },
    ])
    countIdentity.mockResolvedValue(0)

    const a = await loadImportAssertions('L1')
    expect(a?.playersTotal).toBe(27)
    expect(a?.playersResolved).toBe(0)
    expect(a?.playerIdentityCoverage).toBe(0)
  })

  it('an unmapped provider (native/manual — no external id space) reports null, not zero', async () => {
    findUniqueLeague.mockResolvedValue(league('native'))
    findManyRoster.mockResolvedValue([
      { platformUserId: null, playerData: { lineup_sections: { starters: ['p1'] } } },
    ])

    const a = await loadImportAssertions('L1')
    expect(countIdentity).not.toHaveBeenCalled()
    expect(a?.playerIdentityCoverage).toBeNull()
    // Total is still reported (we DID see rostered players) — only the coverage ratio is withheld.
    expect(a?.playersTotal).toBe(1)
  })

  it('no rostered players at all reports null coverage, not a 0/0 division', async () => {
    findUniqueLeague.mockResolvedValue(league('sleeper'))
    findManyRoster.mockResolvedValue([{ platformUserId: 'u1', playerData: null }])

    const a = await loadImportAssertions('L1')
    expect(countIdentity).not.toHaveBeenCalled()
    expect(a?.playersTotal).toBe(0)
    expect(a?.playerIdentityCoverage).toBeNull()
  })

  it('dedupes the same player id across multiple rosters before counting', async () => {
    findUniqueLeague.mockResolvedValue(league('sleeper'))
    findManyRoster.mockResolvedValue([
      { platformUserId: 'u1', playerData: { lineup_sections: { starters: ['p1', 'p2'] } } },
      { platformUserId: 'u2', playerData: { lineup_sections: { starters: ['p1', 'p3'] } } },
    ])
    countIdentity.mockResolvedValue(3)

    const a = await loadImportAssertions('L1')
    // p1 shared by both rosters counts once: {p1, p2, p3} = 3, not 4.
    expect(a?.playersTotal).toBe(3)
  })

  it('a fantrax league checks fantraxId, not sleeperId', async () => {
    findUniqueLeague.mockResolvedValue(league('fantrax'))
    findManyRoster.mockResolvedValue([
      { platformUserId: 'u1', playerData: { lineup_sections: { starters: ['06k5m'] } } },
    ])
    countIdentity.mockResolvedValue(1)

    await loadImportAssertions('L1')
    expect(countIdentity.mock.calls[0][0].where).toEqual({ fantraxId: { in: ['06k5m'] } })
  })
})
