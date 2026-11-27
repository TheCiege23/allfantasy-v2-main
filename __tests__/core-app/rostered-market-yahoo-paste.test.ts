/**
 * @vitest-environment node
 *
 * Own % / start % over AllFantasy's rosters — and a PASTED Yahoo league (declaredAvailability.ts).
 *
 * Matched players are stored `sleeper:<id>`, the unmatched as `yahoo-paste:<name>|<pos>|<team>`. Above
 * the 80% coverage bar the league counts, read through its declared ids; below it the league is left
 * out of the denominator — counted, it would read players as unowned who are owned — and the board says
 * how many were left out. A Yahoo league with no declared id stays uncounted, as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagues: [] as Array<{ id: string; platform: string; sport: string }>,
  rosters: [] as Array<{ leagueId: string; playerData: unknown }>,
}))

vi.mock('next/cache', () => ({ unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: vi.fn(async () => h.leagues) },
    roster: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: { in: string[] } } }) => h.rosters.filter((r) => where.leagueId.in.includes(r.leagueId))),
    },
  },
}))

import { getRosteredMarket } from '@/lib/core-app/rosteredMarket'

const declared = (n: number) => Array.from({ length: n }, (_, i) => `sleeper:${100 + i}`)

beforeEach(() => {
  h.leagues = [
    { id: 'S1', platform: 'sleeper', sport: 'NFL' },
    { id: 'Y1', platform: 'yahoo', sport: 'NFL' },
  ]
  h.rosters = [
    { leagueId: 'S1', playerData: { players: ['4046'], starters: ['4046'] } },
    // 9 of 10 declared: above the bar. He is started there.
    { leagueId: 'Y1', playerData: { players: ['sleeper:4046', ...declared(8), 'yahoo-paste:some guy|WR|KC'], starters: ['sleeper:4046'] } },
  ]
})

describe('getRosteredMarket — a pasted Yahoo league', () => {
  it('above the bar: the league counts, read through its declared Sleeper ids', async () => {
    const board = await getRosteredMarket({ sport: 'NFL' })
    expect(board.leaguesCounted).toBe(2)
    expect(board.leaguesUnverified).toBe(0)
    expect(board.byPlayerId.get('4046')).toMatchObject({ rosteredIn: 2, startedIn: 2, ownPct: 1 })
  })

  it('🛑 the unmatched pasted player is never counted as anyone, owned or free', async () => {
    const board = await getRosteredMarket({ sport: 'NFL' })
    expect([...board.byPlayerId.keys()].some((id) => id.includes('yahoo-paste') || id.startsWith('sleeper:'))).toBe(false)
  })

  it('below the bar: the league is left out of the denominator, and the board says so', async () => {
    h.rosters[1] = { leagueId: 'Y1', playerData: { players: ['sleeper:4046', 'yahoo-paste:a|WR|KC', 'yahoo-paste:b|RB|KC'], starters: [] } }
    const board = await getRosteredMarket({ sport: 'NFL' })
    expect(board.leaguesCounted).toBe(1)
    expect(board.leaguesUnverified).toBe(1)
    expect(board.byPlayerId.get('4046')).toMatchObject({ rosteredIn: 1, ownPct: 1 })
  })

  it('CONTROL: a Yahoo league with no declared id is uncounted and not called unverified', async () => {
    h.rosters[1] = { leagueId: 'Y1', playerData: { players: ['4046', '6038'] } }
    const board = await getRosteredMarket({ sport: 'NFL' })
    expect(board.leaguesCounted).toBe(1)
    expect(board.leaguesUnverified).toBe(0)
  })
})
