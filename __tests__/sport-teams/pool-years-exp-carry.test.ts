// @vitest-environment node
/**
 * Phase 3.2 — the league player pool carries `SportsPlayer.yearsExp` as `experience`, for every sport.
 * It used to select no experience column and hard-code `experience: null`, so no non-NFL draft pool
 * row could ever reach the "yearsExp 0 is a rookie" rule the NFL path relies on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  players: [] as Array<Record<string, unknown>>,
  selects: [] as unknown[],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: vi.fn(async (args: { select?: unknown }) => {
        h.selects.push(args?.select)
        return h.players
      }),
    },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
    sportsInjury: { findMany: vi.fn(async () => []) },
  },
}))

function row(id: string, name: string, team: string, source: string, yearsExp: number | null) {
  return { id, name, position: 'SG', team, teamId: null, status: null, sleeperId: null, externalId: `${source}:${id}`, age: 20, imageUrl: null, source, yearsExp }
}

beforeEach(() => {
  vi.resetModules() // the pool is memoised in-process
  h.selects = []
  h.players = [
    row('a1', 'Example Rookie', 'SAS', 'rolling_insights', null),
    row('a2', 'Example Rookie', 'SAS', 'sleeper', 0), // the duplicate that knows his experience
    row('b1', 'Example Veteran', 'BOS', 'rolling_insights', 7),
    row('c1', 'Example Unknown', 'DEN', 'rolling_insights', null),
    row('d1', 'Example Conflict', 'LAL', 'rolling_insights', 0),
    row('d2', 'Example Conflict', 'LAL', 'sleeper', 2),
  ]
})

describe('getPlayerPoolForSport — experience from SportsPlayer.yearsExp', () => {
  it('selects yearsExp and carries it onto the deduplicated NBA row, unknown and conflicts as null', async () => {
    const { getPlayerPoolForSport } = await import('@/lib/sport-teams/SportPlayerPoolResolver')
    const pool = await getPlayerPoolForSport('NBA', { limit: 50 })
    expect(h.selects.some((s) => (s as Record<string, unknown> | undefined)?.yearsExp === true)).toBe(true)
    const byName = Object.fromEntries(pool.map((p) => [p.full_name, p.experience]))
    expect(byName).toEqual({
      'Example Rookie': 0,
      'Example Veteran': 7,
      'Example Unknown': null,
      'Example Conflict': null,
    })
  })
})
