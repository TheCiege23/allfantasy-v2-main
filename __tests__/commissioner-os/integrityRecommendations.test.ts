/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 12 tests.
 */
import { describe, expect, it } from 'vitest'
import { generateIntegrityRecommendations } from '@/lib/shared-services/league-hub/generators/commissioner/integrityRecommendations'
import { baseCommissionerOsContext, baseHealth } from './fixtures'

describe('generateIntegrityRecommendations', () => {
  it('returns nothing when health issues contain no activity/abandonment concern keywords', () => {
    const context = baseCommissionerOsContext({ health: baseHealth({ issues: ['Scoring settings changed mid-season.'] }) })
    const recs = generateIntegrityRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(0)
  })

  it('reframes a real abandonment-flavored health issue with cautious language, never a fact-stated accusation', () => {
    const context = baseCommissionerOsContext({ health: baseHealth({ issues: ['Team 4 has an abandoned roster.'] }) })
    const recs = generateIntegrityRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(1)
    expect(recs[0].title).toBe('Review recommended')
    expect(recs[0].summary).toContain('Possible integrity concern')
    expect(recs[0].summary.toLowerCase()).not.toContain('confirmed')
    expect(recs[0].governanceSeverity).toBe('review_recommended')
    expect(recs[0].humanReviewRequired).toBe(true)
  })

  it('never calls tanking/collusion detection — only reframes real health-engine text', () => {
    const context = baseCommissionerOsContext({ health: baseHealth({ issues: ['3 managers have missed lineup deadlines.'] }) })
    const recs = generateIntegrityRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs[0].evidence[0].source).toBe('monitorLeagueHealth')
  })

  it('suppresses integrity recommendations entirely for a snapshot-only (CSV) league — a one-time upload cannot prove a repeated pattern', () => {
    const context = baseCommissionerOsContext({
      isSnapshotOnly: true,
      health: baseHealth({ issues: ['Team 4 has an abandoned roster.', '2 managers are inactive.'] }),
    })
    const recs = generateIntegrityRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(0)
  })

  it('produces multiple review-recommended entries for multiple real concerns', () => {
    const context = baseCommissionerOsContext({
      health: baseHealth({ issues: ['Team 2 roster looks abandoned.', 'Team 5 has missed 3 straight lineups.'] }),
    })
    const recs = generateIntegrityRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(2)
  })
})
