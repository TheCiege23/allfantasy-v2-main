import { describe, it, expect, vi } from 'vitest'
import {
  OutboxRelay,
  EventPublisher,
  EventNormalizer,
  InMemoryEventSchemaRegistry,
  InMemoryOutboxStore,
} from '@/lib/events'

function publisherFor(store: InMemoryOutboxStore) {
  return new EventPublisher(new EventNormalizer(new InMemoryEventSchemaRegistry()), store)
}

describe('relay atomic claiming (production hardening)', () => {
  it('two workers never double-process the same event', async () => {
    const store = new InMemoryOutboxStore()
    const processed = new Map<string, number>()
    const consumer = () => ({
      name: 'c',
      handle: async (e: { eventId: string }) => {
        processed.set(e.eventId, (processed.get(e.eventId) ?? 0) + 1)
      },
    })
    const publisher = publisherFor(store)
    const ids: string[] = []
    for (let i = 0; i < 10; i++) {
      ids.push((await publisher.publish({ type: 'a.b', payload: { i }, metadata: { source: 't' } })).eventId)
    }

    const now = new Date(Date.now() + 60_000)
    const a = new OutboxRelay(store, { consumers: [consumer()], workerId: 'A', batchSize: 2, now: () => now })
    const b = new OutboxRelay(store, { consumers: [consumer()], workerId: 'B', batchSize: 2, now: () => now })

    // Two workers drain concurrently.
    await Promise.all([a.run(), b.run()])

    expect(processed.size).toBe(10)
    for (const id of ids) expect(processed.get(id)).toBe(1) // exactly once each — no double-processing
  })

  it('claimBatch marks rows claimed and a second worker sees nothing until they are stale', async () => {
    const store = new InMemoryOutboxStore()
    const publisher = publisherFor(store)
    const e = await publisher.publish({ type: 'a.b', payload: {}, metadata: { source: 't' } })

    const t0 = new Date(Date.now() + 60_000)
    const claimedByA = await store.claimBatch('A', { batchSize: 10, staleClaimMs: 30_000, now: t0 })
    expect(claimedByA.map((i) => i.event.eventId)).toContain(e.eventId)
    expect(store.outbox.get(e.eventId)!.status).toBe('claimed')
    expect(store.outbox.get(e.eventId)!.claimedBy).toBe('A')

    // Before the stale timeout, worker B gets nothing.
    const beforeTimeout = new Date(t0.getTime() + 10_000)
    const claimedByBEarly = await store.claimBatch('B', { batchSize: 10, staleClaimMs: 30_000, now: beforeTimeout })
    expect(claimedByBEarly).toHaveLength(0)
  })

  it('recovers a stale claim after the timeout (crashed worker) and dispatches it', async () => {
    const store = new InMemoryOutboxStore()
    const publisher = publisherFor(store)
    const e = await publisher.publish({ type: 'a.b', payload: {}, metadata: { source: 't' } })

    // Worker A claims, then "crashes" (never marks dispatched/retry/dead).
    const t0 = new Date(Date.now() + 60_000)
    await store.claimBatch('A', { batchSize: 10, staleClaimMs: 30_000, now: t0 })
    expect(store.outbox.get(e.eventId)!.status).toBe('claimed')

    // After the stale timeout, worker B reclaims + dispatches it.
    const afterTimeout = new Date(t0.getTime() + 31_000)
    const consumer = { name: 'c', handle: vi.fn(async () => {}) }
    const b = new OutboxRelay(store, { consumers: [consumer], workerId: 'B', claimTimeoutMs: 30_000, now: () => afterTimeout })
    const summary = await b.runOnce()

    expect(summary.dispatched).toBe(1)
    expect(consumer.handle).toHaveBeenCalledTimes(1)
    expect(store.outbox.get(e.eventId)!.status).toBe('dispatched')
  })

  it('idempotent consumer stays safe if the same event is delivered twice', async () => {
    // Simulate redelivery (e.g. crash after consumer ran, before markDispatched): the
    // consumer must be idempotent. Here the consumer dedupes on eventId.
    const seen = new Set<string>()
    const writes: string[] = []
    const consumer = {
      name: 'idem',
      handle: async (e: { eventId: string }) => {
        if (seen.has(e.eventId)) return
        seen.add(e.eventId)
        writes.push(e.eventId)
      },
    }
    const store = new InMemoryOutboxStore()
    const publisher = publisherFor(store)
    const e = await publisher.publish({ type: 'a.b', payload: {}, metadata: { source: 't' } })
    await consumer.handle({ eventId: e.eventId })
    await consumer.handle({ eventId: e.eventId }) // redelivery
    expect(writes).toEqual([e.eventId]) // written once despite two deliveries
  })
})
