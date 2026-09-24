import { describe, expect, it } from 'vitest'

import { easternCalendarDay, gameDayFromRiGameId } from '@/lib/sports-data/easternGameDay'

const day = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('easternCalendarDay', () => {
  it('REGRESSION: an evening tip-off is the SAME Eastern day, not the next UTC day', () => {
    // The 2026 national final: "Tue, 07 Apr 2026 00:50:00 GMT" is 8:50pm EDT on Monday 04-06.
    expect(easternCalendarDay(new Date('2026-04-07T00:50:00Z'))).toEqual(day('2026-04-06'))
  })

  it('uses daylight time in summer and standard time in winter', () => {
    // EDT (UTC-4): midnight Eastern is 04:00Z.
    expect(easternCalendarDay(new Date('2026-09-23T03:59:00Z'))).toEqual(day('2026-09-22'))
    expect(easternCalendarDay(new Date('2026-09-23T04:00:00Z'))).toEqual(day('2026-09-23'))
    // EST (UTC-5): midnight Eastern is 05:00Z — a fixed -4 offset would get these wrong.
    expect(easternCalendarDay(new Date('2026-01-15T04:30:00Z'))).toEqual(day('2026-01-14'))
    expect(easternCalendarDay(new Date('2026-01-15T05:00:00Z'))).toEqual(day('2026-01-15'))
  })

  it('leaves a daytime game on its UTC day', () => {
    expect(easternCalendarDay(new Date('2026-09-19T16:00:00Z'))).toEqual(day('2026-09-19'))
  })

  it('returns null for nothing or an invalid date', () => {
    expect(easternCalendarDay(null)).toBeNull()
    expect(easternCalendarDay(new Date('not a date'))).toBeNull()
  })
})

describe('gameDayFromRiGameId', () => {
  it('reads the Eastern day the vendor prints into game_ID (GAPS G-08)', () => {
    expect(gameDayFromRiGameId('20260406-12-103')).toEqual(day('2026-04-06'))
    expect(gameDayFromRiGameId('20260922-15-18')).toEqual(day('2026-09-22'))
  })

  it('refuses ids without a date prefix, and impossible dates rather than rolling them over', () => {
    expect(gameDayFromRiGameId('cfbd:401856695')).toBeNull()
    expect(gameDayFromRiGameId('20260231-1-2')).toBeNull()
    expect(gameDayFromRiGameId(null)).toBeNull()
  })
})
