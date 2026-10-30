import { describe, expect, it } from 'vitest'
import { draftPoolBuildKey, shareDraftPoolBuild } from '@/lib/draft-room/shareDraftPoolBuild'

describe('concurrent draft pool builds', () => {
  it('shares a build across prewarm and API callers and releases it after completion', async () => {
    let calls = 0
    let finish!: (value: number) => void
    const build = () => { calls++; return new Promise<number>(resolve => { finish = resolve }) }
    const a = shareDraftPoolBuild('same-league', build)
    const b = shareDraftPoolBuild('same-league', build)
    expect(a).toBe(b)
    await Promise.resolve()
    expect(calls).toBe(1)
    finish(42)
    expect(await b).toBe(42)
    expect(await shareDraftPoolBuild('same-league', async () => 43)).toBe(43)
  })

  it('allows retry after a rejected build and does not share different configurations', async () => {
    await expect(shareDraftPoolBuild('failure', async () => { throw new Error('db unavailable') })).rejects.toThrow('db unavailable')
    expect(await shareDraftPoolBuild('failure', async () => 'recovered')).toBe('recovered')
    const standard = draftPoolBuildKey('league', { limit: 300, poolType: null, excludeDraftedPlayerIds: new Set(['one']) })
    const changed = draftPoolBuildKey('league', { limit: 300, poolType: null, excludeDraftedPlayerIds: new Set(['two']) })
    expect(changed).not.toBe(standard)
    expect(draftPoolBuildKey('other-league', {})).not.toBe(draftPoolBuildKey('league', {}))
  })

  it('compares roster position sets and object keys by value rather than insertion order', () => {
    expect(draftPoolBuildKey('league', { allowed: new Set(['C', 'LW']), limit: 300 }))
      .toBe(draftPoolBuildKey('league', { limit: 300, allowed: new Set(['LW', 'C']) }))
    expect(draftPoolBuildKey('league', { template: { starterSlots: { C: 2 } } }))
      .not.toBe(draftPoolBuildKey('league', { template: { starterSlots: { C: 3 } } }))
  })
})
