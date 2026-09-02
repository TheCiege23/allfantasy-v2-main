import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/decision-os/waiver/loader', () => ({ loadWaiverWorldFacts: async () => null }))
vi.mock('@/lib/decision-os/trade/loader', () => ({ loadTradeWorldFacts: async () => null }))

import { createOsFeed, type OsFactSource } from '@/lib/decision-os/domain-os/feed'
import { createOsStore } from '@/lib/decision-os/domain-os/store'
import { OS_SCOPE_LEVELS, HOURS, MINUTES } from '@/lib/decision-os/domain-os/types'
import { waiverSettingsSource, waiverResourceSource } from '@/lib/decision-os/waiver-os'
import { tradeSettingsSource, tradeRosterSource } from '@/lib/decision-os/trade-os'

const FACTS = { ok: true } as never

/** In-memory store with a controllable age, so TTL behaviour is testable without waiting. */
function memoryStore(seed: Array<{ key: string; facts: unknown; ageMs: number }> = []) {
  const rows = new Map<string, { facts: unknown; capturedAt: Date; confidence: number | null; sampleSize: number | null }>()
  for (const s of seed) rows.set(s.key, { facts: s.facts, capturedAt: new Date(Date.now() - s.ageMs), confidence: null, sampleSize: null })
  const writes: Array<{ key: string; confidence: number | null; sampleSize: number | null }> = []
  const k = (a: { domain: string; kind: string; level: string; scopeKey: string }) => `${a.domain}|${a.kind}|${a.level}|${a.scopeKey}`
  return {
    writes,
    rows,
    store: {
      async read(a: never) {
        const arg = a as unknown as { ttlMs: number; domain: string; kind: string; level: string; scopeKey: string }
        const row = rows.get(k(arg))
        if (!row) return null
        const ageMs = Date.now() - row.capturedAt.getTime()
        if (ageMs > arg.ttlMs) return null
        return { facts: row.facts, level: arg.level, confidence: row.confidence, sampleSize: row.sampleSize, capturedAt: row.capturedAt, ageMs }
      },
      async write(a: never) {
        const arg = a as unknown as { domain: string; kind: string; level: string; scopeKey: string; facts: unknown; confidence: number | null; sampleSize: number | null }
        writes.push({ key: k(arg), confidence: arg.confidence, sampleSize: arg.sampleSize })
        rows.set(k(arg), { facts: arg.facts, capturedAt: new Date(), confidence: arg.confidence, sampleSize: arg.sampleSize })
        // ⚠ MUST affirm. `safeWrite` reads anything other than `true` as a failure, on purpose —
        // a double that forgets this reports write_failed, which is how a real store that forgot
        // it would be caught too.
        return true
      },
    } as never,
  }
}

const src = (over: Partial<OsFactSource<{ id: string }, unknown>> = {}): OsFactSource<{ id: string }, unknown> => ({
  kind: 'k', level: 'league', ttlMs: 1000,
  scopeKey: (a) => a.id, sport: () => 'NFL',
  derive: async () => FACTS,
  ...over,
})

