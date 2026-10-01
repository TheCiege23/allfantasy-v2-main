// @vitest-environment node
/**
 * /core/career?league= for an AllFantasy-native league — fixtures from `redraft_matchups`, owner
 * from `RedraftRoster.ownerId` (see `readNativeFixtures` in `leagueCareer.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  calls: [] as Array<{ model: string; method: string; args: unknown }>,
  answers: {} as Record<string, (args: unknown) => unknown>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) => (method === 'count' ? 0 : method === 'findMany' ? [] : null)
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async (args: unknown) => {
            db.calls.push({ model: name, method, args })
            const answer = db.answers[`${name}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key.startsWith('$')) return vi.fn(async () => [])
        if (key === 'then') return undefined
        return model(key)
      },
    },
  )
  return { prisma, default: prisma }
})

import { getLeagueCareer } from '@/lib/core-app/leagueCareer'
import type { LeagueContext } from '@/lib/core-app/leagueContext'

const L = 'native-1'
const ME = 'user-me'

const ctx = (): LeagueContext =>
  ({
    leagueId: L,
    userId: ME,
    league: vi.fn(async () => ({
      id: L,
      name: 'AF Natives',
      platform: 'manual',
      platformLeagueId: '',
      sport: 'NFL',
      season: 2026,
      status: 'setup',
      settings: {},
      leagueType: 'redraft',
      leagueVariant: null,
      isDynasty: false,
      guillotineMode: false,
      bestBallMode: false,
    })),
    claimedTeam: vi.fn(async () => null),
    claimedTeams: vi.fn(async () => []),
  }) as unknown as LeagueContext

const rosters = [
  { id: 'r-me', ownerId: ME, ownerName: 'me', teamName: 'My Squad' },
  { id: 'r-a', ownerId: 'open-slot-1', ownerName: 'Open slot', teamName: 'Bot A' },
  { id: 'r-b', ownerId: 'orphan-2', ownerName: 'Orphan', teamName: 'Bot B' },
]
const game = (week: number, home: string, away: string | null, hs: number, as: number) => ({
  week,
  homeRosterId: home,
  awayRosterId: away,
  homeScore: hs,
  awayScore: as,
  season: { season: 2026 },
})

beforeEach(() => {
  db.calls = []
  db.answers = {
    'redraftRoster.findMany': () => rosters,
    'redraftMatchup.findMany': () => [
      game(1, 'r-me', 'r-a', 120, 100), // W
      game(2, 'r-b', 'r-me', 130, 90), // L
      game(3, 'r-me', 'r-b', 80, 95), // L
      game(3, 'r-a', 'r-b', 10, 20), // not mine
    ],
  }
})

describe('getLeagueCareer — AllFantasy-native league', () => {
  it('builds the head-to-head career from final redraft matchups, owner by ownerId', async () => {
    const result = await getLeagueCareer(L, ME, ctx())
    expect(result.available).toBe(true)
    if (!result.available || result.mode === 'weekly') throw new Error('expected a head-to-head career')
    expect(result.seasons).toEqual([
      { season: 2026, wins: 1, losses: 2, pointsFor: 290, pointsAgainst: 325, games: 3 },
    ])
    expect(result.totals).toMatchObject({ wins: 1, losses: 2, games: 3 })
    expect(result.toughestRival).toMatchObject({ name: 'Bot B', wins: 0, losses: 2, meetings: 2 })
  })

  it('asks only for final, non-median games against a real opponent', async () => {
    await getLeagueCareer(L, ME, ctx())
    const read = db.calls.find((c) => c.model === 'redraftMatchup' && c.method === 'findMany')
    expect((read?.args as { where: unknown }).where).toEqual({
      leagueId: L,
      status: 'final',
      isMedianMatchup: false,
      awayRosterId: { not: null },
    })
  })

  it('is not "your team" for someone with no roster in the league', async () => {
    const result = await getLeagueCareer(L, 'someone-else', { ...ctx(), userId: 'someone-else' } as LeagueContext)
    expect(result.available).toBe(false)
    if (result.available) return
    expect(result.reason).toMatch(/which team in this league is yours/)
  })

  it('a native league with no final games yet says it has not played, not that history is missing', async () => {
    db.answers['redraftMatchup.findMany'] = () => []
    const result = await getLeagueCareer(L, ME, ctx())
    expect(result.available).toBe(false)
    if (result.available) return
    expect(result.reason).toMatch(/not played a week yet/)
  })

  it('never reads native fixtures for a league the warehouse already covers', async () => {
    db.answers['matchupFact.findMany'] = () => [
      { season: 2025, weekOrPeriod: 1, teamA: '1', teamB: '2', scoreA: 100, scoreB: 90, winnerTeamId: '1' },
    ]
    await getLeagueCareer(L, ME, ctx())
    expect(db.calls.some((c) => c.model === 'redraftMatchup')).toBe(false)
  })
})
