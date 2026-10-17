/**
 * 🛑 A league that finished drafting mid-season was scored on games played before it drafted and then
 * stuck at week 1 forever (the finalizer sweeps only 3 weeks back). A late season now starts at its
 * sport's next unplayed week — lib/redraft/seasonStartWeek.ts.
 */
import { describe, expect, it } from 'vitest'
import { resolveSeasonStartWeek } from '@/lib/redraft/seasonStartWeek'
import type { SportWeekResolution } from '@/lib/season-week/types'

const slate = { week: 0, seasonType: 'regular', firstKickoffAt: new Date(), lastKickoffAt: new Date(), liveCount: 0, allFinal: false, games: 0 } as never
const week = (sportWeek: number, state: 'upcoming' | 'live' | 'between' | 'played', nextSportWeek: number | null, seasonType = 'regular'): SportWeekResolution =>
  ({ ok: true, sportWeek, seasonType: seasonType as never, state, slate, nextSportWeek, source: 'schedule' })
const start = (r: SportWeekResolution | Error, regularSeasonEnd = 14) =>
  resolveSeasonStartWeek({ sport: 'NFL', seasonYear: 2026, regularSeasonEnd }, { resolve: async () => { if (r instanceof Error) throw r; return r } })

describe('resolveSeasonStartWeek', () => {
  it('a season drafted before its sport starts begins at week 1, as before', async () => {
    expect(await start(week(1, 'upcoming', 2))).toEqual({ startWeek: 1, reason: 'sport_not_started' })
  })

  it('a week already played is skipped: drafted after NFL week 4, the season starts at week 5', async () => {
    expect(await start(week(4, 'played', 5))).toEqual({ startWeek: 5, reason: 'next_unplayed_week' })
  })

  it('a week in progress is skipped too — its early games are gone', async () => {
    expect(await start(week(5, 'live', 6))).toMatchObject({ startWeek: 6 })
    expect(await start(week(5, 'between', 6))).toMatchObject({ startWeek: 6 })
  })

  it('with no next week on the schedule yet, the one after the current week', async () => {
    expect(await start(week(7, 'played', null))).toMatchObject({ startWeek: 8 })
  })

  it('never starts after the last regular-season week — one regular week rather than none', async () => {
    expect(await start(week(13, 'played', 14), 12)).toEqual({ startWeek: 12, reason: 'clamped_to_last_regular_week' })
  })

  it('an unreadable sport week, a postseason week, or a failure all fall back to week 1', async () => {
    expect(await start({ ok: false, reason: 'NO_SCHEDULE_ROWS' })).toEqual({ startWeek: 1, reason: 'week_unknown' })
    expect(await start(week(2, 'played', 3, 'post'))).toEqual({ startWeek: 1, reason: 'postseason' })
    expect(await start(new Error('db down'))).toEqual({ startWeek: 1, reason: 'week_unknown' })
  })
})
