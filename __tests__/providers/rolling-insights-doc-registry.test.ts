import { describe, expect, it } from 'vitest'

import { ROLLING_INSIGHTS_DOCS_REGISTRY } from '@/lib/providers/rollingInsightsDocsRegistry'

describe('rollingInsightsDocsRegistry', () => {
  it('NFL entry uses mapped_with_sleeper_rookie_fallback', () => {
    const nfl = ROLLING_INSIGHTS_DOCS_REGISTRY.find((e) => e.sport === 'NFL')
    expect(nfl).toBeDefined()
    expect(nfl!.status).toBe('mapped_with_sleeper_rookie_fallback')
    expect(nfl!.rookieFallback).toBe('sleeper_years_exp')
    expect(nfl!.missingFromDoc).toEqual(
      expect.arrayContaining(['rookie', 'draftYear', 'yearsExperience']),
    )
    expect(nfl!.mappedDomains).toEqual(expect.arrayContaining(['player_info', 'play_by_play']))
  })
})
