// @vitest-environment node
/**
 * The countdown wording, the per-sport default deadline, and the refusal in the draft-room helper.
 * The countdown only words the server's verdict: `passed` alone decides "Trades closed".
 */
import { describe, expect, it } from 'vitest'
import {
  countdownParts,
  formatCountdownSpan,
  tradeDeadlineCountdown,
  tradeDeadlineCountdownLabel,
} from '@/lib/trade-deadline/tradeDeadlineCountdown'
import { defaultTradeDeadlineWeek } from '@/lib/trade-deadline/tradeDeadlineDefaults'
import { playoffStartWeekFor } from '@/lib/sportConfig/dailySportSeasonShape'

const NOW = new Date('2026-11-18T12:00:00.000Z')
const H = 3_600_000
const inSeason = (week: number) => ({ inSeason: true, week })

describe('formatCountdownSpan', () => {
  it('days and hours, then hours and minutes, then minutes', () => {
    expect(formatCountdownSpan(3 * 24 * H + 4 * H + 59 * 60_000)).toBe('3d 4h')
    expect(formatCountdownSpan(5 * H + 12 * 60_000)).toBe('5h 12m')
    expect(formatCountdownSpan(45 * 60_000 + 59_000)).toBe('45m')
    expect(formatCountdownSpan(30_000)).toBe('under 1m')
  })

  it('rounds DOWN, so a deadline is never shown later than it is', () => {
    expect(countdownParts(24 * H - 1)).toEqual({ days: 0, hours: 23, minutes: 59 })
    expect(formatCountdownSpan(-5)).toBe('under 1m')
  })
})

describe('tradeDeadlineCountdown', () => {
  it('a close time ahead counts down: "Trade deadline in 3d 4h"', () => {
    const at = new Date(NOW.getTime() + 3 * 24 * H + 4 * H)
    const c = tradeDeadlineCountdown({ passed: false, by: null, deadlineWeek: 11, deadlineAt: at, window: inSeason(9) }, NOW)
    expect(c).toMatchObject({ state: 'counting', closesAtIso: at.toISOString() })
    expect(tradeDeadlineCountdownLabel(c)).toBe('Trade deadline in 3d 4h')
  })

  it('once the server says passed it reads "Trades closed", by week or by time', () => {
    for (const by of ['week', 'time'] as const) {
      const c = tradeDeadlineCountdown({ passed: true, by, deadlineWeek: 11, deadlineAt: null, window: inSeason(12) }, NOW)
      expect(tradeDeadlineCountdownLabel(c)).toBe('Trades closed')
    }
  })

  it('a week-only deadline is counted in weeks, never in fake hours', () => {
    const two = tradeDeadlineCountdown({ passed: false, by: null, deadlineWeek: 11, deadlineAt: null, window: inSeason(9) }, NOW)
    expect(two).toEqual({ state: 'weeks', deadlineWeek: 11, currentWeek: 9, weeksLeft: 2 })
    expect(tradeDeadlineCountdownLabel(two)).toBe('Trade deadline after Week 11 · 2 weeks left')
    const last = tradeDeadlineCountdown({ passed: false, by: null, deadlineWeek: 11, deadlineAt: null, window: inSeason(11) }, NOW)
    expect(tradeDeadlineCountdownLabel(last)).toBe('Trade deadline: this is the last week (Week 11)')
  })

  it('out of season the deadline is stated, not counted', () => {
    const c = tradeDeadlineCountdown({ passed: false, by: null, deadlineWeek: 11, deadlineAt: null, window: { inSeason: false, week: null } }, NOW)
    expect(tradeDeadlineCountdownLabel(c)).toBe('Trade deadline: Week 11')
  })

  it('no deadline at all renders nothing', () => {
    const c = tradeDeadlineCountdown({ passed: false, by: null, deadlineWeek: null, deadlineAt: null, window: null }, NOW)
    expect(c).toEqual({ state: 'none' })
    expect(tradeDeadlineCountdownLabel(c)).toBeNull()
  })
})

describe('defaultTradeDeadlineWeek: three weeks before the league\'s own playoffs', () => {
  it('NFL (playoffs week 15) → 12; NBA, NHL, MLB from their season shapes', () => {
    expect(defaultTradeDeadlineWeek(15)).toBe(12)
    expect(defaultTradeDeadlineWeek(playoffStartWeekFor('NBA'))).toBe(20)
    expect(defaultTradeDeadlineWeek(playoffStartWeekFor('NHL'))).toBe(22)
    expect(defaultTradeDeadlineWeek(playoffStartWeekFor('MLB'))).toBe(21)
  })

  it('a 4-team NFL bracket opening in week 16 gets week 13 — the gap is fixed, not the week', () => {
    expect(defaultTradeDeadlineWeek(16)).toBe(13)
  })

  it('no playoffs, or a season too short to hold one, means no default', () => {
    expect(defaultTradeDeadlineWeek(null)).toBeNull()
    expect(defaultTradeDeadlineWeek(3)).toBeNull()
  })
})
