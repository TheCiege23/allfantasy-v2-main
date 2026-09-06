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

  it('is null for nothing and for garbage', () => {
    expect(reportedLabel(null)).toBeNull()
    expect(reportedLabel('not a date')).toBeNull()
  })
})
