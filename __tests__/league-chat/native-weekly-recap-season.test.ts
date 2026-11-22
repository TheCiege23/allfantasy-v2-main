/**
 * The Tuesday recap finds a league's CURRENT season, not the calendar year's: an NBA/NHL season that
 * started in October 2026 is stored as 2026, and from January the sweep asks for 2027.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  redraftSeason: { findUnique: vi.fn(), findFirst: vi.fn() },
  redraftMatchup: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  redraftRoster: { findMany: vi.fn(async () => []) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { buildNativeRecapForLeague } from '@/lib/league-chat/nativeWeeklyRecap'

beforeEach(() => vi.clearAllMocks())

describe('native weekly recap season lookup', () => {
  it('in January, an NBA season stored under the year it started is still the current season', async () => {
    db.redraftSeason.findUnique.mockResolvedValue(null)
    db.redraftSeason.findFirst.mockResolvedValue({ id: 's2026', season: 2026 })
    const out = await buildNativeRecapForLeague({ leagueId: 'L1', leagueName: 'Hoops', seasonYear: 2027 })
    // It reaches the matchup read for the 2026 season instead of stopping at "no current season".
    expect(out).not.toEqual({ ok: false, reason: 'no current season' })
    expect(db.redraftMatchup.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ seasonId: 's2026' }) }))
    expect(db.redraftSeason.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L1', season: { lt: 2027 } } }))
  })

  it('the requested year still wins when that season exists', async () => {
    db.redraftSeason.findUnique.mockResolvedValue({ id: 's2026', season: 2026 })
    await buildNativeRecapForLeague({ leagueId: 'L1', leagueName: 'Gridiron', seasonYear: 2026 })
    expect(db.redraftSeason.findFirst).not.toHaveBeenCalled()
  })

  it('a league with no season at all still reports it', async () => {
    db.redraftSeason.findUnique.mockResolvedValue(null)
    db.redraftSeason.findFirst.mockResolvedValue(null)
    expect(await buildNativeRecapForLeague({ leagueId: 'L1', leagueName: 'New', seasonYear: 2027 })).toEqual({ ok: false, reason: 'no current season' })
  })
})
