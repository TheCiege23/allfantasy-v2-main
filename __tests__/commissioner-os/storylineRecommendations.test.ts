/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 8 tests.
 */
import { describe, expect, it } from 'vitest'
import { generateStorylineRecommendations } from '@/lib/shared-services/league-hub/generators/commissioner/storylineRecommendations'
import { baseCommissionerOsContext, dramaEvent } from './fixtures'

describe('generateStorylineRecommendations', () => {
  it('returns nothing when the league has no real drama events yet — never fabricates a storyline', () => {
    const context = baseCommissionerOsContext({ dramaEvents: [] })
    const recs = generateStorylineRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(0)
  })

  it('is NFL-only — unsupported for a weekly-cadence-incompatible sport even with real drama rows present', () => {
    const context = baseCommissionerOsContext({
      dramaEvents: [dramaEvent()],
      unavailableDomains: ['storylines_weekly_cadence'],
    })
    const recs = generateStorylineRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(0)
  })

  it('maps a real drama event to a copy-ready storyline, preserving the real headline verbatim', () => {
    const context = baseCommissionerOsContext({ dramaEvents: [dramaEvent({ headline: 'Team Two stuns Team One' })] })
    const recs = generateStorylineRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs).toHaveLength(1)
    expect(recs[0].title).toBe('Team Two stuns Team One')
    expect(recs[0].copyReadyContent?.length).toBeGreaterThan(0)
    expect(recs[0].copyReadyContent?.every((c) => c.text.includes('Team Two stuns Team One'))).toBe(true)
  })

  it('escalates priority for a high-score drama event without inventing new facts', () => {
    const low = generateStorylineRecommendations(baseCommissionerOsContext({ dramaEvents: [dramaEvent({ dramaScore: 30 })] }), 't')
    const high = generateStorylineRecommendations(baseCommissionerOsContext({ dramaEvents: [dramaEvent({ dramaScore: 90 })] }), 't')
    expect(low[0].priority).toBe('low')
    expect(high[0].priority).toBe('medium')
  })

  it('never auto-publishes — copy-ready content is preview-only, no send action attached', () => {
    const context = baseCommissionerOsContext({ dramaEvents: [dramaEvent()] })
    const recs = generateStorylineRecommendations(context, '2026-07-12T00:00:00.000Z')
    expect(recs[0].action).toBeUndefined()
  })
})
