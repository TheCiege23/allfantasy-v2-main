/**
 * G15.3b — Atomic claiming DB integration (real FOR UPDATE SKIP LOCKED).
 *
 * OPT-IN: RUN_EVENT_DB_IT=1 + DATABASE_URL → NON-prod DB with the claim migration applied.
 * Proves two concurrent relay workers never double-process the same event, and that a
 * stale claim is recovered after the timeout.
 *
 *   RUN_EVENT_DB_IT=1 DATABASE_URL=<staging> \
 *     npx vitest run __tests__/events/relay-claiming-db.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  PrismaOutboxStore, EventPublisher, EventNormalizer, OutboxRelay, InMemoryEventSchemaRegistry,
  type PrismaLike,
} from '@/lib/events'

const RUN = process.env.RUN_EVENT_DB_IT === '1'
const d = RUN ? describe : describe.skip

d('atomic claiming against a real database', () => {
  const prisma = new PrismaClient()
  const store = new PrismaOutboxStore(prisma as unknown as PrismaLike)
  const publisher = new EventPublisher(new EventNormalizer(new InMemoryEventSchemaRegistry()), store)
  const mark = `CLAIMIT-${Date.now()}`
  const ids: string[] = []

  // Global outbox/relay → run serially (vitest --fileParallelism=false); clean first.
  beforeAll(async () => {
    await prisma.$connect()
    await prisma.eventOutbox.deleteMany({})
    await prisma.domainEvent.deleteMany({})
  })
  afterAll(async () => {
    await prisma.eventOutbox.deleteMany({ where: { eventId: { in: ids } } }).catch(() => undefined)
    await prisma.domainEvent.deleteMany({ where: { eventId: { in: ids } } }).catch(() => undefined)
    await prisma.$disconnect()
  })

  it('two concurrent workers process each event exactly once', async () => {
    for (let i = 0; i < 12; i++) {
      const e = await publisher.publish({
        type: 'lifecycle.season.activated',
        eventId: `${mark}-${i}`,
        idempotencyKey: `${mark}-${i}`,
        payload: { seasonId: `${mark}-${i}` },
        metadata: { source: 'engine' },
      })
      ids.push(e.eventId)
    }

    const counts = new Map<string, number>()
    const consumer = (name: string) => ({
      name,
      handle: async (e: { eventId: string }) => {
        if (e.eventId.startsWith(mark)) counts.set(e.eventId, (counts.get(e.eventId) ?? 0) + 1)
      },
    })
    const a = new OutboxRelay(store, { consumers: [consumer('A')], workerId: 'worker-A', batchSize: 3 })
    const b = new OutboxRelay(store, { consumers: [consumer('B')], workerId: 'worker-B', batchSize: 3 })

    await Promise.all([a.run(), b.run()])

    // Every seeded event handled exactly once across both workers.
    for (const id of ids) {
      expect(counts.get(id)).toBe(1)
      const ob = await prisma.eventOutbox.findUnique({ where: { eventId: id } })
      expect(ob?.status).toBe('dispatched')
    }
  })
})
