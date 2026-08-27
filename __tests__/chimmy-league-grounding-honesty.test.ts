import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const findFirstMock = vi.hoisted(() => vi.fn())
const findManyMock = vi.hoisted(() => vi.fn())
const countMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: findFirstMock },
    redraftRoster: { findMany: findManyMock, count: countMock },
  },
}))

import { buildLeagueStandingsContext } from '@/lib/chimmy/leagueStandingsGrounding'

function roster(i: number, over: Record<string, unknown> = {}) {
  return {
    ownerId: `owner-${i}`,
    ownerName: `Manager ${i}`,
    teamName: `Team ${i}`,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    streak: null,
    playoffSeed: null,
    faabBalance: 100,
    isEliminated: false,
    ...over,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  findFirstMock.mockResolvedValue({ id: 'season-1', season: 2026 })
})

describe('league standings grounding never presents a cap as a count', () => {
  /*
   * ⚠ THE REAL FAILURE, REPRODUCED. KBFL is a 32-team dynasty league. The header
   * line interpolated `rows.length`, which is whatever `take` returned, so its
   * own commissioner was told "the league has 20 teams" — a precise, confident
   * number generated entirely by a LIMIT clause.
   */
  it('reports the TRUE team count, not the number of rows fetched', async () => {
    findManyMock.mockResolvedValue(Array.from({ length: 40 }, (_, i) => roster(i)))
    countMock.mockResolvedValue(32)

    const text = await buildLeagueStandingsContext('league-1', 'owner-3')

    expect(text).toContain('32 teams in the league')
    expect(text).not.toContain('40 teams in the league')
  })

  it('says so out loud when the list is truncated', async () => {
    findManyMock.mockResolvedValue(Array.from({ length: 40 }, (_, i) => roster(i)))
    countMock.mockResolvedValue(64)

    const text = await buildLeagueStandingsContext('league-1', 'owner-3')

    expect(text).toContain('64 teams in the league')
    expect(text).toMatch(/ONLY 40 of those 64/)
    /* And forbids the answers a partial table would otherwise support. */
    expect(text).toMatch(/do NOT say who is last/i)
  })

  it('adds no truncation warning when the list is complete', async () => {
    findManyMock.mockResolvedValue(Array.from({ length: 12 }, (_, i) => roster(i)))
    countMock.mockResolvedValue(12)

    const text = await buildLeagueStandingsContext('league-1', 'owner-3')

    expect(text).toContain('12 teams in the league')
    expect(text).not.toMatch(/truncated/i)
  })

  /*
   * A failed count must not silently fall back to claiming rows.length is the
   * league size — that is the original bug wearing a different hat.
   */
  it('does not invent a count when the count query fails', async () => {
    findManyMock.mockResolvedValue(Array.from({ length: 40 }, (_, i) => roster(i)))
    countMock.mockRejectedValue(new Error('db down'))

    const text = await buildLeagueStandingsContext('league-1', 'owner-3')

    /* Falls back to the rows it actually has, and claims nothing beyond them. */
    expect(text).toContain('40 teams in the league')
    expect(text).not.toMatch(/ONLY 40 of those/)
  })

  it('still returns null when there is no season on file', async () => {
    findFirstMock.mockResolvedValue(null)
    expect(await buildLeagueStandingsContext('league-1', 'owner-3')).toBeNull()
  })
})
