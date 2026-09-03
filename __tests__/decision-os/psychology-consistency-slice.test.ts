import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const { findManyTeam, rollUpLeagues, rollUpSports } = vi.hoisted(() => ({
  findManyTeam: vi.fn(),
  rollUpLeagues: vi.fn(),
  rollUpSports: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { leagueTeam: { findMany: findManyTeam } },
}))
vi.mock('@/lib/psychological-profiles/CrossLeagueRollup', () => ({ rollUpManagerAcrossLeagues: rollUpLeagues }))
vi.mock('@/lib/psychological-profiles/CrossSportRollup', () => ({ rollUpManagerAcrossSports: rollUpSports }))

import { loadPsychologyConsistencySlice } from '@/lib/decision-os/grounding/psychologyConsistencySlice'

const CROSS_LEAGUE_STUB = {
  subjectPlatformUserId: 'p1', subjectName: 'Me', isSelf: true,
  leaguesObserved: 3, leaguesWithoutProfile: 1,
  labels: [], consistentLabels: ['aggressive'], dimensions: { trade: { leaguesObserved: 0, totalEvidence: 0 }, draft: { leaguesObserved: 0, totalEvidence: 0 }, roster: { leaguesObserved: 0, totalEvidence: 0 } },
  caveat: null, locked: false,
}
const CROSS_SPORT_STUB = {
  userId: 'u1', sportsObserved: 2, sportsWithoutProfile: 0,
  consistentLabels: ['aggressive'], sportSpecificLabels: ['trade-heavy'], caveat: null,
}

describe('R4b.5 — psychologyConsistencySlice: self cross-league + cross-sport', () => {
  beforeEach(() => vi.clearAllMocks())

  it('missing userId or leagueId refuses with not_requested and runs no query', async () => {
    const s1 = await loadPsychologyConsistencySlice({ userId: null, leagueId: 'L1' })
    const s2 = await loadPsychologyConsistencySlice({ userId: 'u1', leagueId: null })
    expect(s1.gap?.reason).toBe('not_requested')
    expect(s2.gap?.reason).toBe('not_requested')
    expect(findManyTeam).not.toHaveBeenCalled()
  })

  it('🛑 resolves platformUserId from ANY claimed team, not just the current league — a data gap on this league must not disable a read another league could answer', async () => {
    findManyTeam.mockResolvedValue([{ platformUserId: 'p-from-another-league' }])
    rollUpLeagues.mockResolvedValue(CROSS_LEAGUE_STUB)
    rollUpSports.mockResolvedValue(CROSS_SPORT_STUB)
    await loadPsychologyConsistencySlice({ userId: 'u1', leagueId: 'L-current' })
    expect(rollUpLeagues).toHaveBeenCalledWith({
      viewerUserId: 'u1', subjectPlatformUserId: 'p-from-another-league', canSeeOthers: false,
    })
  })

  it('flattens both rollups into primitive fields the non-recursive renderer can show', async () => {
    findManyTeam.mockResolvedValue([{ platformUserId: 'p1' }])
    rollUpLeagues.mockResolvedValue(CROSS_LEAGUE_STUB)
    rollUpSports.mockResolvedValue(CROSS_SPORT_STUB)
    const s = await loadPsychologyConsistencySlice({ userId: 'u1', leagueId: 'L1' })
    expect(s.present).toBe(true)
    expect(s.value).not.toHaveProperty('dimensions')
    expect(s.value).not.toHaveProperty('labels')
    expect(s.value).toMatchObject({
      crossLeagueObserved: 3,
      crossLeagueWithoutProfile: 1,
      crossLeagueConsistentLabels: ['aggressive'],
      crossSportObserved: 2,
      crossSportConsistentLabels: ['aggressive'],
      crossSportSpecificLabels: ['trade-heavy'],
    })
  })

  it('no claimed team anywhere skips the cross-league call but still attempts cross-sport', async () => {
    findManyTeam.mockResolvedValue([])
    rollUpSports.mockResolvedValue({ ...CROSS_SPORT_STUB, sportsObserved: 0, consistentLabels: [], sportSpecificLabels: [], caveat: 'Not a manager in any recorded league.' })
    const s = await loadPsychologyConsistencySlice({ userId: 'u1', leagueId: 'L1' })
    expect(rollUpLeagues).not.toHaveBeenCalled()
    expect(s.present).toBe(false)
    expect(s.gap?.reason).toBe('not_computed')
  })

  it('🛑 a thrown rejection from either rollup is caught here — this IS the safety net, not the rollup itself', async () => {
    // leagueIdsForUser (inside both rollups) has no try/catch of its own; this producer's
    // try/catch is the only thing standing between a query failure and an unhandled rejection
    // reaching the packet assembly.
    findManyTeam.mockResolvedValue([{ platformUserId: 'p1' }])
    rollUpLeagues.mockRejectedValue(new Error('db down'))
    const s = await loadPsychologyConsistencySlice({ userId: 'u1', leagueId: 'L1' })
    expect(s.present).toBe(false)
    expect(s.gap?.reason).toBe('not_computed')
    expect(s.gap?.detail).toContain('db down')
  })
})
