import { describe, expect, it } from 'vitest'
import { mergeAdpFromProviders, mergeAiAdpFromProviders } from '@/lib/providers/providerMerge'

describe('Trade context merge rules', () => {
  it('keeps AI ADP separate from pool ADP merge inputs', () => {
    const adp = mergeAdpFromProviders({ allfantasy_internal: 12, sleeper: 24 }, 'NFL')
    const ai = mergeAiAdpFromProviders({ allfantasy_internal: 18.5 }, 'NFL')
    expect(adp.source).toBe('allfantasy_internal')
    expect(ai.source).toBe('allfantasy_internal')
    expect(adp.value).not.toEqual(ai.value)
  })
})
