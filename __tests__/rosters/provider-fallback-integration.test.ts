import { describe, expect, it } from 'vitest'
import { getPrimaryProviderForDomain } from '@/lib/providers/providerFallbackPolicy'

describe('Roster-relevant fallback ordering', () => {
  it('keeps roster/trade value internal-first', () => {
    expect(getPrimaryProviderForDomain('roster_context', 'NFL')).toBe('allfantasy_internal')
    expect(getPrimaryProviderForDomain('trade_value', 'NBA')).toBe('allfantasy_internal')
  })
})
