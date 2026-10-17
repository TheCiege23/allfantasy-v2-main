import { describe, expect, it } from 'vitest'
import { buildSGCalendarPreset } from '@/lib/survivor-guillotine/calendar-presets'
import type { SGPeriod } from '@/lib/survivor-guillotine/types'

const periods: SGPeriod[] = [
  { period: 1, mode: 'match_play', teamsEntering: 22, teamsLeaving: 1, chops: 1, tribeImmunity: true },
  { period: 2, mode: 'tribe_champion', teamsEntering: 21, teamsLeaving: 1, chops: 1, tribeImmunity: true },
  { period: 3, mode: 'gauntlet', teamsEntering: 20, teamsLeaving: 2, chops: 2, tribeImmunity: false },
]

describe('Survivor Guillotine calendar presets', () => {
  it('extends an NBA combined period and keeps commissioner overrides', () => {
    const existing = { 1: { scoringStartsAt: '2026-11-10T00:00:00.000Z',
      scoringEndsAt: '2026-11-17T00:00:00.000Z', ceremonyAt: '2026-11-17T02:00:00.000Z' } }
    const calendar = buildSGCalendarPreset(periods, existing, 1, {
      firstStart: '2026-11-10T00:00:00.000Z', daysPerPeriod: 7, extendedPeriods: [2],
      selectionHoursBeforeStart: 24, ceremonyHoursAfterEnd: 2,
    })
    expect(calendar[1]).toEqual(existing[1])
    expect(calendar[2].scoringStartsAt).toBe('2026-11-17T00:00:00.000Z')
    expect(calendar[2].scoringEndsAt).toBe('2026-12-01T00:00:00.000Z')
    expect(calendar[3].scoringStartsAt).toBe(calendar[2].scoringEndsAt)
    expect(Date.parse(calendar[3].auctionClosesAt!)).toBeLessThan(Date.parse(calendar[3].ceremonyAt))
  })

  it('rejects invalid span and preserves finished periods', () => {
    const existing = { 1: { ceremonyAt: '2026-11-17T02:00:00.000Z' } }
    expect(buildSGCalendarPreset(periods, existing, 2, { firstStart: '2026-11-10',
      daysPerPeriod: 7, selectionHoursBeforeStart: 24, ceremonyHoursAfterEnd: 2 })[1]).toEqual(existing[1])
    expect(() => buildSGCalendarPreset(periods, {}, 1, { firstStart: 'bad',
      daysPerPeriod: 7, selectionHoursBeforeStart: 24, ceremonyHoursAfterEnd: 2 })).toThrow()
  })
})
