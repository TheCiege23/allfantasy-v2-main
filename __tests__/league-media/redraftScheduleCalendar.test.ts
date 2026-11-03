import { describe, expect, it } from 'vitest'
import { buildScheduleCalendar } from '@/lib/league-media/redraftScheduleCalendar'

const weeks = (n: number) => Array.from({ length: n }, (_, i) => ({ week: i + 1, status: 'scheduled', matchups: [{}] }))

describe('buildScheduleCalendar', () => {
  it('marks deadline, playoff start and championship from real league data', () => {
    const cal = buildScheduleCalendar({ weeks: weeks(14), currentWeek: 9, playoffStartWeek: 15, totalWeeks: 17, tradeDeadlineWeek: 12 })
    expect(cal.cells.map(c => c.week)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1))
    expect(cal.cells.filter(c => c.kind === 'playoff').map(c => c.week)).toEqual([15, 16, 17])
    expect(cal.cells.find(c => c.deadline)?.week).toBe(12)
    expect(cal.cells.find(c => c.playoffStart)?.week).toBe(15)
    expect(cal.cells.find(c => c.championship)?.week).toBe(17)
    expect(cal).toMatchObject({ deadlineWeek: 12, playoffStartWeek: 15, championshipWeek: 17 })
    expect(cal.cells[7]!.state).toBe('done')
    expect(cal.cells[8]!.state).toBe('now')
    expect(cal.cells[9]!.state).toBe('upcoming')
    expect(cal.cells.filter(c => c.selectable).length).toBe(14)
  })

  it('drops playoff cells when totalWeeks is unknown (no RedraftSeason) — never a sport default', () => {
    const cal = buildScheduleCalendar({ weeks: weeks(14), currentWeek: 3, playoffStartWeek: 15, totalWeeks: null })
    expect(cal.cells).toHaveLength(14)
    expect(cal.cells.some(c => c.kind === 'playoff')).toBe(false)
    expect(cal.playoffStartWeek).toBeNull()
    expect(cal.championshipWeek).toBeNull()
  })

  it('records a no-playoff season (playoffStartWeek > totalWeeks) as no playoffs', () => {
    const cal = buildScheduleCalendar({ weeks: weeks(17), playoffStartWeek: 18, totalWeeks: 17 })
    expect(cal.cells).toHaveLength(17)
    expect(cal.cells.some(c => c.kind === 'playoff' || c.championship)).toBe(false)
    // The legend reads these: a no-playoff season must not advertise "Playoffs · Wk 18".
    expect(cal.playoffStartWeek).toBeNull()
    expect(cal.championshipWeek).toBeNull()
  })

  it('drops an unset, invalid or out-of-season trade deadline instead of clamping it', () => {
    for (const tradeDeadlineWeek of [null, undefined, 0, -2, 2.5, 30]) {
      const cal = buildScheduleCalendar({ weeks: weeks(14), playoffStartWeek: 15, totalWeeks: 17, tradeDeadlineWeek })
      expect(cal.deadlineWeek).toBeNull()
      expect(cal.cells.some(c => c.deadline)).toBe(false)
    }
  })

  it('can mark a deadline that falls in a playoff week only when that week is on the calendar', () => {
    expect(buildScheduleCalendar({ weeks: weeks(14), playoffStartWeek: 15, totalWeeks: 17, tradeDeadlineWeek: 16 }).deadlineWeek).toBe(16)
    expect(buildScheduleCalendar({ weeks: weeks(14), playoffStartWeek: 15, totalWeeks: null, tradeDeadlineWeek: 16 }).deadlineWeek).toBeNull()
  })

  it('falls back to week status when there is no current week, and sorts out-of-order input', () => {
    const cal = buildScheduleCalendar({
      weeks: [{ week: 2, status: 'scheduled' }, { week: 1, status: 'completed' }],
      currentWeek: null,
    })
    expect(cal.cells.map(c => [c.week, c.state])).toEqual([[1, 'done'], [2, 'upcoming']])
  })

  it('a regular week with no matchups is not selectable', () => {
    const cal = buildScheduleCalendar({ weeks: [{ week: 1, status: 'scheduled', matchups: [] }] })
    expect(cal.cells[0]!.selectable).toBe(false)
  })
})
