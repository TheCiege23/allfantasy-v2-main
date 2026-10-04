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
    teamWeekResult: {findMany:vi.fn()},
    fantasyStanding: {upsert:vi.fn()},
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

it('native each-category standings count categories rather than a single matchup win',async()=>{
 const {prisma}=await import('@/lib/prisma')
 vi.mocked(prisma.redraftMatchup.findMany).mockResolvedValueOnce([{id:'m1',week:1,homeRosterId:'rr-a',awayRosterId:'rr-b',homeScore:6,awayScore:3,status:'final',lineupSnapshots:{categoryRecordMode:'each',categoryMatchup:{aWins:6,bWins:3,ties:1}}}] as never)
 await updateStandings('season-1',1)
 expect(h.teamWrites.map(w=>w.data)).toEqual(expect.arrayContaining([expect.objectContaining({wins:6,losses:3,ties:1}),expect.objectContaining({wins:3,losses:6,ties:1})]))
})

it('ranks native roto from cumulative stat components, with no head-to-head record',async()=>{
 const {prisma}=await import('@/lib/prisma')
 vi.mocked(prisma.redraftMatchup.findMany).mockResolvedValueOnce([])
 vi.mocked(prisma.redraftSeason.findUnique).mockResolvedValue({leagueId:'L1',season:2027,league:{settings:{scoring_mode:'roto',category_preset_id:'mlb_5x5'}}} as never)
 vi.mocked(prisma.league.findFirst).mockResolvedValue({platform:'allfantasy',settings:{scoring_mode:'roto'}} as never)
 vi.mocked(prisma.roster.findMany).mockResolvedValue([{id:'roster-a',platformUserId:'user-a',redraftRosterId:'rr-a'},{id:'roster-b',platformUserId:'open-slot-L1-2',redraftRosterId:'rr-b'}] as never)
 vi.mocked(prisma.teamWeekResult.findMany).mockResolvedValue([
  {rosterId:'roster-a',week:1,categoryBreakdown:{teamStats:{h:1,ab:2,hr:2,r:3,rbi:3,sb:2,outs:18,er:1,p_h:2,p_bb:1,so:10,w:1,sv:1}}},
  {rosterId:'roster-a',week:2,categoryBreakdown:{teamStats:{h:1,ab:8}}},
  {rosterId:'roster-b',week:1,categoryBreakdown:{teamStats:{h:3,ab:10,hr:1,r:1,rbi:1,sb:1,outs:18,er:3,p_h:4,p_bb:1,so:6,w:0,sv:0}}},
 ] as never)
 await updateStandings('season-1',2)
 expect(h.teamWrites.map(w=>w.data)).toEqual(expect.arrayContaining([expect.objectContaining({wins:0,losses:0,ties:0,pointsFor:19}),expect.objectContaining({wins:0,losses:0,ties:0,pointsFor:11})]))
 expect(prisma.fantasyStanding.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({leagueId:'L1',season:2027,rosterId:'roster-a',pointsFor:19,rank:1})}))
})
