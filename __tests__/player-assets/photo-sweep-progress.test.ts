import { describe, expect, it } from 'vitest'
import { readPhotoSweepCursor, readPhotoSweepPage, advancePhotoSweepCursor } from '@/lib/player-assets/photoSweepProgress'
describe('photo backfill progress', () => {
  const all = ['a', 'b', 'c', 'd']
  const read = async (range: {gt?: string; lte?: string}, take: number) => all.filter(id => (!range.gt || id > range.gt) && (!range.lte || id <= range.lte)).slice(0, take)
  it('advances past unresolved photos and wraps without losing them', async () => {
    expect(await readPhotoSweepPage('b', 3, read)).toEqual(['c', 'd', 'a'])
  })
  it('advances only through attempted players when the budget ends mid-batch', () => {
    const before = { priority: null, general: 'z' }
    expect(advancePhotoSweepCursor(before, ['a', 'b'], all, 'a')).toEqual({ priority: 'a', general: 'z' })
    expect(advancePhotoSweepCursor(before, ['a', 'b'], all, 'c')).toEqual({ priority: 'b', general: 'c' })
    expect(advancePhotoSweepCursor(before, ['a', 'b'], all)).toEqual(before)
  })
  it('rejects malformed saved state', () => {
    expect(readPhotoSweepCursor({ priority: 1, general: {} })).toEqual({ priority: null, general: null })
  })
})
