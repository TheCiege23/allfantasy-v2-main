/**
 * `buildAllFantasyProjection` discounts a player by his injury designation. The classifier used to be a
 * substring scan — `includes('ir')`, `includes('out')` — so a designation whose text merely CONTAINED
 * those letters ("Questionable - Virus", "Questionable (without brace)") was projected as Out: zero this
 * week, x0.62 rest of season. These pin the multiplier per designation, matched as words through the
 * shared `isRuledOut` / `isHealthyDesignation` rules.
 */
import { describe, expect, it } from 'vitest'
import { buildAllFantasyProjection } from '@/lib/redraft/projectionEngine'
import { isOutDesignation, isRosterAbsence, isRuledOut } from '@/lib/core-app/injuryStatus'

const BASE = 20

function weeklyFor(injuryStatus: string | null): number | null {
  return buildAllFantasyProjection({
    playerId: 'p1',
    playerName: 'Test WR',
    sport: 'NFL',
    position: 'WR',
    currentWeek: 6,
    totalWeeks: 17,
    providerWeeklyProjection: BASE,
    injuryStatus,
  }).weeklyProjection
}

describe('projectionEngine injury profile — words, not letter runs', () => {
  it.each([
    ['Questionable - Virus', 0.78],
    ['Questionable (playing without brace)', 0.78],
    ['Doubtful - Groin', 0.35],
    ['Probable - Wrist', 0.94],
  ])('%s is not an absence (x%s), however its letters read', (status, multiplier) => {
    expect(weeklyFor(status)).toBeCloseTo(BASE * multiplier, 1)
  })

  it.each([
    'Out',
    'IR',
    'Injured Reserve',
    'I.L.',
    '60-Day IL',
    'Suspension',
    'Susp',
    'SUSP',
    'Sus',
    'PUP',
    'Physically Unable to Perform',
    'Inactive',
    'Out (Hamstring)',
  ])(
    '%s zeroes the week',
    (status) => {
      expect(weeklyFor(status)).toBe(0)
    },
  )

  it.each(['Active', 'ACT', 'INACT', 'Practice Squad', 'Healthy', 'NA', null])('%s is no designation — no discount', (status) => {
    expect(weeklyFor(status)).toBe(BASE)
  })

  it('keeps the existing multipliers for genuine designations', () => {
    expect(weeklyFor('Questionable')).toBeCloseTo(BASE * 0.78, 1)
    expect(weeklyFor('Q')).toBeCloseTo(BASE * 0.78, 1)
    expect(weeklyFor('Doubtful')).toBeCloseTo(BASE * 0.35, 1)
    expect(weeklyFor('Probable')).toBeCloseTo(BASE * 0.94, 1)
    // An unrecognised word on the report is still a risk, not an absence.
    expect(weeklyFor('Hamstring')).toBeCloseTo(BASE * 0.88, 1)
  })
})

describe('isRuledOut — the abbreviated suspension spellings', () => {
  it.each(['Susp', 'SUSP', 'Sus', 'sus.', 'Suspended', 'Suspension'])('%s is ruled out, as a season-scale absence', (status) => {
    expect(isRuledOut(status)).toBe(true)
    expect(isOutDesignation(status)).toBe(false)
    expect(isRosterAbsence(status)).toBe(true)
  })

  it.each(['Suspicious', 'Sustained', 'Questionable'])('%s is not', (status) => {
    expect(isRuledOut(status)).toBe(false)
  })
})
