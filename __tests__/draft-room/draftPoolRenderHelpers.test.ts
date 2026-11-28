/**
 * The draft room stops redoing whole-pool work (lib/draft-room/draftPoolRenderHelpers.ts, 2026-11-28).
 */
import { describe, expect, it } from 'vitest'
import { draftRowIdentityKey, draftRowIdentitySet, isSameCachedDraftPool } from '@/lib/draft-room/draftPoolRenderHelpers'

describe('draftRowIdentitySet keeps exactly the rows the old .some() check kept', () => {
  // Deterministic pseudo-random pool with repeated names across positions and duplicates.
  let seed = 42
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const names = ['Jayden Reid', 'Chris Smith', 'Money Williams', "D'Angelo Núñez", 'A', '']
  const positions = ['G', 'F', 'C', 'G/F', '']
  const pool = Array.from({ length: 600 }, (_, i) => ({
    // Half share a few names (duplicates across positions), half are unique players.
    name: i % 2 ? `Player ${i}` : names[Math.floor(rand() * names.length)]!,
    position: positions[Math.floor(rand() * positions.length)]!,
  }))
  const filtered = pool.filter(() => rand() < 0.4)

  it('matches row for row', () => {
    const set = draftRowIdentitySet(filtered)
    const viaSet = pool.map((p) => set.has(draftRowIdentityKey(p)))
    const viaSome = pool.map((p) => filtered.some((d) => d.name === p.name && d.position === p.position))
    expect(viaSet).toEqual(viaSome)
    expect(viaSome.some(Boolean)).toBe(true)
    expect(viaSome.some((x) => !x)).toBe(true)
  })

  it('the same name at another position is a different row', () => {
    const set = draftRowIdentitySet([{ name: 'Jayden Reid', position: 'G' }])
    expect(set.has(draftRowIdentityKey({ name: 'Jayden Reid', position: 'G' }))).toBe(true)
    expect(set.has(draftRowIdentityKey({ name: 'Jayden Reid', position: 'F' }))).toBe(false)
  })

  it('does not confuse a name and position that run together', () => {
    const set = draftRowIdentitySet([{ name: 'AB', position: 'C' }])
    expect(set.has(draftRowIdentityKey({ name: 'A', position: 'BC' }))).toBe(false)
  })
})

describe('isSameCachedDraftPool', () => {
  const pool = (cacheKey: string | undefined, cachedAt: string | null | undefined, n = 3) => ({
    entries: Array.from({ length: n }, (_, i) => ({ i })),
    meta: { cacheKey, cachedAt, source: 'db-cache' },
  })

  it('is the same copy when key, time and count all match', () => {
    expect(isSameCachedDraftPool(pool('k', '2026-11-28T05:41:32.133Z'), pool('k', '2026-11-28T05:41:32.133Z'))).toBe(true)
  })
  it('a rebuilt copy (new cachedAt) is applied', () => {
    expect(isSameCachedDraftPool(pool('k', '2026-11-28T05:11:03.934Z'), pool('k', '2026-11-28T05:41:32.133Z'))).toBe(false)
  })
  it('a different count is applied', () => {
    expect(isSameCachedDraftPool(pool('k', 't', 2392), pool('k', 't', 5022))).toBe(false)
  })
  it('a different cache key is applied', () => {
    expect(isSameCachedDraftPool(pool('a', 't'), pool('b', 't'))).toBe(false)
  })
  it('never same without a key or time on both sides', () => {
    expect(isSameCachedDraftPool(pool(undefined, 't'), pool(undefined, 't'))).toBe(false)
    expect(isSameCachedDraftPool(pool('k', null), pool('k', null))).toBe(false)
    expect(isSameCachedDraftPool(null, pool('k', 't'))).toBe(false)
    expect(isSameCachedDraftPool({ entries: [] }, { entries: [] })).toBe(false)
  })
})
