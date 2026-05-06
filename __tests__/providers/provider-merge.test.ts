import { describe, expect, it } from 'vitest'
import { mergeAdpFromProviders, mergeAiAdpFromProviders, mergeProviderValue } from '@/lib/providers/providerMerge'

describe('providerMerge', () => {
  it('uses first non-empty by chain order (RI before ClearSports)', () => {
    const m = mergeProviderValue(
      'yds',
      { rolling_insights: 100, clearsports: 200 },
      'player_stats',
      'NFL',
    )
    expect(m.value).toBe(100)
    expect(m.source).toBe('rolling_insights')
    expect(m.fallbackUsed).toBe(false)
  })

  it('falls back when Rolling Insights missing', () => {
    const m = mergeProviderValue(
      'yds',
      { rolling_insights: null, clearsports: 88 },
      'player_stats',
      'NFL',
    )
    expect(m.value).toBe(88)
    expect(m.source).toBe('clearsports')
    expect(m.fallbackUsed).toBe(true)
  })

  it('ADP prefers internal then Sleeper — ignores TSDB unless explicit in merge input', () => {
    const m = mergeAdpFromProviders(
      {
        allfantasy_internal: null,
        sleeper: 42,
        thesportsdb: 7,
      },
      'NFL',
    )
    expect(m.value).toBe(42)
    expect(m.source).toBe('sleeper')
  })

  it('AI ADP only accepts internal bucket', () => {
    const m = mergeAiAdpFromProviders({ allfantasy_internal: 15.2, sleeper: 99 }, 'NFL')
    expect(m.value).toBe(15.2)
    expect(m.source).toBe('allfantasy_internal')
  })
})
