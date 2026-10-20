/**
 * A guillotine league's season must run to its last chop week, with no playoffs.
 *
 * Before: the created season took the sport default (NBA 22 weeks, playoffs from week 20), so a
 * 16-team NBA league chopping weeks 10-24 would have stopped two chops short and opened
 * playoffs mid-elimination.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  redraftSeason: { findFirst: vi.fn(), create: vi.fn(async ({ data }: { data: unknown }) => data) },
  isGuillotine: vi.fn(),
  getConfig: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: m.league, redraftSeason: m.redraftSeason } }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({
  isGuillotineLeague: m.isGuillotine,
  getGuillotineConfig: m.getConfig,
}))

const { ensureRedraftSeason } = await import('@/lib/redraft/finalizeDraftToRedraftSeason')

const nbaLeague = {
  id: 'L1', sport: 'NBA', season: 2026, medianGame: false, playoffStartWeek: null,
  playoffTeams: 4, playoffWeeksPerRound: 1, dynastyConfig: null, bbContestId: null, bestBallMode: false, settings: {},
}

describe('season length for a native guillotine league', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.redraftSeason.findFirst.mockResolvedValue(null)
    m.league.findUnique.mockResolvedValue(nbaLeague)
  })

  it('ends on the last chop week and schedules no playoffs', async () => {
    m.isGuillotine.mockResolvedValue(true)
    m.getConfig.mockResolvedValue({ eliminationStartWeek: 10, eliminationEndWeek: 24 })
    await ensureRedraftSeason('L1')
    expect(m.redraftSeason.create.mock.calls[0][0].data).toMatchObject({ totalWeeks: 24, playoffStartWeek: 25 })
  })

  it('keeps the created length when no last chop week is set, still without playoffs', async () => {
    m.isGuillotine.mockResolvedValue(true)
    m.getConfig.mockResolvedValue({ eliminationStartWeek: 1, eliminationEndWeek: null })
    await ensureRedraftSeason('L1')
    const data = m.redraftSeason.create.mock.calls[0][0].data
    expect(data.playoffStartWeek).toBe(data.totalWeeks + 1)
  })

  it('leaves a regular NBA league on the sport default', async () => {
    m.isGuillotine.mockResolvedValue(false)
    await ensureRedraftSeason('L1')
    expect(m.getConfig).not.toHaveBeenCalled()
    expect(m.redraftSeason.create.mock.calls[0][0].data).toMatchObject({ totalWeeks: 25, playoffStartWeek: 23 })
  })
})
