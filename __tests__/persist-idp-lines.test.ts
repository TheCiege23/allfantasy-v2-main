import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ upsert: vi.fn(), findFirst: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantasyStatLine: { upsert: h.upsert },
    sportsGame: { findFirst: h.findFirst },
  },
}))

import { persistIdpForGame, gameWeekMeta } from '@/lib/idp/persistIdpLines'
import type { PbpGame } from '@/lib/live/rollingInsightsPlayByPlay'

const game = (): PbpGame => ({
  gameId: '20260920-1-26',
  awayTeamName: 'Philadelphia Eagles',
  homeTeamName: 'Dallas Cowboys',
  plays: [
    {
      sequence: 1, quarter: 1, gameClock: '14:00 - 1st', event: 'sack',
      yardsGained: -8, yardLine: 'DAL 30', possession: 'Philadelphia Eagles',
      isTouchdown: false, isScoringPlay: false, isReturned: false, isReversed: false,
      description: '', pointsAfterType: null,
      players: [{ id: 101, name: 'Micah Parsons', role: 'defender', action: 'sack', position: 'LB', teamAbbr: 'DAL' }],
    },
  ],
})

beforeEach(() => {
  h.upsert.mockReset()
  h.findFirst.mockReset()
  h.upsert.mockResolvedValue({})
})

describe('persistIdpForGame', () => {
  it('writes a defender under the NFL play-by-play source', async () => {
    const res = await persistIdpForGame(game(), { season: 2026, week: 3 })
    expect(res.playersWritten).toBe(1)

    const arg = h.upsert.mock.calls[0][0]
    expect(arg.where.uniq_fantasy_stat_line_player_week_source).toEqual({
      playerId: '101', sport: 'NFL', season: '2026', week: 3, source: 'rolling_insights_pbp',
    })
    expect(arg.create.stats.idp_sack).toBe(1)
    expect(arg.create.stats.idp_sack_yardage).toBe(8)
  })

  it('REFUSES to write without a week rather than defaulting to 0', async () => {
    // The unique key includes week. Writing an unknown week as 0 would collapse
    // a player's whole season onto one row, each week overwriting the last.
    const res = await persistIdpForGame(game(), { season: 2026, week: null })
    expect(res.skipped).toBe('no-week')
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('refuses without a season too', async () => {
    const res = await persistIdpForGame(game(), { season: null, week: 3 })
    expect(res.skipped).toBe('no-week')
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('leaves the scoring preset empty instead of inventing a number', async () => {
    // IDP settings vary too much for a value here to be anything but one
    // league's answer presented as everyone's.
    await persistIdpForGame(game(), { season: 2026, week: 3 })
    expect(h.upsert.mock.calls[0][0].create.fantasyPointsByScoringPreset).toEqual({})
  })

  it('never throws when the database rejects a row', async () => {
    h.upsert.mockRejectedValue(new Error('constraint violation'))
    // This runs behind live scoring. A stat line is worth less than a score.
    await expect(persistIdpForGame(game(), { season: 2026, week: 3 }))
      .resolves.toEqual({ playersWritten: 0, skipped: null })
  })

  it('writes nothing for a game with no defensive production', async () => {
    const empty = { ...game(), plays: [] }
    const res = await persistIdpForGame(empty, { season: 2026, week: 3 })
    expect(res.playersWritten).toBe(0)
    expect(h.upsert).not.toHaveBeenCalled()
  })
})

describe('gameWeekMeta', () => {
  it('reads week from the schedule, not from the date in the game id', async () => {
    // A game id encodes a date, and a date is not a week — Thursday and the
    // following Monday are the same NFL week.
    h.findFirst.mockResolvedValue({ season: 2026, week: 3 })
    await expect(gameWeekMeta('20260920-1-26')).resolves.toEqual({ season: 2026, week: 3 })
    expect(h.findFirst.mock.calls[0][0].where).toEqual({
      sport: 'NFL', externalId: '20260920-1-26', source: 'rolling_insights',
    })
  })

  it('returns nulls when the game is unknown, so the caller skips', async () => {
    h.findFirst.mockResolvedValue(null)
    await expect(gameWeekMeta('nope')).resolves.toEqual({ season: null, week: null })
  })

  it('survives a database error', async () => {
    h.findFirst.mockRejectedValue(new Error('down'))
    await expect(gameWeekMeta('x')).resolves.toEqual({ season: null, week: null })
  })
})