describe('the kernel accelerates without becoming a source of truth', () => {
  it('serves a FRESH entry without deriving', async () => {
    const m = memoryStore([{ key: 'lineup|k|league|L1', facts: FACTS, ageMs: 10 }])
    const derive = vi.fn(async () => ({ live: true }) as never)
    const feed = createOsFeed('lineup', { store: m.store })
    const out = await feed.get(src({ derive }), { id: 'L1' })
    expect(derive).not.toHaveBeenCalled()
    expect(out).toEqual(FACTS)
    expect(feed.drainOutcomes().k).toMatchObject({ servedFrom: 'store', level: 'league' })
  })

  it('treats a STALE entry as absent and derives instead', async () => {
    // The safety argument: maintained state that stops refreshing lies with confidence. Past its
    // TTL this behaves exactly like the code that existed before any of this.
    const m = memoryStore([{ key: 'lineup|k|league|L1', facts: FACTS, ageMs: 5000 }])
    const derive = vi.fn(async () => ({ live: true }) as never)
    const feed = createOsFeed('lineup', { store: m.store })
    const out = await feed.get(src({ derive }), { id: 'L1' })
    expect(derive).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ live: true })
    expect(feed.drainOutcomes().k).toMatchObject({ servedFrom: 'live', ageMs: 0 })
  })

  it('does NOT cache an unavailable result', async () => {
    // Caching null converts a transient source outage into a TTL-long blackout, and "unavailable"
    // is a fact about the SOURCE, not about the league.
    const m = memoryStore()
    const feed = createOsFeed('lineup', { store: m.store })
    await expect(feed.get(src({ derive: async () => null }), { id: 'L1' })).resolves.toBeNull()
    expect(m.writes).toEqual([])
    expect(feed.drainOutcomes().k).toMatchObject({ servedFrom: 'unavailable', ageMs: null })
  })

  it('carries confidence and sampleSize when the domain measures them', async () => {
    // Matches the app/league/user learning trio. A fact from 2 games and one from 200 are not the
    // same fact, and without the sample a consumer cannot tell them apart.
    const m = memoryStore()
    const feed = createOsFeed('lineup', { store: m.store })
    await feed.get(src({ measure: () => ({ confidence: 0.8, sampleSize: 42 }) }), { id: 'L1' })
    expect(m.writes[0]).toMatchObject({ confidence: 0.8, sampleSize: 42 })
    expect(feed.drainOutcomes().k).toMatchObject({ confidence: 0.8, sampleSize: 42 })
  })

  it('never throws when derive throws or the store throws', async () => {
    const feed = createOsFeed('lineup', { store: memoryStore().store })
    await expect(feed.get(src({ derive: async () => { throw new Error('ports down') } }), { id: 'L1' })).resolves.toBeNull()

    const hostile = { read: async () => { throw new Error('db down') }, write: async () => { throw new Error('db down') } } as never
    const feed2 = createOsFeed('lineup', { store: hostile })
    await expect(feed2.get(src(), { id: 'L1' })).resolves.toEqual(FACTS)
  })

  it('partitions by domain, so two feeds cannot read each other', async () => {
    const m = memoryStore([{ key: 'waiver|k|league|L1', facts: { waiver: true }, ageMs: 10 }])
    const feed = createOsFeed('trade', { store: m.store })
    const derive = vi.fn(async () => ({ trade: true }) as never)
    const out = await feed.get(src({ derive }), { id: 'L1' })
    expect(derive).toHaveBeenCalled()
    expect(out).toEqual({ trade: true })
  })
})

describe('three levels, widest to narrowest', () => {
  it('is ordered app → league → user so a resolver can fall back upward', () => {
    expect(OS_SCOPE_LEVELS).toEqual(['app', 'league', 'user'])
  })
})

describe('waiver + trade declare the right levels and speeds', () => {
  it('puts league RULES at league level and this manager RESOURCES at user level', () => {
    expect(waiverSettingsSource.level).toBe('league')
    expect(waiverResourceSource.level).toBe('user')
    expect(tradeSettingsSource.level).toBe('league')
    expect(tradeRosterSource.level).toBe('user')
  })

  it('expires resources far sooner than rules', () => {
    // A stale FAAB balance would tell someone they can afford a bid they cannot — a wrong answer
    // that looks authoritative.
    expect(waiverResourceSource.ttlMs).toBeLessThan(waiverSettingsSource.ttlMs)
    expect(tradeRosterSource.ttlMs).toBeLessThan(tradeSettingsSource.ttlMs)
  })

  it('keeps trade the shortest-lived of the two, because it is the highest-stakes domain', () => {
    expect(tradeSettingsSource.ttlMs).toBeLessThan(waiverSettingsSource.ttlMs)
    expect(tradeRosterSource.ttlMs).toBeLessThan(waiverResourceSource.ttlMs)
    expect(waiverSettingsSource.ttlMs).toBe(6 * HOURS)
    expect(waiverResourceSource.ttlMs).toBe(5 * MINUTES)
  })

  it('scopes a trade to the ORDERED roster pair', () => {
    // A to B is not the same fact as B to A: roster facts are carried per side, and swapping them
    // attributes one manager's FAAB and record to the other.
    const ab = tradeRosterSource.scopeKey({ leagueId: 'L', seasonId: 'S', proposerRosterId: 'A', receiverRosterId: 'B' })
    const ba = tradeRosterSource.scopeKey({ leagueId: 'L', seasonId: 'S', proposerRosterId: 'B', receiverRosterId: 'A' })
    expect(ab).not.toEqual(ba)
  })

  it('scopes waiver resources per user AND league, not per user alone', () => {
    const a = waiverResourceSource.scopeKey({ userId: 'u1', leagueId: 'L1' })
    const b = waiverResourceSource.scopeKey({ userId: 'u1', leagueId: 'L2' })
    expect(a).not.toEqual(b)
  })
})

