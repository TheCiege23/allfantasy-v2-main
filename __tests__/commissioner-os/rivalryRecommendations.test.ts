/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 9 tests.
 */
import { describe, expect, it } from 'vitest'
import { generateRivalryRecommendations } from '@/lib/shared-services/league-hub/generators/commissioner/rivalryRecommendations'
import { baseCommissionerOsContext, rivalry } from './fixtures'

describe('generateRivalryRecommendations', () => {
  it('is unavailable when the league has zero recorded rivalry history — never fabricates a rivalry from this week alone', () => {
    const context = baseCommissionerOsContext({ rivalries: [], unavailableDomains: ['rivalries_history'] })
    const recs = generateRivalryRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(0)
  })

  it('marks sourceHistoryConfidence "complete" only with real, substantial event history', () => {
    const context = baseCommissionerOsContext({ rivalries: [rivalry({ eventCount: 5 })] })
    const recs = generateRivalryRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs[0].sourceHistoryConfidence).toBe('complete')
  })

  it('marks sourceHistoryConfidence "partial" for thin history, "unknown" for zero events', () => {
    const partial = generateRivalryRecommendations(baseCommissionerOsContext({ rivalries: [rivalry({ eventCount: 1 })] }), 't')
    const unknown = generateRivalryRecommendations(baseCommissionerOsContext({ rivalries: [rivalry({ eventCount: 0, latestEvent: null })] }), 't')
    expect(partial[0].sourceHistoryConfidence).toBe('partial')
    expect(unknown[0].sourceHistoryConfidence).toBe('unknown')
  })

  it('output changes with real history — a different rivalry score/tier produces different content', () => {
    const a = generateRivalryRecommendations(baseCommissionerOsContext({ rivalries: [rivalry({ rivalryScore: 95, rivalryTier: 'blood_feud' })] }), 't')
    const b = generateRivalryRecommendations(baseCommissionerOsContext({ rivalries: [rivalry({ rivalryScore: 20, rivalryTier: 'developing' })] }), 't')
    expect(a[0].title).not.toBe(b[0].title)
  })

  it('caps at the top 3 rivalries by score', () => {
    const context = baseCommissionerOsContext({
      rivalries: [
        rivalry({ id: 'r1', rivalryScore: 90 }),
        rivalry({ id: 'r2', rivalryScore: 80 }),
        rivalry({ id: 'r3', rivalryScore: 70 }),
        rivalry({ id: 'r4', rivalryScore: 60 }),
      ],
    })
    const recs = generateRivalryRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(3)
  })

  it('references only real manager ids as affected managers, never fabricated names', () => {
    const context = baseCommissionerOsContext({ rivalries: [rivalry({ managerAId: 'real-manager-a', managerBId: 'real-manager-b' })] })
    const recs = generateRivalryRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs[0].affectedManagerIds).toEqual(['real-manager-a', 'real-manager-b'])
  })
})
