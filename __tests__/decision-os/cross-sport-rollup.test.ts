import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const { findManyTeam, findManyLeague, listProfilesByLeague } = vi.hoisted(() => ({
  findManyTeam: vi.fn(),
  findManyLeague: vi.fn(),
  listProfilesByLeague: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: findManyTeam },
    league: { findMany: findManyLeague },
  },
}))
vi.mock('@/lib/psychological-profiles/ManagerBehaviorQueryService', () => ({ listProfilesByLeague }))

import { rollUpManagerAcrossSports } from '@/lib/psychological-profiles/CrossSportRollup'

function profile(managerId: string, labels: string[], anySufficient = true) {
  return { managerId, profileLabels: labels, evidenceSummary: { anySufficient } }
}

/**
 * ── R4b.5 (P7) — does a trait travel across sports, or is it sport-specific? ────────────────────
 * Two-level rule: WITHIN a sport, union every label seen (too few leagues per sport for a
 * within-sport majority to mean anything); ACROSS sports, the existing majority rule
 * (`CrossLeagueRollup`'s own threshold, just moved to the sport axis) decides which labels are
 * reported as consistent vs sport-specific.
 */
describe('R4b.5 — rollUpManagerAcrossSports', () => {
  beforeEach(() => vi.clearAllMocks())

  it('no leagues managed at all refuses cleanly', async () => {
    findManyTeam.mockResolvedValue([])
    findManyLeague.mockResolvedValue([])
    const r = await rollUpManagerAcrossSports({ userId: 'u1' })
    expect(r.sportsObserved).toBe(0)
    expect(r.caveat).toMatch(/not a manager/i)
  })

  it('🛑 ONE sport is not a pattern, and says so explicitly', async () => {
    findManyTeam.mockResolvedValue([{ leagueId: 'L1', externalId: 'm1' }])
    findManyLeague.mockResolvedValue([{ id: 'L1', sport: 'NFL' }])
    listProfilesByLeague.mockResolvedValue([profile('m1', ['aggressive'])])
    const r = await rollUpManagerAcrossSports({ userId: 'u1' })
    expect(r.sportsObserved).toBe(1)
    expect(r.consistentLabels).toEqual([])
    expect(r.caveat).toMatch(/single-sport read/i)
  })

  it('a label in BOTH observed sports is consistent; one seen in only ONE is sport-specific', async () => {
    findManyTeam.mockResolvedValue([
      { leagueId: 'L1', externalId: 'm1' },
      { leagueId: 'L2', externalId: 'm2' },
    ])
    findManyLeague.mockResolvedValue([
      { id: 'L1', sport: 'NFL' },
      { id: 'L2', sport: 'NBA' },
    ])
    listProfilesByLeague.mockImplementation(async (leagueId: string) =>
      leagueId === 'L1' ? [profile('m1', ['aggressive', 'trade-heavy'])] : [profile('m2', ['aggressive', 'passive'])],
    )
    const r = await rollUpManagerAcrossSports({ userId: 'u1' })
    expect(r.sportsObserved).toBe(2)
    expect(r.consistentLabels).toEqual(['aggressive'])
    expect(r.sportSpecificLabels.sort()).toEqual(['passive', 'trade-heavy'])
  })

  it('within one sport, labels UNION across multiple leagues rather than requiring majority', async () => {
    // Two NFL leagues, two NBA leagues — 'grinder' appears in only ONE of the two NFL leagues but
    // should still count as an NFL trait (union), not be dropped for failing an NFL-internal vote.
    findManyTeam.mockResolvedValue([
      { leagueId: 'L1', externalId: 'm1' },
      { leagueId: 'L2', externalId: 'm2' },
      { leagueId: 'L3', externalId: 'm3' },
    ])
    findManyLeague.mockResolvedValue([
      { id: 'L1', sport: 'NFL' },
      { id: 'L2', sport: 'NFL' },
      { id: 'L3', sport: 'NBA' },
    ])
    listProfilesByLeague.mockImplementation(async (leagueId: string) => {
      if (leagueId === 'L1') return [profile('m1', ['grinder'])]
      if (leagueId === 'L2') return [profile('m2', [])]
      return [profile('m3', ['grinder'])]
    })
    const r = await rollUpManagerAcrossSports({ userId: 'u1' })
    // NFL's label set = {grinder} (union of L1+L2), NBA's = {grinder} — consistent across 2 sports.
    expect(r.consistentLabels).toEqual(['grinder'])
  })

  it('a profile below the evidence floor counts as sportsWithoutProfile, not a silent skip', async () => {
    findManyTeam.mockResolvedValue([{ leagueId: 'L1', externalId: 'm1' }])
    findManyLeague.mockResolvedValue([{ id: 'L1', sport: 'NFL' }])
    listProfilesByLeague.mockResolvedValue([profile('m1', ['aggressive'], false)])
    const r = await rollUpManagerAcrossSports({ userId: 'u1' })
    expect(r.sportsObserved).toBe(0)
    expect(r.sportsWithoutProfile).toBe(1)
  })

  it('a query failure rejects rather than reporting a false empty result — the same contract rollUpManagerAcrossLeagues already has, and the packet producer is what catches it', async () => {
    // leagueIdsForUser has no try/catch of its own (matching CrossLeagueRollup.ts's pre-existing
    // rollUpManagerAcrossLeagues), so a genuine query failure propagates rather than reading
    // identically to "this user manages nothing" — the psychologyConsistencySlice producer is the
    // layer that turns this into an honest gap; a silent [] here would hide the difference between
    // those two very different situations.
    findManyTeam.mockRejectedValue(new Error('db down'))
    findManyLeague.mockResolvedValue([])
    await expect(rollUpManagerAcrossSports({ userId: 'u1' })).rejects.toThrow('db down')
  })
})
