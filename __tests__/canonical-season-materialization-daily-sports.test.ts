/**
 * An imported NHL or MLB league got no `RedraftSeason` at all — the gate admitted NFL, NCAAF and NBA —
 * so it had no season rosters: nothing for lineups, scoring, waivers, or the standings Chimmy reads.
 * Found by the Fantrax-scale simulation (2026-11-07) at 32, 128 and 256 teams.
 *
 * And a league whose provider names no playoff week took week 15, a football number: a 14-week NBA,
 * NHL or MLB season. Those sports now take their own season shape (`dailySportSeasonShape.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  teamFindMany: vi.fn(),
  seasonFindUnique: vi.fn(),
  seasonCreate: vi.fn(),
  rosterCreate: vi.fn(),
  reconcile: vi.fn(),
  materializePlayers: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    leagueTeam: { findMany: mocks.teamFindMany },
    redraftSeason: { findUnique: mocks.seasonFindUnique, create: mocks.seasonCreate },
    redraftRoster: { create: mocks.rosterCreate },
  },
}))
vi.mock('@/lib/league-runtime/reconcileRosterRedraftLinks', () => ({ reconcileRosterRedraftLinks: mocks.reconcile }))
vi.mock('@/lib/league-runtime/materializeRedraftRosterPlayers', () => ({ materializeRedraftRosterPlayersForLeague: mocks.materializePlayers }))

import { materializeRedraftSeasonForImportedLeague } from '@/lib/league-import/canonicalSeasonMaterialization'
import { playoffStartWeekFor } from '@/lib/sportConfig/dailySportSeasonShape'

const league = (sport: string, playoffStartWeek: number | null) => ({ id: `${sport}-league`, sport, season: 2026, status: 'in_season', playoffStartWeek })
const createdSeason = () => mocks.seasonCreate.mock.calls[0]?.[0]?.data

beforeEach(() => {
  vi.clearAllMocks()
  mocks.seasonFindUnique.mockResolvedValue(null)
  mocks.teamFindMany.mockResolvedValue([
    { id: 'team-1', platformUserId: 'fantrax-user:a', ownerName: 'A', teamName: 'Team 001', avatarUrl: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, currentRank: 1 },
    { id: 'team-2', platformUserId: 'fantrax-manager:b', ownerName: 'B', teamName: 'Team 002', avatarUrl: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, currentRank: 2 },
  ])
  mocks.seasonCreate.mockResolvedValue({ id: 'season' })
  mocks.rosterCreate.mockResolvedValue({ id: 'roster' })
  mocks.reconcile.mockResolvedValue(undefined)
  mocks.materializePlayers.mockResolvedValue(undefined)
})

describe('imported NHL and MLB leagues get a season', () => {
  it.each(['NHL', 'MLB'])('%s: the season, both season rosters, the roster links and the players', async (sport) => {
    mocks.leagueFindUnique.mockResolvedValue(league(sport, 25))
    const result = await materializeRedraftSeasonForImportedLeague(`${sport}-league`)
    expect(result).toMatchObject({ seasonId: 'season', created: true, rosterCount: 2 })
    expect(createdSeason()).toMatchObject({ leagueId: `${sport}-league`, sport, playoffStartWeek: 25, totalWeeks: 24 })
    expect(mocks.rosterCreate).toHaveBeenCalledTimes(2)
    expect(mocks.reconcile).toHaveBeenCalledWith(`${sport}-league`)
    expect(mocks.materializePlayers).toHaveBeenCalledWith(`${sport}-league`, { sport })
  })
})

describe('the playoff week when the provider names none', () => {
  it.each(['NBA', 'NHL', 'MLB'] as const)('%s takes its own season shape, not football week 15', async (sport) => {
    mocks.leagueFindUnique.mockResolvedValue(league(sport, null))
    await materializeRedraftSeasonForImportedLeague(`${sport}-league`)
    expect(playoffStartWeekFor(sport)).toBeGreaterThan(15)
    expect(createdSeason()).toMatchObject({ playoffStartWeek: playoffStartWeekFor(sport), totalWeeks: playoffStartWeekFor(sport) - 1 })
  })

  it.each(['NFL', 'NCAAF'])('%s keeps week 15', async (sport) => {
    mocks.leagueFindUnique.mockResolvedValue(league(sport, null))
    await materializeRedraftSeasonForImportedLeague(`${sport}-league`)
    expect(createdSeason()).toMatchObject({ playoffStartWeek: 15, totalWeeks: 14 })
  })

  it("keeps the provider's own week whatever the sport", async () => {
    mocks.leagueFindUnique.mockResolvedValue(league('MLB', 20))
    await materializeRedraftSeasonForImportedLeague('MLB-league')
    expect(createdSeason()).toMatchObject({ playoffStartWeek: 20, totalWeeks: 19 })
  })
})

describe('still out of scope', () => {
  it('soccer is not materialized', async () => {
    mocks.leagueFindUnique.mockResolvedValue(league('SOCCER', null))
    const result = await materializeRedraftSeasonForImportedLeague('SOCCER-league')
    expect(result).toMatchObject({ seasonId: null, created: false, skippedReason: 'UNSUPPORTED_SPORT' })
    expect(mocks.seasonCreate).not.toHaveBeenCalled()
  })
})
