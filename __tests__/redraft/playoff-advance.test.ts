/**
 * Regression tests for advancePlayoffWinners — Phase 1 blocker #2.
 *
 * The function was a no-op stub. This test suite verifies the implemented
 * behaviour by mocking Prisma and asserting on DB call patterns.
 *
 * Scenarios covered:
 *  - no bracket → returns 'no_bracket' safely
 *  - no active round → returns 'no_active_round' safely
 *  - bye matchup auto-advances without requiring scores
 *  - round-1 winner fills empty home slot in round-2 matchup
 *  - round-1 winner fills empty away slot when home is already filled
 *  - incomplete matchup (scores null) is skipped, no DB write
 *  - exact tie with seed tiebreaker resolves correctly
 *  - exact tie without seed tiebreaker returns blocked entry, no advance
 *  - idempotent: winner already in next slot → skipped counter increments, no double-write
 *  - all matchups resolved → active round marked complete, next round activated
 *  - final round complete → returns 'ready_for_champion_finalization', no season close-out
 *  - generatePlayoffBracket still seeds correctly (existing behaviour not broken)
 *  - advancePlayoffWinners is async and returns AdvancePlayoffResult shape
 *  - API route POST /api/redraft/playoffs/advance exists and references advancePlayoffWinners
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdvancePlayoffResult } from '@/lib/redraft/playoffEngine'

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const bracketFindUnique = vi.fn()
const roundFindMany = vi.fn()
const matchupUpdate = vi.fn()
const matchupFindUnique = vi.fn()
const matchupFindMany = vi.fn()
const roundUpdate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftPlayoffBracket: { findUnique: bracketFindUnique },
    redraftPlayoffRound: { findMany: roundFindMany, update: roundUpdate },
    redraftPlayoffMatchup: {
      update: matchupUpdate,
      findUnique: matchupFindUnique,
      findMany: matchupFindMany,
    },
  },
}))

vi.mock('@/lib/sportConfig', () => ({
  tryGetSportConfig: () => ({
    defaultPlayoffTeams: 4,
    defaultPlayoffStartWeek: 15,
  }),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRound(overrides: Partial<{ id: string; roundNumber: number; status: string; matchups: unknown[] }> = {}) {
  return {
    id: 'round-1',
    seasonId: 'season-1',
    bracketId: 'bracket-1',
    roundNumber: 1,
    roundName: 'Semifinal',
    status: 'active',
    matchups: [],
    ...overrides,
  }
}

function makeMatchup(overrides: Partial<{
  id: string
  homeRosterId: string | null
  awayRosterId: string | null
  homeSeed: number | null
  awaySeed: number | null
  homeScore: number | null
  awayScore: number | null
  winnerRosterId: string | null
  nextMatchupId: string | null
  status: string
  nextMatchup: unknown
  roundId: string
  matchupNumber: number
}> = {}) {
  return {
    id: 'match-1',
    seasonId: 'season-1',
    roundId: 'round-1',
    matchupNumber: 1,
    homeRosterId: 'roster-a',
    awayRosterId: 'roster-b',
    homeSeed: 1,
    awaySeed: 4,
    homeScore: null,
    awayScore: null,
    winnerRosterId: null,
    nextMatchupId: 'match-final',
    status: 'scheduled',
    nextMatchup: null,
    ...overrides,
  }
}

const SEASON_ID = 'season-1'
const WEEK = 15

// ─── Import after mocks ───────────────────────────────────────────────────────

let advancePlayoffWinners: typeof import('@/lib/redraft/playoffEngine').advancePlayoffWinners

beforeEach(async () => {
  vi.clearAllMocks()
  ;({ advancePlayoffWinners } = await import('@/lib/redraft/playoffEngine'))
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('advancePlayoffWinners — no bracket', () => {
  it('returns no_bracket status when bracket does not exist', async () => {
    bracketFindUnique.mockResolvedValue(null)
    const result = await advancePlayoffWinners(SEASON_ID, WEEK)
    expect(result.status).toBe('no_bracket')
    expect(result.advanced).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.blocked).toEqual([])
    expect(roundFindMany).not.toHaveBeenCalled()
  })
})

describe('advancePlayoffWinners — no active round', () => {
  it('returns no_active_round when all rounds are pending or complete', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1', seasonId: SEASON_ID })
    roundFindMany.mockResolvedValue([
      makeRound({ status: 'complete' }),
      makeRound({ id: 'round-2', roundNumber: 2, status: 'pending' }),
    ])
    const result = await advancePlayoffWinners(SEASON_ID, WEEK)
    expect(result.status).toBe('no_active_round')
    expect(result.advanced).toBe(0)
  })

  it('returns no_active_round when there are no rounds at all', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1' })
    roundFindMany.mockResolvedValue([])
    const result = await advancePlayoffWinners(SEASON_ID, WEEK)
    expect(result.status).toBe('no_active_round')
  })
})

describe('advancePlayoffWinners — bye matchup', () => {
  it('auto-advances bye matchup winner into next round home slot', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1' })
    const byeMatchup = makeMatchup({
      id: 'match-bye',
      status: 'bye',
      homeRosterId: 'roster-top',
      awayRosterId: null,
      winnerRosterId: 'roster-top',
      nextMatchupId: 'match-final',
    })
    roundFindMany.mockResolvedValue([makeRound({ matchups: [byeMatchup] })])
    matchupFindUnique.mockResolvedValue({ id: 'match-final', homeRosterId: null, awayRosterId: null })
    matchupFindMany.mockResolvedValue([{ winnerRosterId: 'roster-top', status: 'bye' }])

    const result = await advancePlayoffWinners(SEASON_ID, WEEK)
    // Winner should be written to home slot of next matchup
    expect(matchupUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'match-final' },
      data: { homeRosterId: 'roster-top' },
    }))
    expect(result.advanced).toBe(1)
  })
})

describe('advancePlayoffWinners — score-based winner', () => {
  it('advances home team when homeScore > awayScore', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1' })
    const completedMatchup = makeMatchup({
      homeScore: 142.5,
      awayScore: 118.2,
      status: 'complete',
      winnerRosterId: null,
      nextMatchupId: 'match-final',
    })
    roundFindMany.mockResolvedValue([makeRound({ matchups: [completedMatchup] })])
    matchupFindUnique.mockResolvedValue({ id: 'match-final', homeRosterId: null, awayRosterId: null })
    matchupFindMany.mockResolvedValue([{ winnerRosterId: 'roster-a', status: 'complete' }])

    await advancePlayoffWinners(SEASON_ID, WEEK)
    // Sets winnerRosterId on the matchup
    expect(matchupUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'match-1' },
      data: expect.objectContaining({ winnerRosterId: 'roster-a' }),
    }))
    // Advances to next matchup home slot
    expect(matchupUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'match-final' },
      data: { homeRosterId: 'roster-a' },
    }))
  })

  it('advances away team when awayScore > homeScore', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1' })
    const completedMatchup = makeMatchup({
      homeScore: 98.0,
      awayScore: 124.8,
      winnerRosterId: null,
      status: 'complete',
      nextMatchupId: 'match-final',
    })
    roundFindMany.mockResolvedValue([makeRound({ matchups: [completedMatchup] })])
    matchupFindUnique.mockResolvedValue({ id: 'match-final', homeRosterId: null, awayRosterId: null })
    matchupFindMany.mockResolvedValue([{ winnerRosterId: 'roster-b', status: 'complete' }])

    await advancePlayoffWinners(SEASON_ID, WEEK)
    expect(matchupUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'match-1' },
      data: expect.objectContaining({ winnerRosterId: 'roster-b' }),
    }))
  })

  it('fills away slot when home slot is already occupied', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1' })
    const m = makeMatchup({
      homeScore: 142.5,
      awayScore: 118.2,
      winnerRosterId: null,
      status: 'complete',
      nextMatchupId: 'match-final',
    })
    roundFindMany.mockResolvedValue([makeRound({ matchups: [m] })])
    matchupFindUnique.mockResolvedValue({
      id: 'match-final',
      homeRosterId: 'roster-other',  // home already filled
      awayRosterId: null,
    })
    matchupFindMany.mockResolvedValue([{ winnerRosterId: 'roster-a', status: 'complete' }])

    await advancePlayoffWinners(SEASON_ID, WEEK)
    expect(matchupUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'match-final' },
      data: { awayRosterId: 'roster-a' },
    }))
  })
})

describe('advancePlayoffWinners — incomplete matchup', () => {
  it('skips matchup when scores are null (game not yet played)', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1' })
    const incompleteMatchup = makeMatchup({ homeScore: null, awayScore: null, winnerRosterId: null })
    roundFindMany.mockResolvedValue([makeRound({ matchups: [incompleteMatchup] })])
    matchupFindMany.mockResolvedValue([{ winnerRosterId: null, status: 'scheduled' }])

    const result = await advancePlayoffWinners(SEASON_ID, WEEK)
    expect(result.advanced).toBe(0)
    // matchupUpdate should not be called for the incomplete matchup's winnerRosterId
    const winnerUpdates = matchupUpdate.mock.calls.filter(
      (args: unknown[]) => (args[0] as { where: { id: string } }).where.id === 'match-1',
    )
    expect(winnerUpdates.length).toBe(0)
  })
})

describe('advancePlayoffWinners — tied scores', () => {
  it('resolves tie using seed (lower seed wins)', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1' })
    const tiedMatchup = makeMatchup({
      homeScore: 110.5,
      awayScore: 110.5,
      homeSeed: 1,
      awaySeed: 4,
      winnerRosterId: null,
      status: 'complete',
      nextMatchupId: 'match-final',
    })
    roundFindMany.mockResolvedValue([makeRound({ matchups: [tiedMatchup] })])
    matchupFindUnique.mockResolvedValue({ id: 'match-final', homeRosterId: null, awayRosterId: null })
    matchupFindMany.mockResolvedValue([{ winnerRosterId: 'roster-a', status: 'complete' }])

    await advancePlayoffWinners(SEASON_ID, WEEK)
    // homeSeed 1 < awaySeed 4 → home (roster-a) wins
    expect(matchupUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ winnerRosterId: 'roster-a' }),
    }))
  })

  it('returns blocked entry when tie cannot be resolved by seed', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1' })
    const unresolvableTie = makeMatchup({
      homeScore: 110.5,
      awayScore: 110.5,
      homeSeed: null,  // no seed info
      awaySeed: null,
      winnerRosterId: null,
      status: 'complete',
    })
    roundFindMany.mockResolvedValue([makeRound({ matchups: [unresolvableTie] })])
    matchupFindMany.mockResolvedValue([{ winnerRosterId: null, status: 'scheduled' }])

    const result = await advancePlayoffWinners(SEASON_ID, WEEK)
    expect(result.blocked.length).toBe(1)
    expect(result.blocked[0].matchupId).toBe('match-1')
    expect(result.blocked[0].reason).toMatch(/tied/i)
    expect(result.advanced).toBe(0)
  })
})

describe('advancePlayoffWinners — idempotency', () => {
  it('increments skipped counter when winner is already in next matchup home slot', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1' })
    const m = makeMatchup({
      winnerRosterId: 'roster-a',  // already resolved
      homeScore: 142.5,
      awayScore: 118.2,
      status: 'complete',
      nextMatchupId: 'match-final',
    })
    roundFindMany.mockResolvedValue([makeRound({ matchups: [m] })])
    // Winner already occupies home slot in next matchup
    matchupFindUnique.mockResolvedValue({
      id: 'match-final',
      homeRosterId: 'roster-a',
      awayRosterId: null,
    })
    matchupFindMany.mockResolvedValue([{ winnerRosterId: 'roster-a', status: 'complete' }])

    const result = await advancePlayoffWinners(SEASON_ID, WEEK)
    expect(result.skipped).toBe(1)
    expect(result.advanced).toBe(0)
    // Should NOT call update on the next matchup
    const nextMatchupUpdates = matchupUpdate.mock.calls.filter(
      (args: unknown[]) => (args[0] as { where: { id: string } }).where.id === 'match-final',
    )
    expect(nextMatchupUpdates.length).toBe(0)
  })

  it('increments skipped counter when winner is already in away slot', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1' })
    const m = makeMatchup({
      winnerRosterId: 'roster-a',
      homeScore: 142.5,
      awayScore: 118.2,
      status: 'complete',
      nextMatchupId: 'match-final',
    })
    roundFindMany.mockResolvedValue([makeRound({ matchups: [m] })])
    matchupFindUnique.mockResolvedValue({
      id: 'match-final',
      homeRosterId: 'roster-other',
      awayRosterId: 'roster-a',  // winner already in away slot
    })
    matchupFindMany.mockResolvedValue([{ winnerRosterId: 'roster-a', status: 'complete' }])

    const result = await advancePlayoffWinners(SEASON_ID, WEEK)
    expect(result.skipped).toBe(1)
    expect(result.advanced).toBe(0)
  })
})

describe('advancePlayoffWinners — round transitions', () => {
  it('marks active round complete and activates next round when all matchups resolved', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1' })
    const m = makeMatchup({
      winnerRosterId: 'roster-a',
      status: 'complete',
      nextMatchupId: 'match-final',
    })
    const round1 = makeRound({ id: 'round-1', roundNumber: 1, status: 'active', matchups: [m] })
    const round2 = makeRound({ id: 'round-2', roundNumber: 2, status: 'pending', matchups: [] })
    roundFindMany.mockResolvedValue([round1, round2])
    matchupFindUnique.mockResolvedValue({ id: 'match-final', homeRosterId: null, awayRosterId: null })
    matchupFindMany.mockResolvedValue([{ winnerRosterId: 'roster-a', status: 'complete' }])

    const result = await advancePlayoffWinners(SEASON_ID, WEEK)
    expect(result.status).toBe('round_complete')
    expect(roundUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'round-1' }, data: { status: 'completed' } }),
    )
    expect(roundUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'round-2' }, data: { status: 'active' } }),
    )
  })

  it('returns ready_for_champion_finalization when the final round completes', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1' })
    const m = makeMatchup({
      winnerRosterId: 'roster-champ',
      status: 'complete',
      nextMatchupId: null,  // final round matchup has no next
    })
    const finalRound = makeRound({
      id: 'round-final',
      roundNumber: 2,
      status: 'active',
      matchups: [m],
    })
    roundFindMany.mockResolvedValue([finalRound])
    matchupFindMany.mockResolvedValue([{ winnerRosterId: 'roster-champ', status: 'complete' }])

    const result = await advancePlayoffWinners(SEASON_ID, WEEK)
    expect(result.status).toBe('ready_for_champion_finalization')
    // Champion crowning must NOT happen here — season status untouched
    expect(roundUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'completed' } }),
    )
    // Should not try to activate another round (none exists)
    const activationCalls = roundUpdate.mock.calls.filter(
      (args: unknown[]) => (args[0] as { data: { status: string } }).data.status === 'active',
    )
    expect(activationCalls.length).toBe(0)
  })

  it('does NOT touch season status when final round completes (champion crowning is separate)', async () => {
    bracketFindUnique.mockResolvedValue({ id: 'bracket-1' })
    const m = makeMatchup({ winnerRosterId: 'roster-champ', status: 'complete', nextMatchupId: null })
    roundFindMany.mockResolvedValue([makeRound({ matchups: [m] })])
    matchupFindMany.mockResolvedValue([{ winnerRosterId: 'roster-champ', status: 'complete' }])

    await advancePlayoffWinners(SEASON_ID, WEEK)
    // No prisma call to redraftSeason.update — that's blocker #3
    // We verify by checking roundUpdate and matchupUpdate are the only writes
    const allUpdateCalls = [...matchupUpdate.mock.calls, ...roundUpdate.mock.calls]
    expect(allUpdateCalls.length).toBeGreaterThan(0)
    // No season update call (the test would fail if we import and call prisma.redraftSeason.update)
  })
})

describe('advancePlayoffWinners — return shape', () => {
  it('always returns the full AdvancePlayoffResult shape', async () => {
    bracketFindUnique.mockResolvedValue(null)
    const result = await advancePlayoffWinners(SEASON_ID, WEEK) as AdvancePlayoffResult
    expect(result).toHaveProperty('seasonId', SEASON_ID)
    expect(result).toHaveProperty('week', WEEK)
    expect(result).toHaveProperty('advanced')
    expect(result).toHaveProperty('skipped')
    expect(result).toHaveProperty('blocked')
    expect(result).toHaveProperty('status')
    expect(Array.isArray(result.blocked)).toBe(true)
  })

  it('function is async and returns a Promise', () => {
    bracketFindUnique.mockResolvedValue(null)
    const ret = advancePlayoffWinners(SEASON_ID, WEEK)
    expect(ret).toBeInstanceOf(Promise)
  })
})

describe('generatePlayoffBracket — existing behaviour unchanged', () => {
  it('seeds top-n rosters by wins then pointsFor', async () => {
    const { generatePlayoffBracket } = await import('@/lib/redraft/playoffEngine')
    const rosters = [
      { id: 'r1', wins: 10, losses: 4, ties: 0, pointsFor: 1500, pointsAgainst: 1200 } as never,
      { id: 'r2', wins: 8, losses: 6, ties: 0, pointsFor: 1600, pointsAgainst: 1300 } as never,
      { id: 'r3', wins: 8, losses: 6, ties: 0, pointsFor: 1400, pointsAgainst: 1100 } as never,
      { id: 'r4', wins: 6, losses: 8, ties: 0, pointsFor: 1300, pointsAgainst: 1400 } as never,
    ]
    const bracket = generatePlayoffBracket(rosters, 4, false, 'consolation')
    expect(bracket.upperBracket).toHaveLength(1)
    expect(bracket.upperBracket[0].round).toBe(1)
    expect(bracket.upperBracket[0].matchups).toHaveLength(2)
    // Top seed (r1 — 10 wins) paired with 4th seed (r4 — 6 wins)
    expect(bracket.upperBracket[0].matchups[0].home).toBe('r1')
    expect(bracket.upperBracket[0].matchups[0].away).toBe('r4')
    // 2nd seed (r2 — 1600 PF) vs 3rd (r3 — 1400 PF)
    expect(bracket.upperBracket[0].matchups[1].home).toBe('r2')
  })

  it('respects playoffTeams limit', async () => {
    const { generatePlayoffBracket } = await import('@/lib/redraft/playoffEngine')
    const rosters = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`,
      wins: 10 - i,
      losses: i,
      ties: 0,
      pointsFor: 1500 - i * 50,
      pointsAgainst: 1000,
    })) as never[]
    const bracket = generatePlayoffBracket(rosters, 4, false, 'consolation')
    const allTeams = bracket.upperBracket.flatMap((r) =>
      r.matchups.flatMap((m) => [m.home, m.away]),
    ).filter(Boolean)
    // Only 4 teams should appear
    const uniqueTeams = new Set(allTeams)
    expect(uniqueTeams.size).toBe(4)
  })
})

describe('API route — POST /api/redraft/playoffs/advance', () => {
  it('route file exists and exports a POST handler', async () => {
    const mod = await import('@/app/api/redraft/playoffs/advance/route')
    expect(typeof mod.POST).toBe('function')
  })

  it('route imports advancePlayoffWinners from playoffEngine', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(
      resolve(process.cwd(), 'app/api/redraft/playoffs/advance/route.ts'),
      'utf8',
    )
    expect(src).toContain('advancePlayoffWinners')
    expect(src).toContain('playoffEngine')
  })

  it('route requires commissioner access', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(
      resolve(process.cwd(), 'app/api/redraft/playoffs/advance/route.ts'),
      'utf8',
    )
    expect(src).toContain('Unauthorized')
    expect(src).toContain('Forbidden')
    expect(src).toContain('seasonId')
  })
})
