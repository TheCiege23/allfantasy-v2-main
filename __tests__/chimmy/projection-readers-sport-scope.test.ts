// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 TWO MORE `fantasy_projections` READERS NEVER HAND A NON-NFL LEAGUE AN NFL ROW.
 *
 * The feed is NFL rows keyed by Sleeper id. A Sleeper NBA league's ids come from Sleeper's NBA
 * namespace, numbered independently of the NFL one, so an id — or a name — can match an NFL player.
 *
 *   - Chimmy's waiver-scenario free-agent search (`findWeekPlayersByName`) searched the week's feed by
 *     name with no sport. Today `leagueWeekBasis` refuses a non-NFL league before it runs; this keeps
 *     the reader honest on its own.
 *   - The trade sim's real-schedule delta (`computeGroundedTradeDelta`) read every row of the week and
 *     priced the league's starters from it by id.
 *
 * The prisma double honours a `sport` filter when the caller sends one, as Postgres would, and ignores
 * it when the caller does not — so an unscoped read is exactly what lets the NFL row in.
 */
const h = vi.hoisted(() => ({
  sport: 'NBA' as string,
  projectionFind: vi.fn(),
}))

const NFL_ROW = {
  playerId: '2002',
  week: 5,
  sport: 'NFL',
  stats: { name: 'Shared Namesake', position: 'RB', stats: { rush_yd: 100 } },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantasyProjection: { findMany: h.projectionFind },
    league: {
      findUnique: vi.fn(async () => ({
        id: 'L', platformLeagueId: 'P', settings: { scoring_settings: { rush_yd: 0.1 } }, sport: h.sport,
      })),
    },
    leagueTeam: {
      findFirst: vi.fn(async () => ({ externalId: '1', platformUserId: 'u1' })),
      findMany: vi.fn(async () => [
        { externalId: '1', platformUserId: 'u1' },
        { externalId: '2', platformUserId: 'u2' },
      ]),
    },
    weeklyMatchup: {
      findFirst: vi.fn(async () => ({ seasonYear: 2026 })),
      findMany: vi.fn(async () => [
        { week: 5, rosterId: '1', matchupId: 1, pointsFor: 0, pointsAgainst: 0 },
        { week: 5, rosterId: '2', matchupId: 1, pointsFor: 0, pointsAgainst: 0 },
      ]),
    },
    roster: {
      findMany: vi.fn(async () => [
        { platformUserId: 'u1', playerData: { starters: ['2002'] } },
        { platformUserId: 'u2', playerData: { starters: ['2002'] } },
      ]),
    },
  },
}))

import { computeGroundedTradeDelta } from '@/lib/ai/sim/groundedTradeDelta'
import { findWeekPlayersByName } from '@/lib/chimmy/lineupScenarioGrounding'

beforeEach(() => {
  h.sport = 'NBA'
  h.projectionFind.mockReset().mockImplementation(async (args: { where: { sport?: string } }) =>
    args.where.sport == null || args.where.sport === 'NFL' ? [NFL_ROW] : [],
  )
})

describe("Chimmy's free-agent search by name", () => {
  const WEEK = { season: '2026', week: 5 }

  it('🛑 a non-NFL league is never offered the NFL namesake', async () => {
    const found = await findWeekPlayersByName({ week: WEEK, name: 'Shared Namesake', sport: 'NBA' })
    expect(found.players).toEqual([])
    expect(h.projectionFind.mock.calls[0]![0].where.sport).toBe('NBA')
  })

  it('control: an NFL league, or no sport, finds him with the read it always sent', async () => {
    expect((await findWeekPlayersByName({ week: WEEK, name: 'Shared Namesake', sport: 'NFL' })).players).toHaveLength(1)
    expect((await findWeekPlayersByName({ week: WEEK, name: 'Shared Namesake' })).players).toHaveLength(1)
    for (const [args] of h.projectionFind.mock.calls) {
      expect(args.where).toEqual({ season: '2026', week: 5, source: { not: 'allfantasy' } })
    }
  })
})

describe("the trade sim's real-schedule delta", () => {
  const run = () => computeGroundedTradeDelta({ leagueId: 'L', userId: 'u1', sent: [], received: [] })

  it('🛑 a non-NFL league never prices its starters from the NFL row sharing their id', async () => {
    const out = await run()
    expect(out.available).toBe(false)
    expect((out as { reason: string }).reason).toMatch(/projection feed holds nothing/)
    expect(h.projectionFind.mock.calls[0]![0].where.sport).toBe('NBA')
  })

  it('control: an NFL league prices them with the read it always sent', async () => {
    h.sport = 'NFL'
    const out = await run()
    expect(out.available).toBe(true)
    expect(h.projectionFind.mock.calls[0]![0].where).toEqual({ season: '2026', week: { in: [5] } })
  })
})
