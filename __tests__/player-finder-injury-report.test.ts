import { describe, expect, it } from 'vitest'

import { reportedLabel } from '@/lib/core-app/injuryReport'

/*
 * "reported Sat 7:58p ET" — and only a weekday for a row that carries no
 * time, per the production measurement in the module header.
 */
describe('reportedLabel', () => {
  it('prints the report clock in Eastern, pinned', () => {
    expect(reportedLabel('2026-09-05T23:58:00.000Z')).toBe('reported Sat 7:58p ET')
    expect(reportedLabel('2026-10-25T15:12:00.000Z', '2026-10-25T16:18:00.000Z')).toBe('reported Sun 11:12a ET')
  })

  it('prints minutes inside the last hour on a game day', () => {
    expect(reportedLabel('2026-10-25T16:00:00.000Z', '2026-10-25T16:18:00.000Z')).toBe('reported 18 min ago')
    expect(reportedLabel('2026-10-25T16:17:40.000Z', '2026-10-25T16:18:00.000Z')).toBe('reported 1 min ago')
  })

  it('gives a date-only row its weekday and no invented time', () => {
    expect(reportedLabel('2026-09-05T00:00:00.000Z')).toBe('reported Sat')
    expect(reportedLabel('2026-09-05T00:00:00.000Z', '2026-09-05T00:10:00.000Z')).toBe('reported Sat')
  })

  /*
   * 2026-09-27, a Sunday morning: "reported Sun 6:47p ET" was LAST Sunday's report,
   * reading as a time that had not happened yet that day.
   */
  it('dates a report six or more days old so its weekday cannot be read as this week', () => {
    // Sun 2026-09-20 6:47p ET, read Sun 2026-09-27 8:00a ET.
    expect(reportedLabel('2026-09-20T22:47:00.000Z', '2026-09-27T12:00:00.000Z')).toBe('reported Sun 9/20 6:47p ET')
    expect(reportedLabel('2026-09-20T00:00:00.000Z', '2026-09-27T12:00:00.000Z')).toBe('reported Sun 9/20')
    // Two days old keeps the plain weekday.
    expect(reportedLabel('2026-09-25T22:47:00.000Z', '2026-09-27T12:00:00.000Z')).toBe('reported Fri 6:47p ET')
  })

  it('is null for nothing and for garbage', () => {
    expect(reportedLabel(null)).toBeNull()
    expect(reportedLabel('not a date')).toBeNull()
  })
})