describe('safe before the migration is applied', () => {
  it('reports no cached facts when the delegate is absent', async () => {
    const s = createOsStore({} as never)
    await expect(s.read({ domain: 'lineup', kind: 'k', level: 'league', scopeKey: 'L1', ttlMs: 1000 })).resolves.toBeNull()
    // Reports FALSE, not undefined: "I did not persist this" is an answer the caller can act on.
    // Undefined was indistinguishable from success — see the suite below.
    await expect(s.write({ domain: 'lineup', kind: 'k', level: 'league', scopeKey: 'L1', sport: 'NFL', facts: {} })).resolves.toBe(false)
  })
})

/**
 * ── 🛑 A WRITE THAT FAILS MUST NOT BE REPORTED AS WORK DONE ─────────────────────────────────
 *
 * Measured on production 2026-09-01: `domain_os_facts` did not exist, yet
 * `/api/cron/domain-os-refresh` had been running every 30 minutes reporting `written: N`.
 *
 * The mechanism was two stacked swallows. `createOsStore().write` catches its own failure
 * ("populating the cache must never fail the caller"), `safeWrite` catches again, and `refresh`
 * then returned the literal `'written'` because nothing it could see had gone wrong. The Prisma
 * delegate EXISTS whenever the model is in `schema.prisma`, so the `if (!delegate)` guard never
 * fired — the upsert ran, threw P2021, and was swallowed.
 *
 * ⚠ THE MISSING TABLE WAS THE TRIGGER, NOT THE BUG. Creating it fixes today; it does not stop the
 * next permissions change or schema drift being reported as healthy work. What is under test here
 * is that a failed write is OBSERVABLE.
 *
 * ⚠ AND `get()` MUST NOT CHANGE. On the read path a failed cache write is genuinely opportunistic:
 * the caller already holds the live value and must still receive it. Only `refresh`, whose entire
 * job is to write, may report the failure. Same swallow, two correct behaviours — the last test
 * here pins that so a later "tidy-up" cannot collapse them into one.
 */
describe('a failed write is reported, not counted as success', () => {
  it('refresh() reports write_failed when the store THROWS', async () => {
    const hostile = {
      read: async () => null,
      write: async () => { throw new Error('relation "domain_os_facts" does not exist') },
    } as never
    const feed = createOsFeed('lineup', { store: hostile })
    await expect(feed.refresh(src(), { id: 'L1' })).resolves.toBe('write_failed')
  })

  it('refresh() reports write_failed when the store DECLINES without throwing', async () => {
    // This is the production shape: createOsStore swallows P2021 internally and returns normally.
    // A store that reports failure by returning false must be heard as clearly as one that throws.
    const silent = { read: async () => null, write: async () => false } as never
    const feed = createOsFeed('lineup', { store: silent })
    await expect(feed.refresh(src(), { id: 'L1' })).resolves.toBe('write_failed')
  })

  it('still reports written when the store actually persists', async () => {
    const m = memoryStore()
    const feed = createOsFeed('lineup', { store: m.store })
    await expect(feed.refresh(src(), { id: 'L1' })).resolves.toBe('written')
    expect(m.writes).toHaveLength(1)
  })

  it('keeps unavailable meaning "the SOURCE had nothing", distinct from a write failure', async () => {
    // Collapsing these loses the only signal that separates a provider outage from a store
    // outage — which need opposite responses. Same reason the grounding packet gave `disabled`
    // its own gap reason rather than reusing `not_computed`.
    const m = memoryStore()
    const feed = createOsFeed('lineup', { store: m.store })
    await expect(feed.refresh(src({ derive: async () => null }), { id: 'L1' })).resolves.toBe('unavailable')
    expect(m.writes).toHaveLength(0)
  })

  it('get() STILL returns the live value when the cache write fails', async () => {
    const hostile = {
      read: async () => null,
      write: async () => { throw new Error('db down') },
    } as never
    const feed = createOsFeed('lineup', { store: hostile })
    await expect(feed.get(src(), { id: 'L1' })).resolves.toEqual(FACTS)
    // And it is reported as served LIVE, not as unavailable: the fact was derived and handed over.
    expect(feed.drainOutcomes().k).toMatchObject({ servedFrom: 'live' })
  })
})
