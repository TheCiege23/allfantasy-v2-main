import { describe, expect, it, vi } from 'vitest'

/*
 * Sleeper's `settings.start_week` is imported (2026-11-14) and becomes the draft engine's scoring
 * window for a league that starts after week 1. A tournament round still wins; week-1 leagues get
 * no window (scoring byes there would shift every player equally). contracts/sleeper/GAPS.md S-11.
 */

const h = vi.hoisted(() => ({ tournamentLeague: vi.fn(), league: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { tournamentLeague: { findUnique: h.tournamentLeague }, league: { findUnique: h.league } },
}))

import { SleeperLeagueMapper } from '@/lib/league-import/adapters/sleeper/SleeperLeagueMapper'
import { resolveDraftScoringWindow, scoringWindowFromLeagueSettings } from '@/lib/shared-services/draft/DraftContextAssembler'

function payload(settings: Record<string, unknown>) {
  return {
    league: { league_id: 'l1', name: 'KBI North Black', season: '2026', sport: 'nfl', total_rosters: 16, settings, roster_positions: ['QB'] },
  } as unknown as Parameters<typeof SleeperLeagueMapper.map>[0]
}

describe('SleeperLeagueMapper start_week', () => {
  it('keeps a real NFL week', () => {
    expect(SleeperLeagueMapper.map(payload({ start_week: 11 }))?.start_week).toBe(11)
    expect(SleeperLeagueMapper.map(payload({ start_week: 1 }))?.start_week).toBe(1)
  })

  it('drops anything that is not a week 1–18', () => {
    expect(SleeperLeagueMapper.map(payload({}))?.start_week).toBeUndefined()
    expect(SleeperLeagueMapper.map(payload({ start_week: 0 }))?.start_week).toBeUndefined()
    expect(SleeperLeagueMapper.map(payload({ start_week: 40 }))?.start_week).toBeUndefined()
  })
})

describe('scoring window from league settings', () => {
  it('a league starting after week 1 scores from that week to the end of the season', () => {
    expect(scoringWindowFromLeagueSettings({ start_week: 11 })).toEqual({ startWeek: 11, endWeek: null, label: 'League starts week 11' })
  })

  it('no window for a week-1 league or missing data', () => {
    expect(scoringWindowFromLeagueSettings({ start_week: 1 })).toBeNull()
    expect(scoringWindowFromLeagueSettings({})).toBeNull()
    expect(scoringWindowFromLeagueSettings(null)).toBeNull()
  })

  it('a tournament round wins over the league start week', async () => {
    h.league.mockClear()
    h.tournamentLeague.mockResolvedValueOnce({ round: { roundNumber: 2, weekStart: 11, weekEnd: 12 }, tournament: { name: 'KBI' } })
    expect(await resolveDraftScoringWindow('l1')).toEqual({ startWeek: 11, endWeek: 12, label: 'KBI round 2' })
    // The league's own start week is not even read.
    expect(h.league).not.toHaveBeenCalled()
  })

  it('falls back to the league start week when there is no tournament round', async () => {
    h.tournamentLeague.mockResolvedValueOnce(null)
    h.league.mockResolvedValueOnce({ settings: { start_week: 11 } })
    expect(await resolveDraftScoringWindow('l1')).toEqual({ startWeek: 11, endWeek: null, label: 'League starts week 11' })
  })
})
