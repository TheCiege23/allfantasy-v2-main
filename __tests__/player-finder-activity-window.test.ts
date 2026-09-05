import { describe, expect, it } from 'vitest'

import {
  activityWindow,
  hourLabel,
  inWindow,
  localParts,
  windowLabel,
  zoneLabel,
} from '@/lib/core-app/managerActivityWindow'

/*
 * "Usually moves on Sun 10a–12p" — read from move timestamps, in the league's
 * zone, and stated only when the pattern is real. Pure, so no clock and no
 * database: every fixture below is a list of UTC instants.
 */

const ET = 'America/New_York'

/** A UTC instant on the given 2026 date at HH:MM. */
function utc(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00Z`)
}

/** n copies of stamps spread across a set of Sundays in Sept/Oct 2026 (EDT, UTC-4). */
const SUNDAYS = ['2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18']

describe('activityWindow', () => {
  it('finds a Sunday-morning block and names the two hours that hold it', () => {
    // 10:15 and 11:40 ET on six Sundays, plus three strays elsewhere in the week.
    const stamps = [
      ...SUNDAYS.map((d) => utc(d, '14:15')), // 10:15a ET
      ...SUNDAYS.map((d) => utc(d, '15:40')), // 11:40a ET
      utc('2026-09-15', '23:00'), // Tue 7p ET
      utc('2026-09-23', '00:30'), // Tue 8:30p ET
      utc('2026-10-01', '17:00'), // Thu 1p ET
    ]
    const w = activityWindow(stamps, ET)
    expect(w).toMatchObject({ weekday: 0, daypart: 'morning', precision: 'window', startHour: 10, endHour: 12, sample: 15, zone: 'ET' })
    expect(w!.share).toBeCloseTo(12 / 15, 2)
    expect(windowLabel(w!)).toBe('Sun 10a–12p ET')
  })

  it('states a daypart when the moves are spread across it', () => {
    // Tuesday evenings, one move in each of the five evening hours, twice over.
    const tuesdays = ['2026-09-15', '2026-09-22']
    const stamps = tuesdays.flatMap((d) => ['21:10', '22:20', '23:05', '00:15', '01:30'].map((t, i) => (i >= 3 ? utc(nextDay(d), t) : utc(d, t))))
    // 21:10Z = 5:10p ET … 01:30Z (next day) = 9:30p ET — all Tuesday evening in ET.
    const w = activityWindow(stamps, ET)
    expect(w).toMatchObject({ weekday: 2, daypart: 'evening', precision: 'daypart', startHour: 17, endHour: 22 })
    expect(windowLabel(w!)).toBe('Tue evenings ET')
  })

  /* ⚠ NO PATTERN, NO SENTENCE. Eight moves on seven different days is not a habit. */
  it('says nothing under the sample floor or when no weekday dominates', () => {
    const few = SUNDAYS.slice(0, 5).map((d) => utc(d, '14:15'))
    expect(activityWindow(few, ET)).toBeNull()

    const spread = [
      utc('2026-09-13', '14:00'), // Sun morning
      utc('2026-09-14', '23:00'), // Mon evening
      utc('2026-09-15', '17:00'), // Tue midday
      utc('2026-09-16', '20:00'), // Wed afternoon
      utc('2026-09-17', '03:00'), // Wed late
      utc('2026-09-18', '12:00'), // Fri morning
      utc('2026-09-19', '18:00'), // Sat afternoon
      utc('2026-09-21', '14:00'), // Mon morning
    ]
    expect(activityWindow(spread, ET)).toBeNull()

    // Four Monday moves out of six clear the share floor, but spread over four
    // dayparts no two-hour block holds half of them, so it is "Mon …s", not a block.
    const mondays = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']
    const twoParts = [
      ...mondays.map((d, i) => utc(d, ['13:00', '15:00', '18:00', '22:00'][i])), // 9a, 11a, 2p, 6p ET
      utc('2026-09-16', '14:00'),
      utc('2026-09-19', '14:00'),
    ]
    expect(activityWindow(twoParts, ET)).toMatchObject({ weekday: 1, precision: 'daypart' })
  })

  /*
   * ⚠ THE LEAGUE'S ZONE, NOT THE SERVER'S. The same instants read three hours
   * earlier on the West Coast, and the label says which zone it is in.
   */
  it('honours the zone it is given', () => {
    const stamps = [...SUNDAYS.map((d) => utc(d, '14:15')), ...SUNDAYS.map((d) => utc(d, '15:40'))]
    const pt = activityWindow(stamps, 'America/Los_Angeles')
    expect(pt).toMatchObject({ weekday: 0, startHour: 7, endHour: 9, zone: 'PT' })
    expect(windowLabel(pt!)).toBe('Sun 7a–9a PT')
  })

  it('reads a move just after midnight as late on that calendar day', () => {
    // 04:30Z on Tuesdays = 12:30a ET Tuesday, and 03:00Z = 11p ET Monday.
    const parts = localParts(utc('2026-09-15', '04:30'), ET)
    expect(parts).toEqual({ weekday: 2, hour: 0 })
    expect(localParts(utc('2026-09-15', '03:00'), ET)).toEqual({ weekday: 1, hour: 23 })

    const stamps = SUNDAYS.map((d) => utc(nextDay(d), '04:30')) // Mon 12:30a ET ×6
    const w = activityWindow(stamps, ET)
    expect(w).toMatchObject({ weekday: 1, daypart: 'late', precision: 'window' })
    // The block starts at the hour that holds the moves — midnight — and runs to 2a.
    expect(windowLabel(w!)).toBe('Mon 12a–2a ET')
  })

  it('does not throw on an unknown zone; it falls back to the league default', () => {
    const stamps = [...SUNDAYS.map((d) => utc(d, '14:15')), ...SUNDAYS.map((d) => utc(d, '15:40'))]
    expect(() => activityWindow(stamps, 'Mars/Olympus_Mons')).not.toThrow()
    expect(activityWindow(stamps, 'Mars/Olympus_Mons')).toMatchObject({ weekday: 0, startHour: 10 })
  })

  it('knows whether now is inside the window', () => {
    const w = activityWindow([...SUNDAYS.map((d) => utc(d, '14:15')), ...SUNDAYS.map((d) => utc(d, '15:40'))], ET)!
    expect(inWindow(w, utc('2026-10-25', '13:30'), ET)).toBe(true) // Sun 9:30a ET — same daypart
    expect(inWindow(w, utc('2026-10-25', '19:30'), ET)).toBe(false) // Sun 3:30p ET
    expect(inWindow(w, utc('2026-10-26', '14:30'), ET)).toBe(false) // Monday
  })
})

describe('labels', () => {
  it('prints hours the way the handoff does', () => {
    expect(hourLabel(0)).toBe('12a')
    expect(hourLabel(10)).toBe('10a')
    expect(hourLabel(12)).toBe('12p')
    expect(hourLabel(13)).toBe('1p')
    expect(hourLabel(24)).toBe('12a')
  })
  it('collapses US zones to their two-letter form and keeps others as given', () => {
    expect(zoneLabel('America/New_York')).toBe('ET')
    expect(zoneLabel('America/Chicago')).toBe('CT')
    expect(zoneLabel('America/Los_Angeles')).toBe('PT')
    expect(zoneLabel('Europe/London', new Date('2026-01-15T12:00:00Z'))).toBe('GMT')
  })
})

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
