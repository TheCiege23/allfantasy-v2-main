import { describe, expect, it } from 'vitest'

import { createSwrCache } from '@/lib/core-app/staleWhileRevalidate'

/*
 * The per-player card cache's engine: serve what we have, refresh behind the
 * request, share one load among everyone asking at once, and never let a
 * background refresh throw at nobody.
 */

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** A loader whose promises resolve only when the test says so — the only way to observe single-flight. */
function deferred<T>() {
  const pending: Array<(v: T) => void> = []
  let calls = 0
  return {
    load: () => {
      calls += 1
      return new Promise<T>((r) => {
        pending.push(r)
      })
    },
    release: (v: T) => {
      for (const r of pending.splice(0)) r(v)
    },
    calls: () => calls,
  }
}

describe('createSwrCache', () => {
  it('loads once on a miss and shares that one load with everyone who asks while it runs', async () => {
    const cache = createSwrCache<string>({ ttlMs: 1000, cap: 10 })
    const d = deferred<string>()
    const a = cache.get('k', d.load, 0)
    const b = cache.get('k', d.load, 0)
    expect(d.calls()).toBe(1)
    d.release('v1')
    expect(await a).toBe('v1')
    expect(await b).toBe('v1')
    expect(cache.stats()).toMatchObject({ misses: 2, hits: 0, refreshes: 0 })
    expect(cache.size()).toBe(1)
  })

  it('serves a fresh hit without loading, and a stale hit at once while ONE refresh runs behind it', async () => {
    const cache = createSwrCache<string>({ ttlMs: 1000, cap: 10 })
    const d = deferred<string>()
    const first = cache.get('k', d.load, 0)
    d.release('v1')
    expect(await first).toBe('v1')
    expect(await cache.get('k', d.load, 999)).toBe('v1') // fresh: no load
    expect(d.calls()).toBe(1)
    // Stale at t=1000: the old value comes back at once, one refresh starts, and a second stale read joins it.
    expect(await cache.get('k', d.load, 1000)).toBe('v1')
    expect(await cache.get('k', d.load, 1000)).toBe('v1')
    expect(d.calls()).toBe(2)
    d.release('v2')
    await tick()
    expect(await cache.get('k', d.load, 1001)).toBe('v2') // refreshed, dated to the read that started it
    expect(d.calls()).toBe(2)
    expect(cache.stats()).toMatchObject({ hits: 2, staleHits: 2, misses: 1, refreshes: 1, failures: 0 })
  })

  it('keeps the stale value when the background refresh fails, swallows the rejection, and tries again next time', async () => {
    const cache = createSwrCache<string>({ ttlMs: 100, cap: 10 })
    let fail = false
    let calls = 0
    const load = async () => {
      calls += 1
      if (fail) throw new Error('feed down')
      return `v${calls}`
    }
    expect(await cache.get('k', load, 0)).toBe('v1')
    fail = true
    expect(await cache.get('k', load, 200)).toBe('v1') // stale served; the refresh fails behind it
    await tick()
    expect(cache.stats().failures).toBe(1)
    expect(cache.peek('k')).toBe('v1')
    fail = false
    expect(await cache.get('k', load, 300)).toBe('v1') // stale again; a new refresh starts
    await tick()
    expect(await cache.get('k', load, 301)).toBe('v3')
  })

  it('rejects the callers waiting on a failed FIRST load and caches nothing for that key', async () => {
    const cache = createSwrCache<string>({ ttlMs: 100, cap: 10 })
    await expect(
      cache.get(
        'k',
        async () => {
          throw new Error('no such player')
        },
        0,
      ),
    ).rejects.toThrow('no such player')
    expect(cache.size()).toBe(0)
    expect(await cache.get('k', async () => 'ok', 1)).toBe('ok')
  })

  it('drops the least recently used entry past the cap, and a read keeps an entry alive', async () => {
    const cache = createSwrCache<number>({ ttlMs: 10_000, cap: 2 })
    await cache.get('a', async () => 1, 0)
    await cache.get('b', async () => 2, 1)
    await cache.get('a', async () => 99, 2) // a hit: a is now the most recently used
    await cache.get('c', async () => 3, 3) // evicts b, not a
    expect(cache.peek('a')).toBe(1)
    expect(cache.peek('b')).toBeUndefined()
    expect(cache.peek('c')).toBe(3)
    expect(cache.size()).toBe(2)
    cache.clear()
    expect(cache.size()).toBe(0)
    expect(cache.stats()).toEqual({ hits: 0, staleHits: 0, misses: 0, refreshes: 0, failures: 0 })
  })
})
