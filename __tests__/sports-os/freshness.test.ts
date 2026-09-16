import { describe, expect, it } from 'vitest'
import {
  combineFreshness,
  describeFreshness,
  emptyFreshness,
  fresh,
  freshnessLabel,
  isStale,
  mapFresh,
  shouldWarnAboutFreshness,
  withSource,
} from '@/lib/sports-os/freshness'

const NOW = 1_700_000_000_000

describe('sports-os freshness', () => {
  it('treats a null TTL as never stale and a real TTL as stale past it', () => {
    const immutable = fresh('geocode', { fetchedAt: NOW - 400 * 86_400_000, staleAfterMs: null })
    expect(isStale(immutable, NOW)).toBe(false)

    const ttl = fresh('scores', { fetchedAt: NOW - 61_000, staleAfterMs: 60_000 })
    expect(isStale(ttl, NOW)).toBe(true)
    expect(isStale({ ...ttl, fetchedAt: NOW - 59_000 }, NOW)).toBe(false)
  })

  it('labels ages coarsely', () => {
    expect(freshnessLabel({ fetchedAt: NOW - 1_000 }, NOW)).toBe('just now')
    expect(freshnessLabel({ fetchedAt: NOW - 4 * 60_000 }, NOW)).toBe('4m ago')
    expect(freshnessLabel({ fetchedAt: NOW - 2 * 3_600_000 }, NOW)).toBe('2h ago')
    expect(freshnessLabel({ fetchedAt: NOW - 3 * 86_400_000 }, NOW)).toBe('3d ago')
    // Never fetched must not read as infinitely old in the UI.
    expect(freshnessLabel({ fetchedAt: 0 }, NOW)).toBe('never')
  })

  it('warns about last-known even when it is young', () => {
    // `last-known` means a refresh FAILED. The user is entitled to know that at 30 seconds old.
    const young = withSource(fresh(1, { fetchedAt: NOW - 30_000, staleAfterMs: 300_000 }), 'last-known')
    expect(isStale(young, NOW)).toBe(false)
    expect(shouldWarnAboutFreshness(young, NOW)).toBe(true)

    const liveYoung = fresh(1, { fetchedAt: NOW - 30_000, staleAfterMs: 300_000 })
    expect(shouldWarnAboutFreshness(liveYoung, NOW)).toBe(false)

    expect(shouldWarnAboutFreshness(emptyFreshness(60_000), NOW)).toBe(true)
  })

  it('combines to the OLDEST timestamp and the WEAKEST source', () => {
    // One fresh value must not launder five stale ones — the whole reason this is conservative.
    const combined = combineFreshness([
      fresh('a', { fetchedAt: NOW, staleAfterMs: 600_000 }),
      withSource(fresh('b', { fetchedAt: NOW - 900_000, staleAfterMs: 60_000 }), 'last-known'),
      withSource(fresh('c', { fetchedAt: NOW - 100_000, staleAfterMs: null }), 'cache'),
    ])
    expect(combined.fetchedAt).toBe(NOW - 900_000)
    expect(combined.source).toBe('last-known')
    // A null TTL must not beat a real one, or the combined value would never report as stale.
    expect(combined.staleAfterMs).toBe(60_000)
  })

  it('keeps a null TTL only when every input has one', () => {
    const combined = combineFreshness([
      fresh('a', { fetchedAt: NOW, staleAfterMs: null }),
      fresh('b', { fetchedAt: NOW, staleAfterMs: null }),
    ])
    expect(combined.staleAfterMs).toBeNull()
  })

  it('preserves fetchedAt across a source relabel and a map', () => {
    // The age must survive a cache hop; re-stamping it here is how a stale value becomes immortal.
    const original = fresh({ n: 1 }, { fetchedAt: NOW - 5_000, staleAfterMs: 60_000 })
    expect(withSource(original, 'cache').fetchedAt).toBe(NOW - 5_000)
    const mapped = mapFresh(original, (v) => v.n + 1)
    expect(mapped.data).toBe(2)
    expect(mapped.fetchedAt).toBe(NOW - 5_000)
    expect(mapped.staleAfterMs).toBe(60_000)
  })

  it('describes an envelope with the derived fields a card renders', () => {
    const view = describeFreshness(fresh('x', { fetchedAt: NOW - 120_000, staleAfterMs: 60_000 }), NOW)
    expect(view).toMatchObject({ ageMs: 120_000, isStale: true, label: '2m ago', data: 'x' })
  })
})
