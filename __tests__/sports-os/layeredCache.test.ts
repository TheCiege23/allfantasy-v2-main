import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetLayeredCacheForTests, invalidate, invalidatePrefix, readThrough, type DurableCacheTier } from '@/lib/sports-os/layeredCache'
import type { Fresh } from '@/lib/sports-os/freshness'

const START = 1_700_000_000_000

function clock(startAt = START) {
  let t = startAt
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

function memoryDurable(): DurableCacheTier & { store: Map<string, Fresh<unknown>> } {
  const store = new Map<string, Fresh<unknown>>()
  return {
    store,
    read: async (key) => store.get(key) ?? null,
    write: async (key, entry) => { store.set(key, entry) },
    remove: async (key) => { store.delete(key) },
  }
}

// `readThrough` fires revalidation without awaiting it; let the microtask queue drain.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('sports-os layeredCache', () => {
  beforeEach(() => {
    __resetLayeredCacheForTests()
  })

  it('computes on a miss and serves the memory tier inside the TTL', async () => {
    const compute = vi.fn(async () => 'value-1')
    const c = clock()

    const first = await readThrough({ key: 'k', ttlMs: 60_000, compute, now: c.now })
    expect(first).toMatchObject({ data: 'value-1', source: 'live', fetchedAt: START })
    expect(compute).toHaveBeenCalledTimes(1)

    c.advance(30_000)
    const second = await readThrough({ key: 'k', ttlMs: 60_000, compute, now: c.now })
    expect(second).toMatchObject({ data: 'value-1', source: 'cache' })
    // fetchedAt must be the ORIGIN's time, not the read's, or the age resets on every hit.
    expect(second.fetchedAt).toBe(START)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('serves last-known immediately past the TTL and revalidates behind it', async () => {
    let n = 0
    const compute = vi.fn(async () => `value-${++n}`)
    const c = clock()

    await readThrough({ key: 'k', ttlMs: 1_000, staleWhileRevalidateMs: 60_000, compute, now: c.now })
    c.advance(5_000)

    const stale = await readThrough({ key: 'k', ttlMs: 1_000, staleWhileRevalidateMs: 60_000, compute, now: c.now })
    // The caller waits for nothing: it gets the OLD value, labelled.
    expect(stale).toMatchObject({ data: 'value-1', source: 'last-known' })

    await flush()
    expect(compute).toHaveBeenCalledTimes(2)

    const after = await readThrough({ key: 'k', ttlMs: 1_000, staleWhileRevalidateMs: 60_000, compute, now: c.now })
    expect(after).toMatchObject({ data: 'value-2', source: 'cache' })
  })

  it('waits for the recompute when stale-while-revalidate is disabled', async () => {
    let n = 0
    const compute = vi.fn(async () => `value-${++n}`)
    const c = clock()

    await readThrough({ key: 'k', ttlMs: 1_000, compute, now: c.now })
    c.advance(5_000)
    const result = await readThrough({ key: 'k', ttlMs: 1_000, compute, now: c.now })

    expect(result).toMatchObject({ data: 'value-2', source: 'live' })
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('runs one compute for concurrent misses on the same key', async () => {
    let resolveCompute: ((value: string) => void) | undefined
    const compute = vi.fn(() => new Promise<string>((resolve) => { resolveCompute = resolve }))

    const a = readThrough({ key: 'k', ttlMs: 60_000, compute })
    const b = readThrough({ key: 'k', ttlMs: 60_000, compute })
    resolveCompute?.('once')

    expect((await a).data).toBe('once')
    expect((await b).data).toBe('once')
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure', async () => {
    // Caching a miss turns one transient provider outage into a TTL of "this does not exist".
    let attempt = 0
    const compute = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('provider down')
      return 'recovered'
    })

    await expect(readThrough({ key: 'k', ttlMs: 60_000, compute })).rejects.toThrow('provider down')
    const second = await readThrough({ key: 'k', ttlMs: 60_000, compute })
    expect(second).toMatchObject({ data: 'recovered', source: 'live' })
  })

  it('falls back to the durable tier, and writes through to it', async () => {
    const durable = memoryDurable()
    const compute = vi.fn(async () => 'from-compute')
    const c = clock()

    await readThrough({ key: 'k', ttlMs: 60_000, compute, durable, now: c.now })
    expect(durable.store.get('k')).toMatchObject({ data: 'from-compute' })

    // Memory gone (a new process), durable warm: no recompute.
    __resetLayeredCacheForTests()
    c.advance(10_000)
    const promoted = await readThrough({ key: 'k', ttlMs: 60_000, compute, durable, now: c.now })
    expect(promoted).toMatchObject({ data: 'from-compute', source: 'cache' })
    expect(promoted.fetchedAt).toBe(START)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('keeps fetchedAt across a tier hop, so a promoted entry still goes stale on time', async () => {
    // 🛑 THE IMMORTALITY BUG. Staleness is judged from `fetchedAt`. If promoting an entry from the
    // durable tier into memory re-stamped it, every hop would look like a refresh and the value
    // would never expire — a permanently wrong screen with nothing red anywhere.
    //
    // ⚠ THE SCENARIO IS PICKED SO THE BUG CAN ACTUALLY SHOW. An earlier version of this test used
    // no stale-while-revalidate window, and the promoted entry fell out of memory before the
    // second read — so a re-stamping mutation stayed GREEN and the test proved nothing. The entry
    // has to still be IN memory, and past its TTL, at the moment of the second read.
    const durable = memoryDurable()
    const c = clock()
    const compute = vi.fn(async () => 'new')
    durable.store.set('k', { data: 'old', fetchedAt: START - 50_000, source: 'live', staleAfterMs: 60_000 })
    const opts = { key: 'k', ttlMs: 60_000, staleWhileRevalidateMs: 600_000, compute, durable, now: c.now }

    // 50s old against a 60s TTL: current, promoted into memory.
    expect(await readThrough(opts)).toMatchObject({ data: 'old', source: 'cache' })
    expect(compute).not.toHaveBeenCalled()

    // 70s old now — past the TTL, still inside the hold window, so still served from memory.
    c.advance(20_000)
    const second = await readThrough(opts)

    // `last-known` (not `cache`) is the whole assertion: it says the entry was judged against its
    // ORIGIN timestamp. A re-stamped one reads 50s younger and comes back as `cache`.
    expect(second).toMatchObject({ data: 'old', source: 'last-known' })
    await flush()
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('survives a durable tier that throws, on both read and write', async () => {
    const compute = vi.fn(async () => 'value')
    const onRevalidateError = vi.fn()
    const broken: DurableCacheTier = {
      read: async () => { throw new Error('db down') },
      write: async () => { throw new Error('db down') },
    }

    const result = await readThrough({ key: 'k', ttlMs: 60_000, compute, durable: broken, onRevalidateError })
    expect(result).toMatchObject({ data: 'value', source: 'live' })
    expect(onRevalidateError).toHaveBeenCalled()
  })

  it('forceRefresh bypasses every cached tier and still writes back', async () => {
    let n = 0
    const compute = vi.fn(async () => `v${++n}`)
    await readThrough({ key: 'k', ttlMs: 600_000, compute })
    const forced = await readThrough({ key: 'k', ttlMs: 600_000, compute, forceRefresh: true })
    expect(forced).toMatchObject({ data: 'v2', source: 'live' })
    const after = await readThrough({ key: 'k', ttlMs: 600_000, compute })
    expect(after).toMatchObject({ data: 'v2', source: 'cache' })
  })

  it('invalidates one key and a prefix', async () => {
    const durable = memoryDurable()
    const compute = vi.fn(async () => 'v')
    await readThrough({ key: 'p:a', ttlMs: 600_000, compute, durable })
    await readThrough({ key: 'p:b', ttlMs: 600_000, compute, durable })
    await readThrough({ key: 'other', ttlMs: 600_000, compute, durable })

    await invalidate('p:a', durable)
    expect(durable.store.has('p:a')).toBe(false)

    expect(invalidatePrefix('p:')).toBe(1)
    expect(invalidatePrefix('p:')).toBe(0)
    // The unrelated key must be untouched by a prefix sweep.
    const untouched = await readThrough({ key: 'other', ttlMs: 600_000, compute, durable })
    expect(untouched.source).toBe('cache')
  })
})
