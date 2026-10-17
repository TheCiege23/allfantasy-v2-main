/**
 * `resolveEffectiveRedraftWeek` — the week an imported redraft season is read at.
 *
 * 🛑 Measured 2026-10-12: all 534 imported 2026 NFL seasons (525 Sleeper, 8 ESPN, 1 Fleaflicker) stored
 * `currentWeek = 1` while the NFL schedule was on week 5-6, and the one native season stored 5 (its engine
 * advances it only once its matchups finalize). Runs through the REAL `resolveSeasonWeekForRedraftSeason`
 * against a schedule shaped like production's NFL 2026 rows, so the imported answer is the schedule's own.
 */
import { describe, expect, it, vi } from 'vitest'

import { resolveEffectiveRedraftWeek } from '@/lib/season-week'

const FETCHED = new Date('2026-10-01T12:00:00Z')
// Thursday-night-to-Monday-night kickoffs, as `SportsGame` holds NFL 2026 regular weeks 1-6.
const WEEKS: Array<[number, string, string]> = [
  [1, '2026-09-10T00:20:00Z', '2026-09-15T00:15:00Z'],
  [2, '2026-09-18T00:15:00Z', '2026-09-22T00:15:00Z'],
  [3, '2026-09-25T00:15:00Z', '2026-09-29T00:15:00Z'],
  [4, '2026-10-02T00:15:00Z', '2026-10-06T00:15:00Z'],
  [5, '2026-10-09T00:15:00Z', '2026-10-13T00:15:00Z'],
  [6, '2026-10-16T00:15:00Z', '2026-10-20T00:15:00Z'],
]
// Week 6's Thursday game is final, its Monday game not yet played.
const NOW = new Date('2026-10-17T12:00:00Z')

function fakeDb() {
  const games = WEEKS.flatMap(([week, first, last]) => [
    { week, seasonType: 'regular', startTime: new Date(first), status: 'final', source: 'espn', fetchedAt: FETCHED },
    {
      week,
      seasonType: 'regular',
      startTime: new Date(last),
      status: week < 6 ? 'final' : 'scheduled',
      source: 'espn',
      fetchedAt: FETCHED,
    },
  ])
  return {
    redraftSeason: {
      findUnique: vi.fn(async () => ({ leagueId: 'L', sport: 'NFL', season: 2026, totalWeeks: 14, playoffStartWeek: 15 })),
    },
    redraftPlayoffRound: { findFirst: vi.fn(async () => null) },
    league: { findUnique: vi.fn(async () => null) },
    sportsGame: { findMany: vi.fn(async () => games) },
  }
}

describe('resolveEffectiveRedraftWeek', () => {
  it('🛑 an imported Sleeper season stored at week 1 reads at the schedule week (6), not 1', async () => {
    const db = fakeDb()
    const week = await resolveEffectiveRedraftWeek({ id: 's-imported', currentWeek: 1 }, 'sleeper', {
      prisma: db as never,
      now: NOW,
    })
    expect(week).toBe(6)
    expect(db.sportsGame.findMany).toHaveBeenCalledTimes(1)
  })

  it('ESPN and Fleaflicker imports resolve the same way', async () => {
    for (const platform of ['espn', 'fleaflicker']) {
      const week = await resolveEffectiveRedraftWeek({ id: 's', currentWeek: 1 }, platform, { prisma: fakeDb() as never, now: NOW })
      expect(week).toBe(6)
    }
  })

  it('a native season keeps its engine week and never consults the schedule', async () => {
    for (const platform of ['manual', 'allfantasy', 'native', 'af']) {
      const db = fakeDb()
      const week = await resolveEffectiveRedraftWeek({ id: 's-native', currentWeek: 5 }, platform, { prisma: db as never, now: NOW })
      expect(week).toBe(5)
      expect(db.sportsGame.findMany).not.toHaveBeenCalled()
      expect(db.redraftSeason.findUnique).not.toHaveBeenCalled()
    }
  })

  it('falls back to the stored week when the resolver declines (no schedule rows)', async () => {
    const db = fakeDb()
    db.sportsGame.findMany.mockResolvedValueOnce([])
    const week = await resolveEffectiveRedraftWeek({ id: 's', currentWeek: 3 }, 'sleeper', { prisma: db as never, now: NOW })
    expect(week).toBe(3)
  })

  it('falls back to the stored week, without throwing, when the schedule read fails', async () => {
    const db = fakeDb()
    db.sportsGame.findMany.mockRejectedValueOnce(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const week = await resolveEffectiveRedraftWeek({ id: 's', currentWeek: 0 }, 'sleeper', { prisma: db as never, now: NOW })
    expect(week).toBe(1)
    warn.mockRestore()
  })
})
