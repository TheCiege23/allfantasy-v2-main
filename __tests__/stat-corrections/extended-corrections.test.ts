/**
 * Extended scoring corrections (lib/stat-corrections/extendedCorrections.ts): what gets applied, and
 * that re-checks never apply a correction twice.
 */
import { describe, expect, it } from 'vitest'
import { appliedCorrection, correctionApplyRefusal, planCorrectionAdjustments, readExtendedCorrections, STAT_CORRECTION_ACTOR } from '@/lib/stat-corrections/extendedCorrections'
import type { MatchupCorrection } from '@/lib/stat-corrections/statCorrectionReview'
import { statCorrectionApplied, type ScoreAdjustment } from '@/lib/score-adjustments/scoreAdjustments'

const m = (homeAfter: number, awayAfter: number): MatchupCorrection => ({
  matchupId: 'M1', home: { rosterId: 'H', before: 100, after: homeAfter }, away: { rosterId: 'A', before: 98, after: awayAfter }, resultFlipped: homeAfter < awayAfter,
})
const adj = (rosterId: string, points: number, byUserId = STAT_CORRECTION_ACTOR): ScoreAdjustment => ({
  id: `${rosterId}${points}`, matchupId: 'M1', rosterId, week: 3, points, reason: 'x', byUserId, at: '2026-10-01T00:00:00Z',
})

describe('planCorrectionAdjustments', () => {
  it('first sight: each corrected team is adjusted by its full change; an unchanged side is left alone', () => {
    expect(planCorrectionAdjustments([m(96.5, 98)], [])).toEqual([{ matchupId: 'M1', rosterId: 'H', points: -3.5 }])
  })

  it('a re-check of the same correction owes nothing', () => {
    expect(planCorrectionAdjustments([m(96.5, 98)], [adj('H', -3.5)])).toEqual([])
  })

  it('a second correction to the same week adds only itself', () => {
    expect(planCorrectionAdjustments([m(95, 99.2)], [adj('H', -3.5)])).toEqual([
      { matchupId: 'M1', rosterId: 'H', points: -1.5 },
      { matchupId: 'M1', rosterId: 'A', points: 1.2 },
    ])
  })

  it('a commissioner\'s own adjustment is not mistaken for an applied correction', () => {
    expect(appliedCorrection([adj('H', -5, 'commish-user')], 'M1', 'H')).toBe(0)
    expect(planCorrectionAdjustments([m(96.5, 98)], [adj('H', -5, 'commish-user')])).toEqual([{ matchupId: 'M1', rosterId: 'H', points: -3.5 }])
  })
})

describe('the commissioner\'s Apply and the automatic path count each other', () => {
  const manual = (rosterId: string, points: number): ScoreAdjustment => ({ ...adj(rosterId, points, 'commish-user'), source: 'stat_correction' })

  it('a correction the commissioner already applied is not applied again automatically', () => {
    expect(appliedCorrection([manual('H', -3.5)], 'M1', 'H')).toBe(-3.5)
    expect(planCorrectionAdjustments([m(96.5, 98)], [manual('H', -3.5)])).toEqual([])
  })

  it('an automatic correction counts toward what the commissioner\'s Apply owes', () => {
    expect(statCorrectionApplied([adj('H', -3.5)], 'M1', 'H')).toBe(-3.5)
    expect(statCorrectionApplied([adj('H', -3.5), manual('H', -1.5), adj('H', -5, 'commish-user')], 'M1', 'H')).toBe(-5)
  })
})

describe('switch and refusals', () => {
  it('off unless switched on', () => {
    expect(readExtendedCorrections({})).toBe(false)
    expect(readExtendedCorrections({ stat_corrections_extended: true })).toBe(true)
  })

  it('never rewrites a week in an elimination format, or once the playoffs have started', () => {
    expect(correctionApplyRefusal({ leagueVariant: 'guillotine', guillotineMode: null }, 'in_season')).toBe('elimination_format')
    expect(correctionApplyRefusal({ leagueVariant: null, guillotineMode: true }, 'in_season')).toBe('elimination_format')
    expect(correctionApplyRefusal({ leagueVariant: 'survivor', guillotineMode: false }, 'in_season')).toBe('elimination_format')
    expect(correctionApplyRefusal({ leagueVariant: 'redraft', guillotineMode: false }, 'playoffs')).toBe('playoffs')
    expect(correctionApplyRefusal({ leagueVariant: 'redraft', guillotineMode: false }, 'in_season')).toBeNull()
  })
})
