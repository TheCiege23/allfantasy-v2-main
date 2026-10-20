/**
 * Wall-clock <-> instant conversion in a named IANA zone (lib/timezone.ts).
 * Used by the commissioner draft schedule so a date + time means the LEAGUE's local time,
 * never the viewer's browser zone. Every expectation is an absolute UTC instant.
 */
import { describe, expect, it } from 'vitest'
import { timeZoneShortName, utcToWallClock, wallClockToUtc } from '@/lib/timezone'

describe('wallClockToUtc', () => {
  it('America/New_York in EDT (UTC-4)', () => {
    expect(wallClockToUtc('2026-09-10', '19:30', 'America/New_York')?.toISOString()).toBe('2026-09-10T23:30:00.000Z')
  })
  it('America/New_York in EST (UTC-5)', () => {
    expect(wallClockToUtc('2026-12-05', '19:30', 'America/New_York')?.toISOString()).toBe('2026-12-06T00:30:00.000Z')
  })
  it('America/Los_Angeles in PDT (UTC-7)', () => {
    expect(wallClockToUtc('2026-08-20', '18:00', 'America/Los_Angeles')?.toISOString()).toBe('2026-08-21T01:00:00.000Z')
  })
  it('spring-forward day (2026-03-08, New York): either side of the 02:00 jump', () => {
    expect(wallClockToUtc('2026-03-08', '01:30', 'America/New_York')?.toISOString()).toBe('2026-03-08T06:30:00.000Z')
    expect(wallClockToUtc('2026-03-08', '03:30', 'America/New_York')?.toISOString()).toBe('2026-03-08T07:30:00.000Z')
    expect(wallClockToUtc('2026-03-08', '19:30', 'America/New_York')?.toISOString()).toBe('2026-03-08T23:30:00.000Z')
  })
  it('fall-back day (2026-11-01, New York): evening is already EST', () => {
    expect(wallClockToUtc('2026-11-01', '00:30', 'America/New_York')?.toISOString()).toBe('2026-11-01T04:30:00.000Z')
    expect(wallClockToUtc('2026-11-01', '19:30', 'America/New_York')?.toISOString()).toBe('2026-11-02T00:30:00.000Z')
  })
  it('rejects malformed input instead of guessing', () => {
    expect(wallClockToUtc('', '19:30', 'America/New_York')).toBeNull()
    expect(wallClockToUtc('2026-09-10', '7:30pm', 'America/New_York')).toBeNull()
    expect(wallClockToUtc('2026-13-40', '19:30', 'America/New_York')).toBeNull()
  })
  it('an invalid zone falls back to America/New_York', () => {
    expect(wallClockToUtc('2026-09-10', '19:30', 'Not/AZone')?.toISOString()).toBe('2026-09-10T23:30:00.000Z')
    expect(wallClockToUtc('2026-09-10', '19:30', null)?.toISOString()).toBe('2026-09-10T23:30:00.000Z')
  })
})

describe('utcToWallClock', () => {
  it('renders an instant as the zone\'s own date and time', () => {
    expect(utcToWallClock('2026-09-10T23:30:00.000Z', 'America/New_York')).toEqual({ date: '2026-09-10', time: '19:30' })
    expect(utcToWallClock('2026-09-10T23:30:00.000Z', 'America/Los_Angeles')).toEqual({ date: '2026-09-10', time: '16:30' })
    expect(utcToWallClock('2026-12-06T00:30:00.000Z', 'America/New_York')).toEqual({ date: '2026-12-05', time: '19:30' })
  })
  it('crosses the date line in the zone, not in UTC', () => {
    expect(utcToWallClock('2026-11-02T00:30:00.000Z', 'America/New_York')).toEqual({ date: '2026-11-01', time: '19:30' })
  })
  it('round-trips through wallClockToUtc on DST days', () => {
    for (const [d, t] of [['2026-03-08', '03:30'], ['2026-11-01', '19:30'], ['2026-07-04', '12:00']] as const) {
      const iso = wallClockToUtc(d, t, 'America/Los_Angeles')!.toISOString()
      expect(utcToWallClock(iso, 'America/Los_Angeles')).toEqual({ date: d, time: t })
    }
  })
  it('null for an unparseable instant', () => {
    expect(utcToWallClock('nope', 'America/New_York')).toBeNull()
  })
})

describe('timeZoneShortName', () => {
  it('follows DST for the given instant', () => {
    expect(timeZoneShortName('America/New_York', new Date('2026-09-10T23:30:00Z'))).toBe('EDT')
    expect(timeZoneShortName('America/New_York', new Date('2026-12-06T00:30:00Z'))).toBe('EST')
    expect(timeZoneShortName('America/Los_Angeles', new Date('2026-08-21T01:00:00Z'))).toBe('PDT')
  })
})
