import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  EventNormalizer,
  EventPublisher,
  OutboxRelay,
  InMemoryEventSchemaRegistry,
  InMemoryOutboxStore,
  InProcessEventBus,
  zodValidator,
  EventValidationError,
  type DomainEvent,
} from '@/lib/events'

describe('EventNormalizer', () => {
  it('non-strict: passes unregistered types and flags them', () => {
    const reg = new InMemoryEventSchemaRegistry()
    const n = new EventNormalizer(reg, { strict: false })
    const e = n.normalize({ type: 'unregistered.type', payload: { a: 1 }, metadata: { source: 'engine' } })
    expect(e.metadata.schemaUnregistered).toBe(true)
  })

  it('strict: rejects unregistered types', () => {
    const reg = new InMemoryEventSchemaRegistry()
    const n = new EventNormalizer(reg, { strict: true })
    expect(() => n.normalize({ type: 'unregistered.type', payload: {} })).toThrow(EventValidationError)
  })

  it('validates payload against the registered schema', () => {
    const reg = new InMemoryEventSchemaRegistry()
    reg.register('score.updated', 1, zodValidator(z.object({ points: z.number() })))
    const n = new EventNormalizer(reg)
    expect(() => n.normalize({ type: 'score.updated', schemaVersion: 1, payload: { points: 'x' } as never })).toThrow(
      EventValidationError,
    )
    const ok = n.normalize({ type: 'score.updated', schemaVersion: 1, payload: { points: 5 }, metadata: { source: 'engine' } })
    expect(ok.payload).toEqual({ points: 5 })
    expect(ok.metadata.schemaUnregistered).toBeUndefined()
  })

  it('rejects a malformed envelope (bad type)', () => {
    const n = new EventNormalizer(new InMemoryEventSchemaRegistry())
    expect(() => n.normalize({ type: 'has spaces', payload: {} })).toThrow(EventValidationError)
  })
})

describe('EventPublisher', () => {
  it('normalizes, enqueues, and returns the event (no bus dispatch)', async () => {
    const store = new InMemoryOutboxStore()
    const publisher = new EventPublisher(new EventNormalizer(new InMemoryEventSchemaRegistry()), store)
    const e = await publisher.publish({ type: 'a.b', payload: { n: 1 }, metadata: { source: 'engine' } })
    expect(store.events.has(e.idempotencyKey)).toBe(true)
    expect(store.outbox.get(e.eventId)?.status).toBe('pending')
  })

  it('passes the transaction handle through to the store (transactional outbox)', async () => {
    const store = new InMemoryOutboxStore()
    const spy = vi.spyOn(store, 'enqueue')
    const publisher = new EventPublisher(new EventNormalizer(new InMemoryEventSchemaRegistry()), store)
    const fakeTx = { marker: 'tx' }
    await publisher.publish({ type: 'a.b', payload: {}, metadata: { source: 'engine' } }, { tx: fakeTx })
    expect(spy).toHaveBeenCalledWith(expect.anything(), { tx: fakeTx })
  })
})

