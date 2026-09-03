import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const { findUniqueLeague, findFirstTeam, getRosterGrade } = vi.hoisted(() => ({
  findUniqueLeague: vi.fn(),
  findFirstTeam: vi.fn(),
  getRosterGrade: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: findUniqueLeague },
    leagueTeam: { findFirst: findFirstTeam },
  },
}))
vi.mock('@/lib/core-app/rosterGrade', () => ({ getRosterGrade }))
vi.mock('@/lib/core-app/playerProjections', () => ({
  latestProjectionWeek: vi.fn().mockResolvedValue({ season: '2026', week: 3 }),
}))

import { loadRosterValueGradeSlice } from '@/lib/decision-os/grounding/rosterValueGradeSlice'

/**
 * ── R3.3 (2.2) — "Where am I weak?" bridged from `getRosterGrade`, not re-derived ──────────────
 *
 * `RosterGrade.strongest`/`.weakest` are nested `PositionStrength` objects, and `renderObject()`
 * in serialize.ts is deliberately non-recursive — nested objects are what makes an unbounded
 * prompt dump possible again, the exact class of bug the R3 serializer fix already closed once
 * for eight other slices. So this producer flattens `weakest`/`strongest` into prefixed primitive
 * fields BEFORE they ever reach the packet. These tests exist to catch a regression of exactly
 * that flattening — the failure mode is silent (the slice still reports `present: true`, just
 * with the actual weak/strong position data quietly gone).
 */
describe('R3.3 (2.2) — roster value grade slice', () => {
  beforeEach(() => vi.clearAllMocks())

  const league = {
    starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
    settings: {},
    leagueType: null,
    isDynasty: true,
  }

  it('missing userId or leagueId refuses with not_requested and runs no query', async () => {
    const s1 = await loadRosterValueGradeSlice({ userId: null, leagueId: 'L1' })
    const s2 = await loadRosterValueGradeSlice({ userId: 'u1', leagueId: null })
    expect(s1.gap?.reason).toBe('not_requested')
    expect(s2.gap?.reason).toBe('not_requested')
    expect(findUniqueLeague).not.toHaveBeenCalled()
  })

  it('an unknown league refuses with not_synced', async () => {
    findUniqueLeague.mockResolvedValue(null)
    const s = await loadRosterValueGradeSlice({ userId: 'u1', leagueId: 'L1' })
    expect(s.present).toBe(false)
    expect(s.gap?.reason).toBe('not_synced')
    expect(getRosterGrade).not.toHaveBeenCalled()
  })

  it('a missing LeagueTeam claim row still tries the grade — userId alone is a valid candidate', async () => {
    findUniqueLeague.mockResolvedValue(league)
    findFirstTeam.mockResolvedValue(null)
    getRosterGrade.mockResolvedValue(null)
    await loadRosterValueGradeSlice({ userId: 'u1', leagueId: 'L1' })
    expect(getRosterGrade).toHaveBeenCalledTimes(1)
    expect(getRosterGrade.mock.calls[0][0].myPlatformUserIds).toEqual(['u1'])
  })

  it('getRosterGrade returning null refuses with not_computed, not a crash', async () => {
    findUniqueLeague.mockResolvedValue(league)
    findFirstTeam.mockResolvedValue({ platformUserId: 'p1', externalId: 'e1' })
    getRosterGrade.mockResolvedValue(null)
    const s = await loadRosterValueGradeSlice({ userId: 'u1', leagueId: 'L1' })
    expect(s.present).toBe(false)
    expect(s.gap?.reason).toBe('not_computed')
  })

  it('🛑 weakest/strongest are FLATTENED into prefixed primitive fields, not passed through as nested objects', async () => {
    findUniqueLeague.mockResolvedValue(league)
    findFirstTeam.mockResolvedValue({ platformUserId: 'p1', externalId: 'e1' })
    getRosterGrade.mockResolvedValue({
      rank: 3,
      outOf: 12,
      value: 45000,
      median: 38000,
      pricedPlayers: 14,
      totalPlayers: 16,
      basis: { format: 'dynasty', qbFormat: '1qb', capturedAt: '2026-09-01T00:00:00.000Z', leagueScored: true },
      strongest: { position: 'WR', value: 18000, rank: 1, outOf: 12, playerCount: 4 },
      weakest: { position: 'RB', value: 4200, rank: 11, outOf: 12, playerCount: 2 },
    })
    const s = await loadRosterValueGradeSlice({ userId: 'u1', leagueId: 'L1' })
    expect(s.present).toBe(true)
    // The value must be a flat object — no nested 'strongest'/'weakest' keys survive.
    expect(s.value).not.toHaveProperty('strongest')
    expect(s.value).not.toHaveProperty('weakest')
    expect(s.value).toMatchObject({
      rank: 3,
      outOf: 12,
      weakestPosition: 'RB',
      weakestValue: 4200,
      weakestRank: 11,
      weakestOutOf: 12,
      strongestPosition: 'WR',
      strongestValue: 18000,
      strongestRank: 1,
      strongestOutOf: 12,
      leagueScored: true,
    })
    expect(s.asOf).toBe('2026-09-01T00:00:00.000Z')
  })

  it('a null weakest/strongest (unrankable position) flattens to null fields, not a throw', async () => {
    findUniqueLeague.mockResolvedValue(league)
    findFirstTeam.mockResolvedValue({ platformUserId: 'p1', externalId: 'e1' })
    getRosterGrade.mockResolvedValue({
      rank: 1,
      outOf: 12,
      value: 50000,
      median: 40000,
      pricedPlayers: 16,
      totalPlayers: 16,
      basis: { format: 'redraft', qbFormat: '1qb', capturedAt: null, leagueScored: false },
      strongest: null,
      weakest: null,
    })
    const s = await loadRosterValueGradeSlice({ userId: 'u1', leagueId: 'L1' })
    expect(s.present).toBe(true)
    expect(s.value?.weakestPosition).toBeNull()
    expect(s.value?.strongestPosition).toBeNull()
  })

  it('uses deriveLeagueFormat, not raw league.isDynasty, so a leagueType/isDynasty mismatch resolves consistently with the rest of the codebase (BUG-4)', async () => {
    // leagueType wins over isDynasty when both are set — same tiebreak as canonicalLeagueRules.ts.
    findUniqueLeague.mockResolvedValue({ ...league, leagueType: 'redraft', isDynasty: true })
    findFirstTeam.mockResolvedValue({ platformUserId: 'p1', externalId: 'e1' })
    getRosterGrade.mockResolvedValue(null)
    await loadRosterValueGradeSlice({ userId: 'u1', leagueId: 'L1' })
    expect(getRosterGrade.mock.calls[0][0].isDynasty).toBe(false)
  })

  it('an exception is caught and reported as a gap, never thrown', async () => {
    findUniqueLeague.mockRejectedValue(new Error('db down'))
    const s = await loadRosterValueGradeSlice({ userId: 'u1', leagueId: 'L1' })
    expect(s.present).toBe(false)
    expect(s.gap?.reason).toBe('not_computed')
    expect(s.gap?.detail).toContain('db down')
  })
})
