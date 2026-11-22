/**
 * Planning around a long pick clock (2026-11-15). "Slow" is the commissioner's clock length, not a
 * draft type — these helpers take the clock and the quiet window, never a mode.
 */
import { describe, expect, it } from 'vitest'
import {
  LONG_PICK_CLOCK_SECONDS,
  crossesQuietWindow,
  describeEta,
  effectiveDueAt,
  estimateNextPickAt,
  estimatePickPaceSeconds,
  formatWallMinutes,
  isInQuietWindow,
  isLongPickClock,
  isMinuteInWindow,
  nextOccurrenceOfMinute,
  nextPickLabel,
  normalizeQuietWindow,
  shortZoneName,
} from '@/lib/draft-room/pickClockPlanning'

const ET = { start: '22:00', end: '08:00', timezone: 'America/New_York' }
// Sunday 15 Nov 2026, 3:20 PM Eastern (UTC-5).
const NOW = Date.parse('2026-11-15T20:20:00Z')

describe('which clocks count as long', () => {
  it('starts at ten minutes', () => {
    expect(LONG_PICK_CLOCK_SECONDS).toBe(600)
    expect(isLongPickClock(30)).toBe(false)
    expect(isLongPickClock(599)).toBe(false)
    expect(isLongPickClock(600)).toBe(true)
    expect(isLongPickClock(14_400)).toBe(true)
    expect(isLongPickClock(null)).toBe(false)
  })
})

describe('quiet window', () => {
  it('accepts a real window and rejects junk', () => {
    expect(normalizeQuietWindow(ET)).toEqual(ET)
    expect(normalizeQuietWindow({ ...ET, timezone: 'Not/AZone' })).toBeNull()
    expect(normalizeQuietWindow({ ...ET, end: '22:00' })).toBeNull()
    expect(normalizeQuietWindow({ ...ET, start: '25:00' })).toBeNull()
    expect(normalizeQuietWindow(null)).toBeNull()
  })

  it('handles a window that wraps past midnight', () => {
    expect(isMinuteInWindow(23 * 60, 1320, 480)).toBe(true)
    expect(isMinuteInWindow(3 * 60, 1320, 480)).toBe(true)
    expect(isMinuteInWindow(8 * 60, 1320, 480)).toBe(false)
    expect(isMinuteInWindow(12 * 60, 1320, 480)).toBe(false)
    expect(isMinuteInWindow(13 * 60, 720, 900)).toBe(true)
  })

  it('reads the window in its own time zone', () => {
    expect(isInQuietWindow(new Date(NOW), ET)).toBe(false) // 3:20 PM ET
    expect(isInQuietWindow(new Date('2026-11-16T04:00:00Z'), ET)).toBe(true) // 11 PM ET
    expect(crossesQuietWindow(NOW, NOW + 2 * 3600_000, ET)).toBe(false)
    expect(crossesQuietWindow(NOW, NOW + 8 * 3600_000, ET)).toBe(true)
  })

  it('finds when the window next starts', () => {
    expect(nextOccurrenceOfMinute(NOW, 22 * 60, ET.timezone).toISOString()).toBe('2026-11-16T03:00:00.000Z')
  })
})

describe('pick pace', () => {
  it('uses half the clock until there is enough history', () => {
    expect(estimatePickPaceSeconds([], 14_400)).toBe(7_200)
    expect(estimatePickPaceSeconds([NOW, NOW + 60_000], 14_400)).toBe(7_200)
  })

  it('takes the median gap and never more than the clock', () => {
    const h = 3600_000
    const times = [0, 1 * h, 2 * h, 3 * h, 13 * h].map((x) => NOW + x) // one 10h overnight gap
    expect(estimatePickPaceSeconds(times, 14_400)).toBe(3_600)
    expect(estimatePickPaceSeconds([0, 9 * h, 18 * h, 27 * h].map((x) => NOW + x), 14_400)).toBe(14_400)
  })
})

describe('when the viewer is up', () => {
  it('without quiet hours is simply picks × pace', () => {
    expect(estimateNextPickAt({ nowMs: NOW, picksAway: 5, paceSeconds: 600 }).getTime()).toBe(NOW + 5 * 600_000)
  })

  it('skips quiet hours: 5 picks at 1h40m from 3:20 PM ET lands at 9:40 AM ET next day', () => {
    const eta = estimateNextPickAt({ nowMs: NOW, picksAway: 5, paceSeconds: 6_000, quietWindow: ET })
    expect(eta.toISOString()).toBe('2026-11-16T14:40:00.000Z')
    expect(describeEta(eta, new Date(NOW), 'en-US', ET.timezone)).toMatchObject({ day: 'tomorrow', time: '9:40 AM' })
  })

  it('says today for a short wait', () => {
    const eta = estimateNextPickAt({ nowMs: NOW, picksAway: 4, paceSeconds: 1_500 })
    expect(describeEta(eta, new Date(NOW), 'en-US', ET.timezone)).toMatchObject({ day: 'today', time: '5:00 PM' })
  })
})

describe('when the pick on the clock is really due', () => {
  it('is the timer end when no quiet hours fall before it', () => {
    const end = NOW + 3 * 3600_000
    expect(effectiveDueAt(NOW, end, ET).getTime()).toBe(end)
    expect(effectiveDueAt(NOW, end, null).getTime()).toBe(end)
  })

  it('moves past quiet hours, because the server freezes the clock: 8 PM + 4h → 10 AM', () => {
    const eightPm = Date.parse('2026-11-16T01:00:00Z') // 8 PM ET
    const due = effectiveDueAt(eightPm, eightPm + 4 * 3600_000, ET)
    expect(due.toISOString()).toBe('2026-11-16T15:00:00.000Z') // 10 AM ET
  })
})

describe('labels', () => {
  it('names the next pick on the board', () => {
    expect(nextPickLabel(14, 5, 10)).toBe('2.9')
    expect(nextPickLabel(1, 0, 10)).toBe('1.1')
    expect(nextPickLabel(1, 0, 0)).toBeNull()
  })

  it('formats wall times and zones the way a league says them', () => {
    expect(formatWallMinutes(22 * 60)).toBe('10 PM')
    expect(formatWallMinutes(8 * 60 + 30)).toBe('8:30 AM')
    expect(shortZoneName('America/New_York', new Date(NOW))).toBe('ET')
    expect(shortZoneName('America/Los_Angeles', new Date('2026-07-01T12:00:00Z'))).toBe('PT')
  })
})
