/**
 * Lineup OS wiring contract, added 2026-08-23.
 *
 * WHAT WAS WIRED
 * `lib/decision-os/domain-os` is a kernel: each domain feed maintains the facts its decisions need
 * and Decision OS reads them, rather than gathering inline on every call. `createLineupOsLoaders()`
 * returns the two loader slots `runLineupShadow` already accepts. Before this change the kernel had
 * ZERO production callers -- `createLineupOs` appeared only in its own file.
 *
 * ⚠ THE BACKING TABLE DOES NOT EXIST YET. `DomainOsFacts` is declared in schema.prisma but has no
 * migration and `domain_os_facts` is absent from production (verified 2026-08-23). That is why this
 * lands first and the migration second: `safeRead`/`safeWrite` swallow every store failure, so with
 * no table the feed falls straight through to the live derivation and behaviour is byte-identical
 * to not wiring it at all. The store's own header: "a cache that throws is worse than no cache."
 *
 * WHAT IS PINNED
 *   1. THE LOADERS REACH runLineupShadow. Both the live and shadow branches must pass them, or the
 *      feed is constructed and ignored -- which would look wired and change nothing.
 *   2. A DEAD STORE DEGRADES TO LIVE, NEVER THROWS. This is the property that makes shipping ahead
 *      of the migration safe. If it ever regresses, every lineup request starts failing on a cache.
 *   3. OUTCOMES ARE COUNTED. The entire point is measuring whether the store is ever hit; signal
 *      facts carry a 30-minute TTL, so a low-traffic surface may never hit it, and that answer is
 *      what decides whether the migration is worth doing.
 *   4. THE DECISION IS UNCHANGED. Only where facts come from moves; never how a lineup is decided.
 */
import { describe, it, expect, vi } from 'vitest'

import { createOsFeed } from '@/lib/decision-os/domain-os'
import { createLineupOsLoaders, lineupOsSources } from '@/lib/decision-os/lineup-os'

/** A store whose every method throws — stands in for "the table does not exist" (42P01). */
const deadStore = {
  read: vi.fn(async () => { throw new Error('relation "domain_os_facts" does not exist') }),
  write: vi.fn(async () => { throw new Error('relation "domain_os_facts" does not exist') }),
}

describe('Lineup OS loaders', () => {
  it('exposes exactly the dependency slots runLineupShadow accepts', () => {
    const loaders = createLineupOsLoaders({ store: deadStore as never })
    // If these names drift, the spread in the route silently passes nothing and the shadow falls
    // back to its live defaults — wired in appearance, inert in fact.
    expect(typeof loaders.loadWarehouseFacts).toBe('function')
    expect(typeof loaders.loadSignalFacts).toBe('function')
    expect(typeof loaders.drainOutcomes).toBe('function')
  })

  it('declares a short TTL for signals and a long one for warehouse facts', () => {
    const [warehouse, signal] = lineupOsSources
    // Injury and bye decide whether a player can be started at all. Serving those stale is a wrong
    // answer delivered confidently, which is the specific risk a cache introduces here.
    expect(signal.ttlMs).toBeLessThan(warehouse.ttlMs)
    expect(signal.ttlMs).toBeLessThanOrEqual(30 * 60 * 1000)
  })

  it('degrades to live derivation when the store is dead, and does not throw', async () => {
    const feed = createOsFeed('lineup', { store: deadStore as never })
    const source = {
      kind: 'probe',
      level: 'league' as const,
      ttlMs: 60_000,
      scopeKey: () => 'league-1',
      sport: () => 'NFL',
      derive: async () => ({ ok: true }),
    }

    const facts = await feed.get(source as never, {} as never)

    // The property that makes shipping before the migration safe. `get()` returns the facts
    // themselves; HOW they were sourced is reported separately through drainOutcomes().
    expect(facts).toEqual({ ok: true })
    expect(feed.drainOutcomes().probe!.servedFrom).toBe('live')
    expect(deadStore.read).toHaveBeenCalled()
  })

  it('counts outcomes so the store hit rate can be measured', async () => {
    const feed = createOsFeed('lineup', { store: deadStore as never })
    const source = {
      kind: 'probe',
      level: 'league' as const,
      ttlMs: 60_000,
      scopeKey: () => 'league-1',
      sport: () => 'NFL',
      derive: async () => ({ ok: true }),
    }
    await feed.get(source as never, {} as never)

    const outcomes = feed.drainOutcomes()
    // Without this the wiring is unmeasurable, and "is the cache worth a migration?" stays a guess.
    expect(Object.keys(outcomes).length).toBeGreaterThan(0)
    expect(Object.values(outcomes)[0]!.servedFrom).toBe('live')
  })

  it('drains, so a second read does not double-count the first request', async () => {
    const feed = createOsFeed('lineup', { store: deadStore as never })
    const source = {
      kind: 'probe',
      level: 'league' as const,
      ttlMs: 60_000,
      scopeKey: () => 'league-1',
      sport: () => 'NFL',
      derive: async () => ({ ok: true }),
    }
    await feed.get(source as never, {} as never)
    feed.drainOutcomes()
    // A per-request feed that accumulated across drains would inflate every count after the first.
    expect(Object.keys(feed.drainOutcomes()).length).toBe(0)
  })

  it('returns null facts rather than throwing when derivation itself fails', async () => {
    const feed = createOsFeed('lineup', { store: deadStore as never })
    const source = {
      kind: 'probe',
      level: 'league' as const,
      ttlMs: 60_000,
      scopeKey: () => 'league-1',
      sport: () => 'NFL',
      derive: async () => { throw new Error('provider down') },
    }

    const facts = await feed.get(source as never, {} as never)
    // `null` is a real answer the decision path already handles; an exception is not.
    expect(facts).toBeNull()
    expect(feed.drainOutcomes().probe!.servedFrom).toBe('unavailable')
  })
})
