import { describe, expect, it, vi } from 'vitest'

import {
  resolveTradeDeadlineStatus,
  normalizeDeadlineWeek,
  resolveServerTradeWeek,
} from '@/lib/trade-deadline/tradeDeadlineWindow'

/**
 * The server's week for the trade deadline. Every collaborator is injected: the season row and the week
 * resolver (`resolveEffectiveRedraftWeek` in production — stored week for a native season, schedule week for
 * an import, date-windowed for NBA / NHL / MLB).
 */

function deps(season: { id: string; currentWeek: number; status: string } | null, week = 7) {
  const findFirst = vi.fn(async () => season)
  const resolveWeek = vi.fn(async () => week)
  return { findFirst, resolveWeek, deps: { prisma: { redraftSeason: { findFirst } } as never, resolveWeek } }
}

const LEAGUE = { id: 'L', lifecycleState: 'in_season', platform: 'sleeper' }

describe('resolveServerTradeWeek', () => {
  it("reads the league's latest season and asks the week resolver with the league's platform", async () => {
    const d = deps({ id: 'S', currentWeek: 1, status: 'in_season' }, 7)
    await expect(resolveServerTradeWeek(LEAGUE, d.deps)).resolves.toEqual({ inSeason: true, week: 7, seasonId: 'S' })
    expect(d.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L' } }))
    expect(d.resolveWeek).toHaveBeenCalledWith({ id: 'S', currentWeek: 1, status: 'in_season' }, 'sleeper')
  })

  it.each(['offseason', 'completed', 'renewal_pending', 'setup', 'pre_draft', 'drafting', 'archived'])(
    'lifecycle %s is not in season, and reads nothing',
    async (lifecycleState) => {
      const d = deps({ id: 'S', currentWeek: 17, status: 'active' })
      await expect(resolveServerTradeWeek({ ...LEAGUE, lifecycleState }, d.deps)).resolves.toMatchObject({
        inSeason: false,
        reason: 'lifecycle_not_in_season',
      })
      expect(d.findFirst).not.toHaveBeenCalled()
    },
  )

  it('post_draft (a native league\'s whole first season) defers to the season row', async () => {
    const d = deps({ id: 'S', currentWeek: 4, status: 'active' }, 4)
    await expect(resolveServerTradeWeek({ ...LEAGUE, lifecycleState: 'post_draft' }, d.deps)).resolves.toMatchObject({ inSeason: true, week: 4 })
  })

  it('a complete season, a not-yet-started season and no season at all are not in season', async () => {
    await expect(resolveServerTradeWeek(LEAGUE, deps({ id: 'S', currentWeek: 17, status: 'complete' }).deps)).resolves.toMatchObject({ reason: 'season_complete' })
    await expect(resolveServerTradeWeek(LEAGUE, deps({ id: 'S', currentWeek: 0, status: 'setup' }).deps)).resolves.toMatchObject({ reason: 'season_not_started' })
    await expect(resolveServerTradeWeek(LEAGUE, deps(null).deps)).resolves.toMatchObject({ reason: 'no_season' })
  })
})

describe('resolveTradeDeadlineStatus', () => {
  it('passes only AFTER the deadline week', async () => {
    const season = { id: 'S', currentWeek: 0, status: 'active' }
    expect((await resolveTradeDeadlineStatus(LEAGUE, 11, deps(season, 11).deps)).passed).toBe(false)
    expect((await resolveTradeDeadlineStatus(LEAGUE, 11, deps(season, 12).deps)).passed).toBe(true)
  })

  it('no deadline configured: reads nothing at all', async () => {
    const d = deps({ id: 'S', currentWeek: 16, status: 'active' }, 16)
    for (const none of [null, undefined, 0, -3, 'abc']) {
      await expect(resolveTradeDeadlineStatus(LEAGUE, none, d.deps)).resolves.toMatchObject({ passed: false, by: null, deadlineWeek: null, deadlineAt: null, window: null })
    }
    expect(d.findFirst).not.toHaveBeenCalled()
  })

  it("offseason: last season's week 17 is not past this season's deadline", async () => {
    const d = deps({ id: 'S', currentWeek: 17, status: 'complete' }, 17)
    await expect(resolveTradeDeadlineStatus(LEAGUE, 11, d.deps)).resolves.toMatchObject({ passed: false, deadlineWeek: 11 })
    expect(d.resolveWeek).not.toHaveBeenCalled()
  })
})

describe('normalizeDeadlineWeek', () => {
  it('accepts positive whole weeks, numeric strings included', () => {
    expect(normalizeDeadlineWeek(11)).toBe(11)
    expect(normalizeDeadlineWeek('9')).toBe(9)
    expect(normalizeDeadlineWeek(10.7)).toBe(10)
    expect(normalizeDeadlineWeek(0)).toBeNull()
    expect(normalizeDeadlineWeek(null)).toBeNull()
  })
})
