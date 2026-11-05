import { describe, expect, it } from 'vitest'
import { nbaCampusScheduleCoversWindow } from '@/lib/c2c/nbaCampusScheduleCoverage'

describe('basketball campus schedule coverage', () => {
  const meta = { firstDay: '2026-11-01', lastDay: '2027-03-07' }
  it('accepts pre-season and published windows', () => {
    expect(nbaCampusScheduleCoversWindow(meta, { end: new Date('2026-10-31T00:00:00Z') })).toBe(true)
    expect(nbaCampusScheduleCoversWindow(meta, { end: new Date('2027-03-08T00:00:00Z') })).toBe(true)
  })
  it('withholds unpublished postseason and missing schedule data', () => {
    expect(nbaCampusScheduleCoversWindow(meta, { end: new Date('2027-03-09T00:00:00Z') })).toBe(false)
    expect(nbaCampusScheduleCoversWindow(null, { end: new Date('2026-10-31T00:00:00Z') })).toBe(false)
  })
})
