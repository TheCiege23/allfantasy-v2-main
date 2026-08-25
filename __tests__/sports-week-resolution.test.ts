import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above the file, so the fn has to be hoisted with it.
const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { sportsGame: { findFirst } },
}))

import { isPreseason, isRegularSeason, resolveSportsWeek } from '@/lib/core-app/sportsWeek'

const NOW = new Date('2026-08-24T20:00:00Z')
const D = (iso: string) => new Date(iso)

beforeEach(() => {
  findFirst.mockReset()
})

/**
 * Queue answers in the order the resolver asks: next-future-game, then (only
 * when that one is not regular season) the next regular game, then the week's
 * opener.
 */
function queue(...rows: Array<unknown>) {
  for (const r of rows) findFirst.mockResolvedValueOnce(r)
  findFirst.mockResolvedValue(null)
}

describe('season-type vocabulary', () => {
  it('accepts the spellings that actually reach this column', () => {
    // seasonType is nullable and written by more than one provider path, so
    // matching only one spelling would silently resolve nothing.
    for (const s of ['regular', 'REG', 'Regular', 'regular_season', 'regularseason']) {
      expect(isRegularSeason(s)).toBe(true)
    }
    for (const s of ['preseason', 'PRE', 'exhibition']) {
      expect(isPreseason(s)).toBe(true)
      expect(isRegularSeason(s)).toBe(false)
    }
  })

  it('treats null as neither, rather than guessing', () => {
    expect(isRegularSeason(null)).toBe(false)
    expect(isPreseason(null)).toBe(false)
  })
})

describe('resolveSportsWeek', () => {
  it('⚠ does NOT return a November game just because it is the next row on file', async () => {
    /*
     * THE PRODUCTION BUG. My Team asked for "earliest future game" and the
     * schedule table's next regular-season row was in late November, so the
     * lineup lock counted down 2,321 hours to it. The resolver must anchor on
     * the week, and the caller must be able to see that the week is 97 days
     * out and treat it as a coverage gap rather than a deadline.
     */
    const nov = {
      season: 2026,
      week: 13,
      seasonType: 'regular',
      startTime: D('2026-11-29T18:00:00Z'),
    }
    queue(nov, nov)

    const out = await resolveSportsWeek('NFL', NOW)
    expect(out).not.toBeNull()
    // It still reports the truth about what is on file...
    expect(out!.week).toBe(13)
    // ...but hands the caller the number that exposes it as a gap.
    expect(out!.daysUntilFirstKickoff).toBeGreaterThan(90)
  })

  it('resolves week 1 when week 1 is actually ingested', async () => {
    const w1 = {
      season: 2026,
      week: 1,
      seasonType: 'regular',
      startTime: D('2026-09-10T00:20:00Z'),
    }
    queue(w1, { startTime: D('2026-09-10T00:20:00Z') })

    const out = await resolveSportsWeek('NFL', NOW)
    expect(out!.season).toBe(2026)
    expect(out!.week).toBe(1)
    expect(out!.preseasonFirst).toBe(false)
    expect(out!.daysUntilFirstKickoff).toBeLessThan(20)
  })

  it('skips past a preseason game to the real week 1, and says one is coming', async () => {
    // In August the very next NFL game is exhibition. Anchoring on it would
    // call August "week 1"; ignoring it would hide a game the user can see.
    const preseason = {
      season: 2026,
      week: 3,
      seasonType: 'preseason',
      startTime: D('2026-08-28T23:00:00Z'),
    }
    const regularW1 = {
      season: 2026,
      week: 1,
      seasonType: 'regular',
      startTime: D('2026-09-10T00:20:00Z'),
    }
    queue(preseason, regularW1, { startTime: D('2026-09-10T00:20:00Z') })

    const out = await resolveSportsWeek('NFL', NOW)
    expect(out!.week).toBe(1)
    expect(out!.preseasonFirst).toBe(true)
  })

  it('uses the WEEK opener as the lock anchor, not the next game from now', async () => {
    /*
     * By Sunday evening the next game is Monday night, but the week's lineup
     * lock was Sunday morning. Anchoring on "next game" would tell a manager
     * they still have time to set a lineup that locked hours ago.
     */
    const mondayNight = {
      season: 2026,
      week: 5,
      seasonType: 'regular',
      startTime: D('2026-10-06T00:15:00Z'),
    }
    const thursdayOpener = { startTime: D('2026-10-02T00:15:00Z') }
    queue(mondayNight, thursdayOpener)

    const out = await resolveSportsWeek('NFL', new Date('2026-10-05T23:00:00Z'))
    expect(out!.week).toBe(5)
    expect(out!.firstKickoff.toISOString()).toBe('2026-10-02T00:15:00.000Z')
  })

  it('returns null rather than inventing a week when nothing is scheduled', async () => {
    queue(null)
    expect(await resolveSportsWeek('NFL', NOW)).toBeNull()
  })

  it('returns null when only preseason exists and no regular game follows', async () => {
    // Better to say "we do not know your week" than to label an exhibition
    // game as week 1 of the season people are about to play for money.
    queue({ season: 2026, week: 2, seasonType: 'preseason', startTime: D('2026-08-28T23:00:00Z') }, null)
    expect(await resolveSportsWeek('NFL', NOW)).toBeNull()
  })

  it('survives a database error without taking the screen down', async () => {
    findFirst.mockRejectedValueOnce(new Error('connection lost'))
    // A roster screen that throws because the schedule table hiccuped is worse
    // than one that renders the roster and omits kickoff times.
    await expect(resolveSportsWeek('NFL', NOW)).resolves.toBeNull()
  })
})
