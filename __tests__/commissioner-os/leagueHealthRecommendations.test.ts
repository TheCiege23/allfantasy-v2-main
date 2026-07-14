/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 5 tests.
 */
import { describe, expect, it } from 'vitest'
import { generateLeagueHealthRecommendations } from '@/lib/shared-services/league-hub/generators/commissioner/leagueHealthRecommendations'
import { baseCommissionerOsContext, baseHealth, staleFreshness } from './fixtures'

describe('generateLeagueHealthRecommendations', () => {
  it('maps a healthy league to a low-priority recommendation with the real score', () => {
    const context = baseCommissionerOsContext({ health: baseHealth({ category: 'healthy', score: 92 }) })
    const recs = generateLeagueHealthRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(1)
    expect(recs[0].priority).toBe('low')
    expect(recs[0].summary).toContain('92')
  })

  it('maps a critical league to a critical-priority recommendation, never downgrading the real category', () => {
    const context = baseCommissionerOsContext({
      health: baseHealth({ category: 'critical', score: 22, issues: ['3 managers have not set a lineup in 3 weeks.'] }),
    })
    const recs = generateLeagueHealthRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs[0].priority).toBe('critical')
    expect(recs[0].rationale).toContain('3 managers have not set a lineup in 3 weeks.')
  })

  it('never fabricates a score when the health engine reports unavailable', () => {
    const context = baseCommissionerOsContext({
      health: baseHealth({ category: 'unavailable', sourceAttribution: { source: 'monitorLeagueHealth', fetchedAt: '', providerTimestamp: null, freshness: 'unknown', confidence: 0, missingDataReason: 'No standings data synced yet.' } }),
    })
    const recs = generateLeagueHealthRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs[0].summary).toBe('No standings data synced yet.')
    expect(recs[0].title).toBe('League health could not be assessed')
  })

  it('suppresses a critical-priority claim when the underlying data is stale', () => {
    const context = baseCommissionerOsContext({
      syncFreshness: staleFreshness(),
      health: baseHealth({ category: 'critical', score: 10 }),
    })
    const recs = generateLeagueHealthRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(0)
  })

  it('two differently-healthy leagues produce two genuinely different recommendations', () => {
    const healthy = generateLeagueHealthRecommendations(
      baseCommissionerOsContext({ health: baseHealth({ category: 'healthy', score: 95 }) }),
      '2026-07-12T00:00:00.000Z'
    )
    const declining = generateLeagueHealthRecommendations(
      baseCommissionerOsContext({ health: baseHealth({ category: 'attention_required', score: 40, issues: ['Retention risk elevated.'] }) }),
      '2026-07-12T00:00:00.000Z'
    )
    expect(healthy[0].priority).not.toBe(declining[0].priority)
    expect(healthy[0].summary).not.toBe(declining[0].summary)
  })
})
