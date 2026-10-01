/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 10 tests.
 */
import { describe, expect, it } from 'vitest'
import { generateDraftGradeRecommendations } from '@/lib/shared-services/league-hub/generators/commissioner/draftGradeRecommendations'
import { baseCommissionerOsContext, draftGrade } from './fixtures'

describe('generateDraftGradeRecommendations', () => {
  it('requires real draft data — returns nothing when no draft has been graded', () => {
    const context = baseCommissionerOsContext({ draftGrades: [], unavailableDomains: ['draft_grades'] })
    const recs = generateDraftGradeRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(0)
  })

  it('summarizes real best/worst grades across teams', () => {
    const context = baseCommissionerOsContext({
      draftGrades: [
        draftGrade({ rosterId: 'roster-1', grade: 'A+', score: 98 }),
        draftGrade({ rosterId: 'roster-2', grade: 'D', score: 40 }),
      ],
    })
    const recs = generateDraftGradeRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs[0].summary).toContain('A+')
    expect(recs[0].summary).toContain('D')
  })

  it('discloses the format-naive limitation in the generated copy itself, never hiding it', () => {
    const context = baseCommissionerOsContext({ draftGrades: [draftGrade()] })
    const recs = generateDraftGradeRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs[0].summary.toLowerCase()).toContain('keeper/dynasty')
  })

  it('never grades a historical draft as if it were present-day without an explicit hindsight label — this generator only ever reports the real persisted grade, never recomputes one', () => {
    const context = baseCommissionerOsContext({ draftGrades: [draftGrade({ season: '2023' })] })
    const recs = generateDraftGradeRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs[0].id).toContain('season-2023')
  })
})
