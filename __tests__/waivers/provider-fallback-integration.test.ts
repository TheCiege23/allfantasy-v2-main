import { describe, expect, it } from 'vitest'
import { getFallbackProvidersForDomain } from '@/lib/providers/providerFallbackPolicy'

describe('Waiver-relevant fallback ordering', () => {
  it('prioritizes RI injuries then ClearSports for NFL', () => {
    const c = getFallbackProvidersForDomain('injuries', 'NFL')
    expect(c[0]).toBe('rolling_insights')
    expect(c[1]).toBe('clearsports')
  })
})
