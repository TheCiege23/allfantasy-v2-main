/**
 * A native league's standings reach the rows the league page reads.
 *
 * The season engine kept records on `RedraftRoster` only, so the league page — which reads
 * `LeagueTeam` — showed every team 0-0 all season (measured: 14 weeks played, 70-70 on the
 * season rosters, 0-0 on every LeagueTeam). `updateStandings` now copies each record across,
 * following LeagueTeam.externalId = Roster.id and Roster.platformUserId = RedraftRoster.ownerId.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  platform: 'allfantasy' as string,
  teamWrites: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  failTeamWrite: false,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRoster: {
      findMany: vi.fn(async () => [
        { id: 'rr-a', ownerId: 'user-a' },
        { id: 'rr-b', ownerId: 'open-slot-L1-2' },
      ]),
      update: vi.fn(async () => ({})),
    },
    redraftMatchup: {
      findMany: vi.fn(async () => [
        { id: 'm1', week: 1, homeRosterId: 'rr-a', awayRosterId: 'rr-b', homeScore: 120.456, awayScore: 90, status: 'final' },
      ]),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    redraftSeason: {
      findUnique: vi.fn(async () => ({ leagueId: 'L1', medianGame: false, league: { medianGame: false } })),
    },
    league: { findFirst: vi.fn(async () => ({ platform: h.platform })) },
    roster: {
      findMany: vi.fn(async () => [
        { id: 'roster-a', platformUserId: 'user-a' },
        { id: 'roster-b', platformUserId: 'open-slot-L1-2' },
      ]),
    },
    leagueTeam: {
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (h.failTeamWrite) throw new Error('db down')
        h.teamWrites.push(args)
        return { count: 1 }
      }),
    },
  },
}))
vi.mock('@/lib/events', () => ({
  getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }),
  EVENT: { STANDINGS_UPDATED: 'standings.updated' },
}))

import { updateStandings } from '@/lib/redraft/standingsEngine'

beforeEach(() => {
  h.platform = 'allfantasy'
  h.teamWrites = []
  h.failTeamWrite = false
})

describe('standings mirror onto LeagueTeam', () => {
  it('a native league\'s LeagueTeam rows carry the season record, keyed by the generic roster id', async () => {
    await updateStandings('season-1', 1)
    const a = h.teamWrites.find((w) => w.where.externalId === 'roster-a')!
    const b = h.teamWrites.find((w) => w.where.externalId === 'roster-b')!
    expect(a.where).toEqual({ leagueId: 'L1', externalId: 'roster-a' })
    expect(a.data).toMatchObject({ wins: 1, losses: 0, ties: 0, pointsFor: 120.46, pointsAgainst: 90, currentRank: 1 })
    expect(b.data).toMatchObject({ wins: 0, losses: 1, pointsFor: 90, pointsAgainst: 120.46, currentRank: 2 })
  })

  it('leaves an imported league alone — its provider sync owns those columns', async () => {
    h.platform = 'sleeper'
    await updateStandings('season-1', 1)
    expect(h.teamWrites).toEqual([])
  })

  it('a failed mirror never costs the standings themselves', async () => {
    h.failTeamWrite = true
    const res = await updateStandings('season-1', 1)
    expect(res.rostersUpdated).toBe(2)
    expect(res.matchupsCounted).toBe(1)
  })
})
