/**
 * The redraft Commissioner tab's health mappings (lib/league-media/redraftDeck.ts): score ring, trend
 * presence, sub-score bars, managers to check on, and the season-aware checklist. Every rule either
 * maps a real read or drops it; these tests pin the drops as hard as the maps.
 */
import { describe, expect, it } from 'vitest'
import { buildWeeklyChecklist } from '@/lib/commissioner/weeklyChecklist'
import {
  HEALTH_RING_CIRCUMFERENCE,
  buildCommishChecklist,
  checklistEmptyReason,
  healthRingDash,
  healthStatusLabel,
  healthSubScoreBars,
  healthTone,
  healthTrendLine,
  initialsFor,
  managersToCheck,
  type CommishManagerRow,
} from '@/lib/league-media/redraftDeck'

const NOW = new Date('2026-10-31T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

describe('score ring', () => {
  it('tones on the hub tile bands (70 / 45)', () => {
    expect([healthTone(100), healthTone(70), healthTone(69.9), healthTone(45), healthTone(44), healthTone(0)]).toEqual([
      'good', 'good', 'warn', 'warn', 'bad', 'bad',
    ])
  })
  it('fills the arc in proportion and clamps outside 0–100', () => {
    const full = HEALTH_RING_CIRCUMFERENCE.toFixed(1)
    expect(healthRingDash(50)).toBe(`${(HEALTH_RING_CIRCUMFERENCE / 2).toFixed(1)} ${full}`)
    expect(healthRingDash(140)).toBe(`${full} ${full}`)
    expect(healthRingDash(-5)).toBe(`0.0 ${full}`)
  })
  it('labels the engine statuses and never invents one', () => {
    expect(healthStatusLabel('at_risk')).toBe('At risk')
    expect(healthStatusLabel('healthy')).toBe('Healthy')
    expect(healthStatusLabel('')).toBe('Unscored')
  })
})

describe('trend line — only from past scores', () => {
  it('is absent with no history and with a single point (one point is not a trend)', () => {
    expect(healthTrendLine([])).toBeNull()
    expect(healthTrendLine(null)).toBeNull()
    expect(healthTrendLine([82])).toBeNull()
    expect(healthTrendLine([NaN, 82])).toBeNull()
  })
  it('draws through two or more points, oldest first, ending on the latest', () => {
    const line = healthTrendLine([71, 74, 82], 372, 70)!
    expect(line).not.toBeNull()
    expect(line.points.split(' ')).toHaveLength(3)
    expect(line.first).toBe(71)
    expect(line.latest).toBe(82)
    expect(line.last.x).toBeCloseTo(366, 5)
    // Higher score sits higher on the chart (smaller y).
    const ys = line.points.split(' ').map((p) => Number(p.split(',')[1]))
    expect(ys[2]).toBeLessThan(ys[0])
  })
})

describe('sub-score bars', () => {
  it('drops a missing sub-score instead of drawing it at zero, and rounds/clamps the rest', () => {
    const bars = healthSubScoreBars({ activity: 88.4, participation: null, fairness: 120, sustainability: 0 })
    expect(bars.map((b) => [b.key, b.label, b.value])).toEqual([
      ['activity', 'Activity', 88],
      ['fairness', 'Fairness', 100],
      ['sustainability', 'Sustainability', 0],
    ])
  })
  it('has nothing to draw without a score', () => {
    expect(healthSubScoreBars(null)).toEqual([])
  })
})

describe('managers to check on', () => {
  const row = (over: Partial<CommishManagerRow>): CommishManagerRow => ({
    rosterId: 'r', managerName: 'm', teamName: 't', lineupsSet: 9, expectedStarters: 9, lastActionAt: daysAgo(1), status: 'active', ...over,
  })
  const rows = [
    row({ rosterId: 'a', teamName: 'Active Team', status: 'active' }),
    row({ rosterId: 'b', teamName: 'Slow Team', status: 'at_risk', lineupsSet: 7, lastActionAt: daysAgo(9) }),
    row({ rosterId: 'c', teamName: 'Gone Team', status: 'inactive', lastActionAt: daysAgo(19) }),
    row({ rosterId: 'd', teamName: 'Open Seat', status: 'inactive', lastActionAt: daysAgo(40) }),
    row({ rosterId: 'e', teamName: 'Unreadable', status: 'unknown', lineupsSet: null }),
    row({ rosterId: 'f', teamName: 'Older Gone', status: 'inactive', lastActionAt: daysAgo(30), managerName: 'viewer' }),
  ]
  it('keeps inactive and at-risk managers only, minus seats and the viewer', () => {
    const cards = managersToCheck(rows, ['Open Seat', 'viewer'], NOW)
    expect(cards.map((c) => c.rosterId)).toEqual(['c', 'b'])
  })
  it('states counted facts: empty starters and idle days', () => {
    const [gone, slow] = managersToCheck(rows, ['Open Seat', 'viewer'], NOW)
    expect(gone.issues).toEqual(['No roster move in 19 days'])
    expect(slow.issues).toEqual(['2 empty starters', 'No roster move in 9 days'])
    expect(slow.initials).toBe('ST')
  })
  it('orders inactive first, then the longest idle', () => {
    const cards = managersToCheck(rows, [], NOW)
    expect(cards.map((c) => c.rosterId)).toEqual(['d', 'f', 'c', 'b'])
  })
  it('never says "0 empty starters" when the lineup could not be read, and still names the status', () => {
    const [card] = managersToCheck([row({ status: 'at_risk', lineupsSet: null, lastActionAt: null })], [], NOW)
    expect(card.issues).toEqual(['Slowing down'])
  })
  it('initials fall back sensibly', () => {
    expect(initialsFor('Taco Tuesday')).toBe('TT')
    expect(initialsFor('Monday Night Misery')).toBe('MM')
    expect(initialsFor('🏈')).toBe('?')
  })
})

describe('season-aware checklist', () => {
  const items = buildWeeklyChecklist(
    {
      leagueId: 'lg', week: 9, totalWeeks: 17, playoffStartWeek: 15,
      lastWeekMatchups: [{ status: 'final' }], pendingClaims: [], processedClaimsLast7Days: 9,
      lineups: [{ teamName: 'Taco Tuesday', required: 9, filled: 8, unavailable: [] }],
      tradesAwaitingReview: 1, tradeDeadlineWeek: 12, dues: null,
    },
    NOW,
  )

  it('keeps the weekly checklist in its own order and adds a deadline countdown when it is further out', () => {
    const checks = buildCommishChecklist({ checklist: { applies: true, week: 9, items }, currentWeek: 9, tradeDeadlineWeek: 12 })
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ['scores', 'done'], ['waivers', 'done'], ['lineups', 'todo'], ['trades', 'todo'], ['trade_deadline_countdown', 'heads_up'],
    ])
    const countdown = checks.at(-1)!
    expect(countdown.title).toBe('Trade deadline in 3 weeks')
    expect(countdown.meta).toBe('Week 12')
    expect(checks.find((c) => c.id === 'waivers')!.detail).toContain('9 claims processed')
  })

  it('does not double the deadline when the weekly checklist already raised it', () => {
    const near = buildWeeklyChecklist(
      { leagueId: 'lg', week: 11, totalWeeks: 17, playoffStartWeek: 15, lastWeekMatchups: [], pendingClaims: [], processedClaimsLast7Days: 0, lineups: [], tradesAwaitingReview: 0, tradeDeadlineWeek: 12, dues: null },
      NOW,
    )
    const checks = buildCommishChecklist({ checklist: { applies: true, week: 11, items: near }, currentWeek: 11, tradeDeadlineWeek: 12 })
    expect(checks.filter((c) => c.id.startsWith('trade_deadline')).map((c) => [c.id, c.meta])).toEqual([['trade_deadline', 'Week 12']])
  })

  it('says the deadline passed, and drops it entirely when either number is missing', () => {
    expect(buildCommishChecklist({ checklist: null, currentWeek: 14, tradeDeadlineWeek: 12 }).map((c) => c.id)).toEqual(['trade_deadline_passed'])
    expect(buildCommishChecklist({ checklist: null, currentWeek: null, tradeDeadlineWeek: 12 })).toEqual([])
    expect(buildCommishChecklist({ checklist: null, currentWeek: 9, tradeDeadlineWeek: null })).toEqual([])
  })

  it('out of season it lists only what it can measure, and the empty reason says why', () => {
    const off = { applies: false as const, reason: 'not_in_season' as const }
    expect(buildCommishChecklist({ checklist: off, currentWeek: null, tradeDeadlineWeek: 12 })).toEqual([])
    expect(checklistEmptyReason(off)).toBe('The weekly checklist starts once the season is under way.')
    expect(checklistEmptyReason(null)).toBe('This week’s checklist could not be read right now.')
  })

  it('reads the Spanish copy the checklist already carries', () => {
    const checks = buildCommishChecklist({ checklist: { applies: true, week: 9, items }, currentWeek: 9, tradeDeadlineWeek: 12, language: 'es' })
    expect(checks[0].title).toBe('La puntuación de la semana 8 es definitiva')
    expect(checks.at(-1)!.title).toBe('El plazo de intercambios cierra en 3 semanas')
  })
})
