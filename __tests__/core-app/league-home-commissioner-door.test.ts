// @vitest-environment node
/**
 * The league Overview's commissioner card opens the per-league Commissioner Hub in /core — the same
 * page the left nav's "Commissioner" opens for this league.
 *
 * 🛑 WHAT WAS WRONG. It opened `/league/<id>/intelligence`, so one league had two commissioner doors
 * to two different pages, and that page shows its console only to `League.userId`: a
 * co-commissioner, exactly who this card is shown to, landed on it without the console.
 *
 * Driven through `getLeagueHomeData` itself, with a permissive Prisma double, so the assertion is
 * on the href the screen actually receives.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ answers: {} as Record<string, (args: unknown) => unknown> }))

vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) =>
    method === 'count' ? 0 : method === 'findMany' || method.startsWith('$query') ? [] : null
  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async (args: unknown) => {
            const answer = db.answers[`${model}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key.startsWith('$query') || key.startsWith('$execute')) return vi.fn(async () => [])
        if (key === '$transaction') return vi.fn(async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : null))
        if (key === 'then') return undefined
        return modelProxy(key)
      },
    },
  )
  return { prisma, default: prisma }
})

vi.mock('@/lib/commissioner-hub/managerHealth', () => ({
  getLeagueManagerHealth: vi.fn(async () => ({
    totalManagers: 2,
    inactiveCount: 1,
    atRiskCount: 0,
    rows: [
      { teamName: 'Mine', managerName: 'me', status: 'active' },
      { teamName: 'Theirs', managerName: 'them', status: 'inactive' },
    ],
  })),
}))

import { getLeagueHomeData } from '@/lib/core-app/leagueHome'

const L = 'league/with space'
const U = 'user-1'

function context(flags: { isCommissioner: boolean; isCoCommissioner: boolean }) {
  db.answers['leagueTeam.findMany'] = () => [
    { externalId: '1', teamName: 'Mine', ownerName: 'me', claimedByUserId: U, platformUserId: 'p1', wins: 0, losses: 0, ties: 0, pointsFor: 0, currentRank: 1, ...flags },
    { externalId: '2', teamName: 'Theirs', ownerName: 'them', claimedByUserId: null, platformUserId: 'p2', wins: 0, losses: 0, ties: 0, pointsFor: 0, currentRank: 2, isCommissioner: false, isCoCommissioner: false },
  ]
  return {
    leagueId: L,
    userId: U,
    league: vi.fn(async () => ({
      id: L,
      name: 'Kings',
      platform: 'sleeper',
      platformLeagueId: 'sl-1',
      sport: 'NFL',
      season: 2026,
      status: 'in_season',
      settings: {},
      leagueSize: 2,
    })),
    claimedTeam: vi.fn(async () => ({ externalId: '1', teamName: 'Mine' })),
    claimedTeams: vi.fn(async () => [{ externalId: '1' }]),
  }
}

beforeEach(() => {
  db.answers = {}
})

describe('the Overview commissioner card', () => {
  it('opens this league’s Commissioner Hub in /core for a co-commissioner', { timeout: 60_000 }, async () => {
    const data = await getLeagueHomeData(L, U, null, context({ isCommissioner: false, isCoCommissioner: true }) as never)
    const section = (data as unknown as { commissioner: { available: boolean; data?: { href: string } } }).commissioner

    expect(section.available).toBe(true)
    expect(section.data?.href).toBe('/core/commissioner?league=league%2Fwith%20space')
  })

  it('is absent for a manager who is not a commissioner (positive control for the fixture)', { timeout: 60_000 }, async () => {
    const data = await getLeagueHomeData(L, U, null, context({ isCommissioner: false, isCoCommissioner: false }) as never)
    const section = (data as unknown as { commissioner: { available: boolean } }).commissioner

    expect(section.available).toBe(false)
  })
})
