import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { exileWeekForInstant, exileWeekWindow } from '@/lib/survivor/exileRosterService'
import { dailySportWeekForInstant } from '@/lib/season-week/dailySportSeasonStarts'

/**
 * An Exile period runs Eastern midnight to Eastern midnight. A daily sport's gameweek is read on
 * UTC-midnight date keys, so for four hours each period's last night (8 PM–midnight Eastern) the UTC
 * read names the next period, whose window has not opened. Castaways, and Chimmy, saw "locked".
 */
const db = {} as never // the daily-sport path never reads the database

describe('exileWeekForInstant', () => {
  it('keeps the running period until Eastern midnight (the MLB rehearsal moment)', async () => {
    const lateTuesday = new Date('2027-06-09T03:37:16Z') // 11:37 PM Eastern, 8 June
    expect(dailySportWeekForInstant('MLB', 2027, lateTuesday)).toBe(12) // the UTC read, which was used before
    expect(await exileWeekForInstant(db, 'MLB', 2027, lateTuesday)).toBe(11)
    const w11 = await exileWeekWindow(db, 'MLB', 2027, 11)
    expect(lateTuesday >= w11!.start && lateTuesday < w11!.end).toBe(true)
  })

  it('moves to the new period at Eastern midnight, and agrees with the UTC read the rest of the day', async () => {
    expect(await exileWeekForInstant(db, 'MLB', 2027, new Date('2027-06-09T04:00:00Z'))).toBe(12)
    expect(await exileWeekForInstant(db, 'MLB', 2027, new Date('2027-06-09T17:00:00Z'))).toBe(12)
    expect(await exileWeekForInstant(db, 'MLB', 2027, new Date('2027-06-12T12:00:00Z'))).toBe(12)
  })

  it('does the same for every daily sport with a gameweek calendar, across the season', async () => {
    for (const sport of ['MLB', 'NHL']) {
      for (let day = 0; day < 120; day++) {
        const t = new Date(Date.UTC(2027, 3, 1) + day * 86_400_000 + 2 * 3_600_000) // 10 PM Eastern-ish each night
        const week = await exileWeekForInstant(db, sport, 2027, t)
        if (week == null) continue
        const window = await exileWeekWindow(db, sport, 2027, week)
        expect(window && t >= window.start && t < window.end, `${sport} ${t.toISOString()}`).toBe(true)
      }
    }
  })

  it('says nothing outside the season', async () => {
    expect(await exileWeekForInstant(db, 'MLB', 2027, new Date('2027-01-05T12:00:00Z'))).toBeNull()
  })
})
