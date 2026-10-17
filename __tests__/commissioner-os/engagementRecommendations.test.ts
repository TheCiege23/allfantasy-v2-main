/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 6 tests.
 */
import { describe, expect, it } from 'vitest'
import { generateEngagementRecommendations } from '@/lib/shared-services/league-hub/generators/commissioner/engagementRecommendations'
import { baseCommissionerOsContext, baseAttentionItem, baseShared } from './fixtures'

describe('generateEngagementRecommendations', () => {
  it('never recommends artificial engagement when there is no real evidence', () => {
    const context = baseCommissionerOsContext({ attentionItems: [] })
    const recs = generateEngagementRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(0)
  })

  it('excludes lineup_attention_carryover items — those belong to the User OS lineup domain', () => {
    const context = baseCommissionerOsContext({
      attentionItems: [baseAttentionItem({ reasonCode: 'lineup_attention_carryover', category: 'lineup' })],
    })
    const recs = generateEngagementRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(0)
  })

  it('maps a real attention item to a league-wide engagement recommendation', () => {
    const context = baseCommissionerOsContext({
      attentionItems: [baseAttentionItem({ category: 'manager_engagement_risk', message: 'This team has gone inactive', severity: 'high' })],
    })
    const recs = generateEngagementRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(1)
    expect(recs[0].priority).toBe('high')
    expect(recs[0].publicationAudience).toBe('commissioner_only')
  })

  it('suppresses a manager_engagement_risk item for a snapshot-only (CSV) league — cannot prove an ongoing pattern from one upload', () => {
    const context = baseCommissionerOsContext({
      isSnapshotOnly: true,
      attentionItems: [baseAttentionItem({ category: 'manager_engagement_risk', message: 'This team has gone inactive', severity: 'high' })],
    })
    const recs = generateEngagementRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(0)
  })

  it('does NOT suppress a non-activity-trend attention item for a snapshot-only league', () => {
    const context = baseCommissionerOsContext({
      isSnapshotOnly: true,
      // Any non-activity-trend category. Not `league_requires_review`: that one is excluded outright,
      // because it duplicates a Mission Control action (see the test below).
      attentionItems: [baseAttentionItem({ category: 'low_league_health', message: 'League health needs attention' })],
    })
    const recs = generateEngagementRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(1)
  })

  it('surfaces real Mission Control recommended actions', () => {
    const context = baseCommissionerOsContext({
      shared: baseShared({
        missionControl: {
          leagueId: 'league-1',
          activity: { tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 },
          managersAtRetentionRisk: [],
          recommendedActions: [{ priority: 'urgent', message: 'Two managers have not accepted their invite.' }],
          fieldProvenance: null,
        },
      }),
    })
    const recs = generateEngagementRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs.some((r) => r.type === 'mission_control_action' && r.priority === 'high')).toBe(true)
  })

  /*
   * Seen 2026-10-01: one recommended action became TWO cards — "Recommended review" / "Recommended
   * review", and the real advice. `CommissionerAttentionService` turns each Mission Control action into a
   * `league_requires_review` signal whose title is generic and whose advice sits in evidence, and the
   * same action is mapped again as `mission_control_action`.
   */
  it('maps each recommended action once, under its real text, with a summary that is not the title', () => {
    const action = { priority: 'standard' as const, message: 'Two managers have not set a lineup in three weeks.' }
    const context = baseCommissionerOsContext({
      attentionItems: [
        baseAttentionItem({ category: 'league_requires_review', message: 'Recommended review', evidence: [action.message], recommendedAction: null }),
      ],
      shared: baseShared({
        missionControl: {
          leagueId: 'league-1',
          activity: { tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 },
          managersAtRetentionRisk: [],
          recommendedActions: [action],
          fieldProvenance: null,
        },
      }),
    })
    const recs = generateEngagementRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(1)
    expect(recs[0].type).toBe('mission_control_action')
    expect(recs[0].title).toBe(action.message)
    expect(recs[0].summary).not.toBe(recs[0].title)
    expect(recs.some((r) => r.title === 'Recommended review')).toBe(false)
  })
})
