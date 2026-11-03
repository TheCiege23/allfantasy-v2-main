import { describe, expect, it } from 'vitest'
import { ffcObservationDate, ffcObservationIsFresh } from '@/lib/adp/ffcObservation'
describe('FFC draft observation dates', () => {
  it('does not relabel September drafts as fresh after an October download', () => {
    expect(ffcObservationIsFresh({ endDate: '2026-09-14' }, new Date('2026-10-29T09:00:00Z'))).toBe(false)
    expect(ffcObservationDate({ endDate: '2026-09-14' })?.toISOString()).toBe('2026-09-14T00:00:00.000Z')
  })
  it('accepts only genuine, recent sample dates', () => {
    const now = new Date('2026-10-29T09:00:00Z')
    expect(ffcObservationIsFresh({ endDate: '2026-10-28' }, now)).toBe(true)
    for (const endDate of ['2026-10-30','2026-02-30','2026-13-01','today','2026-10-28T00:00:00Z','']) {
      expect(ffcObservationIsFresh({ endDate }, now)).toBe(false)
    }
    expect(ffcObservationIsFresh(null, now)).toBe(false)
  })
})
