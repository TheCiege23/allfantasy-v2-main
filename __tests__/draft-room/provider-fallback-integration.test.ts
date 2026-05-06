import { describe, expect, it } from 'vitest'
import { getFallbackProvidersForDomain, getPrimaryProviderForDomain } from '@/lib/providers/providerFallbackPolicy'

describe('Draft-relevant fallback ordering', () => {
  it('uses RI-first images then TheSportsDB then Sleeper', () => {
    const c = getFallbackProvidersForDomain('player_images', 'NFL')
    expect(c.slice(0, 3)).toEqual(['rolling_insights', 'thesportsdb', 'sleeper'])
  })

  it('uses RI-first stats with ClearSports before TheSportsDB for NFL', () => {
    expect(getPrimaryProviderForDomain('player_stats', 'NFL')).toBe('rolling_insights')
    expect(getFallbackProvidersForDomain('player_stats', 'NFL')[1]).toBe('clearsports')
    expect(getFallbackProvidersForDomain('player_stats', 'NFL')[2]).toBe('thesportsdb')
  })
})
