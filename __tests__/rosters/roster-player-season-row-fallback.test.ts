/**
 * 🛑 MY TEAM DREW "UNKNOWN PLAYER" FOR A PLAYER THE LEAGUE KNOWS BY NAME.
 *
 * The roster surface resolved a roster's player ids through the stats store (`sports_players`) and
 * dropped any id it does not hold. The season's own roster row carries that player's name, position
 * and team (the Matchup tab reads them from there), so My team and Matchup disagreed about whether a
 * rostered player exists. Seen on a local league whose pool was never loaded into the stats store:
 * every slot on My team read "Unknown player".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn() },
    roster: { findFirst: vi.fn() },
    sportsPlayerRecord: { findUnique: vi.fn(), findMany: vi.fn() },
    sportsPlayer: { findMany: vi.fn() },
    fantasyPlayer: { findMany: vi.fn() },
    redraftRosterPlayer: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { getPlayerDataForSurface } from '@/lib/player-data/getPlayerDataForSurface'

const record = {
  id: 'rec-1', sport: 'NBA', name: 'Stored Starter', team: 'BOS', position: 'PG', stats: {}, projections: {}, dataSource: 'rolling_insights',
  headshotSource: null, injuryStatus: null, adp: null, headshotUrl: null,
}
const seasonRows = vi.mocked((prisma as unknown as { redraftRosterPlayer: { findMany: ReturnType<typeof vi.fn> } }).redraftRosterPlayer.findMany)
const run = () => getPlayerDataForSurface({ surface: 'roster', leagueId: 'lg', userId: 'user-1', limit: 50 })

beforeEach(() => {
  vi.mocked(prisma.league.findUnique).mockResolvedValue({ sport: 'NBA' } as never)
  vi.mocked(prisma.roster.findFirst).mockResolvedValue({ playerData: ['rec-1', 'only-in-season', 'nowhere'] } as never)
  vi.mocked(prisma.sportsPlayer.findMany).mockResolvedValue([] as never)
  vi.mocked((prisma as unknown as { fantasyPlayer: { findMany: ReturnType<typeof vi.fn> } }).fantasyPlayer.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.sportsPlayerRecord.findMany).mockResolvedValue([record] as never)
  seasonRows.mockReset()
  seasonRows.mockResolvedValue([{ playerId: 'only-in-season', playerName: 'Season Row Guy', position: 'C', team: 'DEN', injuryStatus: 'Questionable' }])
})

describe('a rostered player the stats store does not hold', () => {
  it('🛑 is named from the season’s own roster row, in roster order', async () => {
    const rows = await run()
    expect(rows.map((r) => [r.unified.playerId, r.unified.fullName])).toEqual([
      ['rec-1', 'Stored Starter'],
      ['only-in-season', 'Season Row Guy'],
    ])
    const fallback = rows[1].unified
    expect(fallback.position).toBe('C')
    expect(fallback.team).toBe('DEN')
  })

  it('asks the season only for the ids that are missing, and only in this league', async () => {
    await run()
    expect(seasonRows).toHaveBeenCalledTimes(1)
    const where = seasonRows.mock.calls[0][0].where
    expect(where.playerId.in).toEqual(['only-in-season', 'nowhere'])
    expect(where.roster).toEqual({ leagueId: 'lg' })
    expect(where.droppedAt).toBeNull()
  })

  it('a roster the stats store fully covers costs no extra read', async () => {
    vi.mocked(prisma.roster.findFirst).mockResolvedValue({ playerData: ['rec-1'] } as never)
    expect((await run()).length).toBe(1)
    expect(seasonRows).not.toHaveBeenCalled()
  })

  it('a player nobody knows is still left out, and a failed season read changes nothing', async () => {
    seasonRows.mockRejectedValue(new Error('down'))
    expect((await run()).map((r) => r.unified.playerId)).toEqual(['rec-1'])
    // Nor does a read that throws before it returns a promise at all.
    seasonRows.mockImplementation(() => {
      throw new Error('no such table')
    })
    expect((await run()).map((r) => r.unified.playerId)).toEqual(['rec-1'])
  })
})