describe('OutboxRelay', () => {
  it('dispatches pending events to the bus and marks them dispatched', async () => {
    const store = new InMemoryOutboxStore()
    const bus = new InProcessEventBus()
    const received: DomainEvent[] = []
    bus.subscribe('*', (e) => {
      received.push(e)
    })
    const publisher = new EventPublisher(new EventNormalizer(new InMemoryEventSchemaRegistry()), store)
    const e1 = await publisher.publish({ type: 'a.b', payload: {}, metadata: { source: 'engine' } })

    const relay = new OutboxRelay(store, { bus })
    const summary = await relay.dispatchPending()

    expect(summary).toMatchObject({ fetched: 1, dispatched: 1, failed: 0 })
    expect(received.map((e) => e.eventId)).toEqual([e1.eventId])
    expect(store.outbox.get(e1.eventId)?.status).toBe('dispatched')

    // Idempotent: nothing pending on a second pass.
    const second = await relay.dispatchPending()
    expect(second.fetched).toBe(0)
  })

  it('retries a failing consumer with capped exponential backoff', async () => {
    const store = new InMemoryOutboxStore()
    const failingConsumer = { name: 'x', handle: vi.fn(async () => { throw new Error('consumer down') }) }
    const publisher = new EventPublisher(new EventNormalizer(new InMemoryEventSchemaRegistry()), store)
    const e1 = await publisher.publish({ type: 'a.b', payload: {}, metadata: { source: 'engine' } })

    // `now` must be >= enqueue time so the pending row is claimable; use a near-future instant.
    const fixedNow = new Date(Date.now() + 60_000)
    const relay = new OutboxRelay(store, { consumers: [failingConsumer], maxRetries: 5, baseRetryMs: 5000, now: () => fixedNow })
    const summary = await relay.runOnce()

    expect(summary).toMatchObject({ fetched: 1, dispatched: 0, retried: 1, deadLettered: 0 })
    const row = store.outbox.get(e1.eventId)!
    expect(row.status).toBe('retry') // scheduled for a later attempt
    expect(row.attempts).toBe(1)
    expect(row.availableAt.getTime()).toBe(fixedNow.getTime() + 5000) // base * 2^(1-1)
  })

  it('dead-letters after maxRetries and stops re-claiming', async () => {
    const store = new InMemoryOutboxStore()
    const failingConsumer = { name: 'x', handle: vi.fn(async () => { throw new Error('down') }) }
    const publisher = new EventPublisher(new EventNormalizer(new InMemoryEventSchemaRegistry()), store)
    const e1 = await publisher.publish({ type: 'a.b', payload: {}, metadata: { source: 'engine' } })
    // Simulate 4 prior failed attempts; the 5th reaches maxRetries.
    store.outbox.get(e1.eventId)!.attempts = 4

    const fixedNow = new Date(Date.now() + 60_000)
    const relay = new OutboxRelay(store, { consumers: [failingConsumer], maxRetries: 5, now: () => fixedNow })
    const summary = await relay.runOnce()

    expect(summary).toMatchObject({ fetched: 1, dispatched: 0, retried: 0, deadLettered: 1 })
    expect(store.outbox.get(e1.eventId)!.status).toBe('dead')
    // Dead rows are not re-claimed.
    const second = await relay.runOnce()
    expect(second.fetched).toBe(0)
  })

  it('dry-run reports without delivering or mutating state', async () => {
    const store = new InMemoryOutboxStore()
    const consumer = { name: 'x', handle: vi.fn(async () => {}) }
    const publisher = new EventPublisher(new EventNormalizer(new InMemoryEventSchemaRegistry()), store)
    const e1 = await publisher.publish({ type: 'a.b', payload: {}, metadata: { source: 'engine' } })

    const fixedNow = new Date(Date.now() + 60_000)
    const relay = new OutboxRelay(store, { consumers: [consumer], dryRun: true, now: () => fixedNow })
    const summary = await relay.runOnce()

    expect(summary).toMatchObject({ fetched: 1, dispatched: 0, dryRun: true })
    expect(consumer.handle).not.toHaveBeenCalled()
    expect(store.outbox.get(e1.eventId)!.status).toBe('pending') // unchanged
  })

  it('run() drains every pending event across batches', async () => {
    const store = new InMemoryOutboxStore()
    const seen: string[] = []
    const consumer = { name: 'x', handle: async (e: DomainEvent) => { seen.push(e.eventId) } }
    const publisher = new EventPublisher(new EventNormalizer(new InMemoryEventSchemaRegistry()), store)
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push((await publisher.publish({ type: 'a.b', payload: { i }, metadata: { source: 'engine' } })).eventId)

    const fixedNow = new Date(Date.now() + 60_000)
    const relay = new OutboxRelay(store, { consumers: [consumer], batchSize: 2, now: () => fixedNow })
    const summary = await relay.run()

    expect(summary.dispatched).toBe(5)
    expect(seen.sort()).toEqual(ids.sort())
  })
})
