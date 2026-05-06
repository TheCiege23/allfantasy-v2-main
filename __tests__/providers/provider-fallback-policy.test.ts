import { describe, expect, it } from 'vitest'
import {
  getFallbackProvidersForDomain,
  getPrimaryProviderForDomain,
  isFantasyInternalDomain,
  isHigherTierThan,
  shouldProviderFillGap,
} from '@/lib/providers/providerFallbackPolicy'

describe('providerFallbackPolicy', () => {
  it('places Rolling Insights first for NFL player_stats', () => {
    expect(getPrimaryProviderForDomain('player_stats', 'NFL')).toBe('rolling_insights')
    expect(getFallbackProvidersForDomain('player_stats', 'NFL')[0]).toBe('rolling_insights')
    expect(getFallbackProvidersForDomain('player_stats', 'NFL')).toEqual(
      expect.arrayContaining(['clearsports', 'thesportsdb']),
    )
  })

  it('keeps AllFantasy internal first for ADP and exclusive for AI ADP', () => {
    expect(getPrimaryProviderForDomain('adp', 'NFL')).toBe('allfantasy_internal')
    expect(getPrimaryProviderForDomain('ai_adp', 'NBA')).toBe('allfantasy_internal')
    expect(getFallbackProvidersForDomain('ai_adp', 'MLB')).toEqual(['allfantasy_internal'])
    expect(isFantasyInternalDomain('ai_adp')).toBe(true)
  })

  it('does not allow replacing non-empty without stale/low-confidence metadata', () => {
    expect(
      shouldProviderFillGap('clearsports', 'player_stats', 42, 99, undefined),
    ).toBe(false)
    expect(
      shouldProviderFillGap('clearsports', 'player_stats', null, 99, undefined),
    ).toBe(true)
    expect(
      shouldProviderFillGap('clearsports', 'injuries', 'Q', 'OUT', { staleCurrent: true }),
    ).toBe(true)
  })

  it('ranks rolling_insights above clearsports for same domain', () => {
    expect(
      isHigherTierThan('rolling_insights', 'clearsports', 'injuries', 'NFL'),
    ).toBe(true)
  })
})
