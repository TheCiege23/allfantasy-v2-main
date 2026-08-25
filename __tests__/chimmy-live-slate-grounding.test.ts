import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ gameFindMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany: mocks.gameFindMany } } }))

import { buildLiveSlateContext } from '@/lib/chimmy/liveSlateGrounding'
import { nflFixtureKey, resolveNflTeamRef, sameNflTeam } from '@/lib/sports/teamRef'

function starter(playerName: string, team: string) {
  return {
    playerId: playerName,
    playerName,
    position: 'WR',
    team,
    injuryStatus: null,
    adp: null,
    projectedPoints: 12,
    isStarter: true,
  }
}

function rosters(players: Array<{ name: string; team: string }>) {
  return [
    {
      userId: 'u1',
      teamName: 'My Team',
      starters: players.map((p) => starter(p.name, p.team)),
      bench: [],
    },
  ] as never
}

function game(overrides: Record<string, unknown> = {}) {
  return {
    homeTeam: 'JAX',
    awayTeam: 'TEN',
    status: 'scheduled',
    startTime: new Date('2026-09-07T17:00:00.000Z'),
    week: 1,
    season: 2026,
    source: 'espn_live',
    homeScore: null,
    awayScore: null,
    ...overrides,
  }
}

describe('resolveNflTeamRef — the formats that actually appear', () => {
  it('resolves an abbreviation, a full name, and a nickname to the same team', () => {
    const abbr = resolveNflTeamRef('ARI')
    expect(abbr).not.toBeNull()
    expect(resolveNflTeamRef('Arizona Cardinals')).toBe(abbr)
    expect(resolveNflTeamRef('Cardinals')).toBe(abbr)
  })

  it('follows relocations and the Washington abbreviation split', () => {
    expect(sameNflTeam('JAC', 'JAX')).toBe(true)
    expect(sameNflTeam('OAK', 'LV')).toBe(true)
    expect(sameNflTeam('WSH', 'WAS')).toBe(true)
  })

  it('returns null rather than a wrong team', () => {
    expect(resolveNflTeamRef('NOT A TEAM')).toBeNull()
    expect(resolveNflTeamRef('')).toBeNull()
    expect(sameNflTeam('JAX', null)).toBe(false)
  })

  /*
   * `externalId` differs BY source, which is what creates the duplicates — so the
   * key has to be built from team identity instead.
   */
  it('gives one fixture the same key across formats and sources', () => {
    const a = nflFixtureKey({ homeTeam: 'JAX', awayTeam: 'TEN', startTime: new Date('2026-09-07T17:00:00Z'), week: 1, season: 2026 })
    const b = nflFixtureKey({ homeTeam: 'Jacksonville Jaguars', awayTeam: 'Tennessee Titans', startTime: new Date('2026-09-07T17:20:00Z'), week: 1, season: 2026 })
    expect(a).toBe(b)
  })
})

describe('buildLiveSlateContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.gameFindMany.mockResolvedValue([game()])
  })

  it('separates finished, in-progress and not-started starters', async () => {
    mocks.gameFindMany.mockResolvedValue([
      game({ homeTeam: 'JAX', awayTeam: 'TEN', status: 'FT', homeScore: 24, awayScore: 17 }),
      game({ homeTeam: 'KC', awayTeam: 'BUF', status: 'IN2' }),
      game({ homeTeam: 'DAL', awayTeam: 'PHI', status: 'NS' }),
    ])

    const out = await buildLiveSlateContext({
      rosters: rosters([
        { name: 'Done Guy', team: 'JAX' },
        { name: 'Playing Guy', team: 'KC' },
        { name: 'Later Guy', team: 'DAL' },
      ]),
      sport: 'NFL',
      season: 2026,
      week: 1,
    })

    expect(out).toContain('ALREADY PLAYED')
    expect(out).toContain('Done Guy')
    expect(out).toContain('PLAYING NOW')
    expect(out).toContain('Playing Guy')
    expect(out).toContain('NOT STARTED')
    expect(out).toContain('Later Guy')
  })

  /* The whole point: only a not-started player can still be moved. */
  it('forbids recommending a change to a player already playing', async () => {
    const out = await buildLiveSlateContext({
      rosters: rosters([{ name: 'Done Guy', team: 'JAX' }]),
      sport: 'NFL',
      season: 2026,
      week: 1,
    })
    expect(out).toMatch(/only a NOT STARTED player can still be benched/i)
  })

  it('matches a roster abbreviation against a full-name schedule row', async () => {
    mocks.gameFindMany.mockResolvedValue([
      game({ homeTeam: 'Jacksonville Jaguars', awayTeam: 'Tennessee Titans', status: 'FT', source: 'thesportsdb' }),
    ])

    const out = await buildLiveSlateContext({
      rosters: rosters([{ name: 'Done Guy', team: 'JAX' }]),
      sport: 'NFL',
      season: 2026,
      week: 1,
    })

    expect(out).toContain('ALREADY PLAYED')
  })

  /*
   * One fixture stored four times, with the sources disagreeing. The live feed
   * wins; without collapsing, the same game reads as both final and not started.
   */
  it('collapses one fixture stored under several sources, preferring the live feed', async () => {
    mocks.gameFindMany.mockResolvedValue([
      game({ status: 'NS', source: 'thesportsdb', homeTeam: 'Jacksonville Jaguars', awayTeam: 'Tennessee Titans' }),
      game({ status: 'FT', source: 'espn_live', homeScore: 24, awayScore: 17 }),
    ])

    const out = await buildLiveSlateContext({
      rosters: rosters([{ name: 'Done Guy', team: 'JAX' }]),
      sport: 'NFL',
      season: 2026,
      week: 1,
    })

    expect(out).toContain('ALREADY PLAYED')
    // The rules line always mentions the words, so assert on the SECTION.
    expect(out).not.toContain('NOT STARTED — still changeable')
  })

  it('reports an unrecognised status as unknown rather than assuming', async () => {
    mocks.gameFindMany.mockResolvedValue([game({ status: 'SOMETHING_NEW' })])

    const out = await buildLiveSlateContext({
      rosters: rosters([{ name: 'Mystery Guy', team: 'JAX' }]),
      sport: 'NFL',
      season: 2026,
      week: 1,
    })

    expect(out).toContain('STATUS UNKNOWN')
    expect(out).toMatch(/say you cannot tell rather than assuming either way/i)
  })

  it('says so when a starter has no game on the slate', async () => {
    const out = await buildLiveSlateContext({
      rosters: rosters([{ name: 'Bye Week Guy', team: 'SEA' }]),
      sport: 'NFL',
      season: 2026,
      week: 1,
    })
    expect(out).toContain('no game found')
  })

  it('returns null for a sport it cannot resolve teams for', async () => {
    expect(
      await buildLiveSlateContext({ rosters: rosters([{ name: 'X', team: 'LAL' }]), sport: 'NBA', season: 2026, week: 1 }),
    ).toBeNull()
    expect(mocks.gameFindMany).not.toHaveBeenCalled()
  })

  it('returns null when there are no starters', async () => {
    expect(await buildLiveSlateContext({ rosters: null, sport: 'NFL', season: 2026, week: 1 })).toBeNull()
  })
})
