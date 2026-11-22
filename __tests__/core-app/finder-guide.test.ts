/**
 * The Player Finder guide (2026-11-13). The owner's ask: on game day an injury or questionable alert
 * lands on the player, and you can find him by name OR by team, then see every league he is in.
 * lib/core-app/finderGuide.ts and searchFinderPlayers in lib/core-app/playerFinder.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => [] as unknown[]),
  sportsPlayer: { findMany: vi.fn(async (_args?: unknown) => [] as unknown[]) },
  playerImage: { findMany: vi.fn(async () => [] as unknown[]) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { finderPlayerHref, finderTeamHref, leagueCountOf, teamCodesForQuery } from '@/lib/core-app/finderGuide'
import { searchFinderPlayers, searchPlayers } from '@/lib/core-app/playerFinder'

describe('teamCodesForQuery — "Bills", "Buffalo", "BUF" all mean the Bills', () => {
  it('matches a nickname, a city, the full name and the code, any case', () => {
    for (const q of ['Bills', 'bills', 'Buffalo', 'Buffalo Bills', 'BUF', 'buf', 'Bill']) {
      expect(teamCodesForQuery(q, 'NFL'), q).toEqual(['BUF'])
    }
  })

  it('a shared city names both of its teams', () => {
    expect(teamCodesForQuery('New York', 'NFL').sort()).toEqual(['NYG', 'NYJ'])
  })

  it('a player name is not a team', () => {
    expect(teamCodesForQuery('Josh Allen', 'NFL')).toEqual([])
    expect(teamCodesForQuery('Kincaid', 'NFL')).toEqual([])
    // Too short to start-match a nickname: "Be" is not the Bears and the Bengals.
    expect(teamCodesForQuery('Be', 'NFL')).toEqual([])
  })

  it('an old code finds the team, but only its current codes are searched', () => {
    const codes = teamCodesForQuery('OAK', 'NFL')
    expect(codes).toContain('LV')
    expect(codes).not.toContain('OAK')
  })

  it('other sports try a short query as a team code as it stands', () => {
    expect(teamCodesForQuery('lal', 'NBA')).toEqual(['LAL'])
    expect(teamCodesForQuery('Lakers', 'NBA')).toEqual([])
  })
})

describe('finderPlayerHref — where an injury alert lands', () => {
  it('an NFL player with a Sleeper id opens his card, which lists every league he is in', () => {
    expect(finderPlayerHref({ sport: 'NFL', sleeperId: '6794', name: 'Justin Jefferson' })).toBe(
      '/core/players?q=Justin%20Jefferson&player=NFL~sleeper%3A6794',
    )
  })

  it('another sport never uses the Sleeper id as a catalog ref — it would open nobody', () => {
    expect(finderPlayerHref({ sport: 'NBA', sleeperId: '123', name: 'Jalen Brunson' })).toBe('/core/players?q=Jalen%20Brunson&sport=NBA')
  })

  it('a catalog id and its source open him exactly, in any sport', () => {
    expect(finderPlayerHref({ sport: 'NBA', externalId: '55', source: 'rolling_insights', name: 'Jalen Brunson' })).toBe(
      '/core/players?q=Jalen%20Brunson&player=NBA~rolling_insights%3A55&sport=NBA',
    )
  })

  it('with nothing to go on it still lands on the finder', () => {
    expect(finderPlayerHref({})).toBe('/core/players')
    expect(finderTeamHref('BUF', 'NFL')).toBe('/core/players?q=BUF')
    expect(finderTeamHref('LAL', 'nba')).toBe('/core/players?q=LAL&sport=NBA')
  })
})

describe('leagueCountOf', () => {
  it('splits your leagues into starting and not starting', () => {
    expect(leagueCountOf({ yours: 5, of: 6, starting: 1, others: 2 })).toEqual({ yours: 5, of: 6, starting: 1, benched: 4, others: 2 })
  })
  it('never counts more starts than leagues', () => {
    expect(leagueCountOf({ yours: 2, of: 6, starting: 5, others: 0 }).benched).toBe(0)
  })
})

describe('searchFinderPlayers — by name, then by team', () => {
  const row = (externalId: string, name: string, position: string, team: string | null) => ({
    externalId, sleeperId: externalId, name, position, team, imageUrl: null, number: null, sport: 'NFL', source: 'sleeper',
  })
  beforeEach(() => {
    prismaMock.sportsPlayer.findMany.mockReset()
    prismaMock.sportsPlayer.findMany.mockImplementation(async (args?: unknown) => {
      const where = (args as { where: { team?: { in: string[] }; name?: unknown } }).where
      if (where.team) {
        return where.team.in.includes('BUF')
          ? [row('3', 'Dalton Kincaid', 'TE', 'BUF'), row('1', 'Josh Allen', 'QB', 'BUF'), row('2', 'James Cook', 'RB', 'BUF')]
          : []
      }
      return []
    })
  })

  it('"Bills" lists the Bills in position order, QB first', async () => {
    const out = await searchFinderPlayers('Bills', 12, 'NFL')
    expect(out.map((m) => m.name)).toEqual(['Josh Allen', 'James Cook', 'Dalton Kincaid'])
    const teamCall = prismaMock.sportsPlayer.findMany.mock.calls.find((c) => (c[0] as { where: { team?: unknown } }).where.team)
    expect((teamCall![0] as { where: { team: { in: string[] }; sport: string } }).where).toMatchObject({ team: { in: ['BUF'] }, sport: 'NFL' })
  })

  it('a name search asks for no team at all', async () => {
    await searchFinderPlayers('Kincaid', 12, 'NFL')
    expect(prismaMock.sportsPlayer.findMany.mock.calls.every((c) => !(c[0] as { where: { team?: unknown } }).where.team)).toBe(true)
  })

  it('the shared searchPlayers (Chimmy, AI context) does not expand a team', async () => {
    const out = await searchPlayers('Bills', 12, 'NFL')
    expect(out).toEqual([])
  })
})
