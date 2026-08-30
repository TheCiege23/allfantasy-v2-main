import { describe, expect, it } from 'vitest'

import { reduceCrosswalk } from '@/lib/core-app/crosswalkRules'

/*
 * This guard stands between an ESPN roster and the wrong player's projection.
 * `PlayerIdentityMap` makes only `sleeperId` unique — the provider id columns
 * are not — so two rows can share one `espnId` while pointing at different
 * athletes. The screen prices whatever this returns and feeds it to a
 * win-probability model, so a wrong bridge is worse than no bridge.
 */
describe('reduceCrosswalk', () => {
  it('maps an id that resolves to exactly one target', () => {
    const m = reduceCrosswalk([
      { from: '4362628', to: '7564' },
      { from: '14880', to: '1166' },
    ])
    expect(m.get('4362628')).toBe('7564')
    expect(m.get('14880')).toBe('1166')
    expect(m.size).toBe(2)
  })

  /* ⚠ THE LOAD-BEARING ONE. Two targets for one source is a disagreement about
     who the player IS, and picking either would be a silent fabrication. */
  it('drops an id that resolves to two different targets', () => {
    const m = reduceCrosswalk([
      { from: '4362628', to: '7564' },
      { from: '4362628', to: '9999' },
      { from: '14880', to: '1166' },
    ])
    expect(m.has('4362628')).toBe(false)
    expect(m.get('14880')).toBe('1166')
  })

  it('stays dropped even if the good row repeats after the conflict', () => {
    const m = reduceCrosswalk([
      { from: 'a', to: '1' },
      { from: 'a', to: '2' },
      { from: 'a', to: '1' },
    ])
    expect(m.has('a')).toBe(false)
  })

  /* A duplicate is one fact stated twice, not a conflict — refusing it would
     throw away good bridges for nothing. */
  it('keeps an id repeated with the SAME target', () => {
    const m = reduceCrosswalk([
      { from: 'a', to: '1' },
      { from: 'a', to: '1' },
    ])
    expect(m.get('a')).toBe('1')
  })

  it('ignores rows missing either side, and trims', () => {
    const m = reduceCrosswalk([
      { from: null, to: '1' },
      { from: 'b', to: null },
      { from: '  ', to: '1' },
      { from: 'c', to: '   ' },
      { from: ' d ', to: ' 2 ' },
    ])
    expect(m.size).toBe(1)
    expect(m.get('d')).toBe('2')
  })
})
