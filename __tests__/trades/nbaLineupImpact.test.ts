import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rosterFindMany, redraftPlayersFindMany, identityFindMany, seasonFindMany, gameFindMany } = vi.hoisted(() => ({
  rosterFindMany: vi.fn(), redraftPlayersFindMany: vi.fn(), identityFindMany: vi.fn(),
  seasonFindMany: vi.fn(), gameFindMany: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  roster: { findMany: rosterFindMany },
  redraftRosterPlayer: { findMany: redraftPlayersFindMany },
  playerIdentityMap: { findMany: identityFindMany },
  playerSeasonStats: { findMany: seasonFindMany },
  playerGameStat: { findMany: gameFindMany },
} }))

import { bestNbaLineup, loadNbaLineupImpact } from '@/lib/trades/nbaLineupImpact'
import type { TradeLeagueContext } from '@/lib/trades/loadTradeLeagueContext'
import type { NbaPricedPlayer } from '@/lib/trades/nbaPointsTradeEvaluation'

const player = (id: string, position: string, pointsPerGame: number) => ({ playerId: id, name: id, position, pointsPerGame })
const priced = (id: string, pointsPerGame: number): NbaPricedPlayer => ({
  name: id, playerId: id, pointsPerGame, currentSeason: '2025-2026', currentPointsPerGame: pointsPerGame,
  previousPointsPerGame: null, recentFivePointsPerGame: null, seasonGames: 10,
  source: 'test', sourceFetchedAt: null,
})
const league = {
  leagueId: 'league', platform: 'fantrax', starterSlots: { PG: 1, G: 1 }, scoringRules: { points: 1 },
  teams: [
    { id: 'team-a', externalId: 'a', name: 'A', claimedByUserId: 'same-user' },
    { id: 'team-b', externalId: 'b', name: 'B', claimedByUserId: 'same-user' },
  ],
} as TradeLeagueContext

describe('NBA roster lineup impact', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gameFindMany.mockResolvedValue([])
    redraftPlayersFindMany.mockResolvedValue([])
    identityFindMany.mockImplementation(async ({ where }: any) => {
      const ids = where.OR?.[0]?.id?.in ?? where.id?.in ??
        (where.OR?.[0]?.canonicalName?.equals ? [where.OR[0].canonicalName.equals] : [])
      return ids.map((id: string) => ({
        id, canonicalName: id, position: id.startsWith('pg') ? 'PG' : 'SG',
        sleeperId: null, rollingInsightsId: null, espnId: null, fantraxId: null,
      }))
    })
    seasonFindMany.mockImplementation(async ({ where }: any) => [{
      season: '2025-2026', gamesPlayed: 10, stats: { points: where.playerId.in[0] === 'pg-a' ? 300 :
        where.playerId.in[0] === 'sg-a' ? 100 : where.playerId.in[0] === 'pg-b' ? 250 : 200 },
      source: 'test', fetchedAt: new Date('2026-01-01'),
    }])
  })

  it('optimizes overlapping PG and G slots exactly', () => {
    expect(bestNbaLineup([player('combo', 'PG/SG', 40), player('pg', 'PG', 30), player('sg', 'SG', 20)],
      { PG: 1, G: 1 })).toBe(70)
    expect(bestNbaLineup([player('sf', 'SF', 50)], { PG: 1 })).toBe(0)
    expect(bestNbaLineup([player('sf', 'SF', 50)], { MYSTERY: 1 })).toBeNull()
  })

  it('keeps two Fantrax teams owned by one account separate by source team id', async () => {
    rosterFindMany.mockResolvedValue([
      { id: 'roster-a', playerData: { source_team_id: 'a', players: ['pg-a', 'sg-a'] }, redraftRosterId: null },
      { id: 'roster-b', playerData: { source_team_id: 'b', players: ['pg-b', 'sg-b'] }, redraftRosterId: null },
    ])
    const impact = await loadNbaLineupImpact({
      league, senderTeamId: 'team-a', receiverTeamId: 'team-b',
      senderGives: [priced('sg-a', 10)], receiverGives: [priced('sg-b', 20)],
    })
    expect(impact).toMatchObject({ status: 'verified', sender: { teamId: 'team-a', before: 40, after: 50, delta: 10 },
      receiver: { teamId: 'team-b', before: 45, after: 35, delta: -10 } })
  })

  it('does not infer ownership from the shared manager when a team roster is missing', async () => {
    rosterFindMany.mockResolvedValue([
      { id: 'roster-a', playerData: { source_team_id: 'a', players: ['pg-a', 'sg-a'] }, redraftRosterId: null },
    ])
    const impact = await loadNbaLineupImpact({
      league, senderTeamId: 'team-a', receiverTeamId: 'team-b',
      senderGives: [priced('sg-a', 10)], receiverGives: [priced('sg-b', 20)],
    })
    expect(impact).toMatchObject({ status: 'unavailable', reason: 'A selected team has no unique stored roster.' })
  })

  it('reads native teams through their explicit roster ids and linked scoring rosters', async () => {
    const nativeLeague = { ...league, platform: 'native', teams: [
      { ...league.teams[0], externalId: 'roster-a' },
      { ...league.teams[1], externalId: 'roster-b' },
    ] }
    rosterFindMany.mockResolvedValue([
      { id: 'roster-a', playerData: {}, redraftRosterId: 'redraft-a' },
      { id: 'roster-b', playerData: {}, redraftRosterId: 'redraft-b' },
    ])
    redraftPlayersFindMany.mockImplementation(async ({ where }: any) =>
      (where.rosterId === 'redraft-a' ? ['pg-a', 'sg-a'] : ['pg-b', 'sg-b'])
        .map((playerId) => ({ playerId })))
    const impact = await loadNbaLineupImpact({
      league: nativeLeague, senderTeamId: 'team-a', receiverTeamId: 'team-b',
      senderGives: [priced('sg-a', 10)], receiverGives: [priced('sg-b', 20)],
    })
    expect(impact).toMatchObject({ status: 'verified', sender: { delta: 10 }, receiver: { delta: -10 } })
  })
})
