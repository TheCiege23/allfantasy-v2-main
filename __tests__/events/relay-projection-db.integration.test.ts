/**
 * G15.3 — Relay + audit-feed projection DB integration.
 *
 * OPT-IN: RUN_EVENT_DB_IT=1 + DATABASE_URL → NON-prod DB with both migrations applied.
 * Proves the full pipeline end-to-end: publish (outbox) → relay → durable consumer
 * writes the read model → idempotent redelivery → rebuild from the log.
 *
 *   RUN_EVENT_DB_IT=1 DATABASE_URL=<staging> \
 *     npx vitest run __tests__/events/relay-projection-db.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  PrismaOutboxStore, EventPublisher, EventNormalizer, OutboxRelay, InMemoryEventSchemaRegistry,
  createPrismaAuditFeedConsumer, rebuildAuditFeed,
  type PrismaLike, type AuditFeedPrisma,
} from '@/lib/events'

const RUN = process.env.RUN_EVENT_DB_IT === '1'
const d = RUN ? describe : describe.skip

d('relay + audit-feed projection (real database)', () => {
  const prisma = new PrismaClient()
  const store = new PrismaOutboxStore(prisma as unknown as PrismaLike)
  const consumer = createPrismaAuditFeedConsumer(prisma as unknown as AuditFeedPrisma)
  const publisher = new EventPublisher(new EventNormalizer(new InMemoryEventSchemaRegistry()), store)
  const relay = new OutboxRelay(store, { consumers: [consumer], maxRetries: 5 })
  const mark = `RELAYIT-${Date.now()}`
  const ids: string[] = []

  // These DB ITs exercise the GLOBAL outbox/relay, so they must run serially
  // (vitest --fileParallelism=false). Clean the event tables first for isolation.
  beforeAll(async () => {
    await prisma.$connect()
    await prisma.auditFeedEntry.deleteMany({})
    await prisma.eventOutbox.deleteMany({})
    await prisma.domainEvent.deleteMany({})
  })
  afterAll(async () => {
    await prisma.auditFeedEntry.deleteMany({ where: { eventId: { in: ids } } }).catch(() => undefined)
    await prisma.eventOutbox.deleteMany({ where: { eventId: { in: ids } } }).catch(() => undefined)
    await prisma.domainEvent.deleteMany({ where: { eventId: { in: ids } } }).catch(() => undefined)
    await prisma.$disconnect()
  })

  it('drains the outbox into the audit feed (durable consumer)', async () => {
    for (let i = 0; i < 3; i++) {
      const e = await publisher.publish({
        type: 'lifecycle.season.activated',
        eventId: `${mark}-${i}`,
        idempotencyKey: `${mark}-${i}`,
        leagueId: `${mark}-L`,
        seasonId: `${mark}-S${i}`,
        actor: { type: 'system' },
        metadata: { source: 'engine' },
        payload: { seasonId: `${mark}-S${i}` },
      })
      ids.push(e.eventId)
    }

    const summary = await relay.run()
    expect(summary.dispatched).toBeGreaterThanOrEqual(3)

    for (const id of ids) {
      const entry = await prisma.auditFeedEntry.findUnique({ where: { eventId: id } })
      expect(entry?.summary).toBe('Season activated')
      const ob = await prisma.eventOutbox.findUnique({ where: { eventId: id } })
      expect(ob?.status).toBe('dispatched')
    }
  })

  it('is idempotent: re-running the relay does not duplicate rows', async () => {
    const before = await prisma.auditFeedEntry.count({ where: { eventId: { in: ids } } })
    await relay.run() // nothing pending now
    const after = await prisma.auditFeedEntry.count({ where: { eventId: { in: ids } } })
    expect(after).toBe(before)
  })

  it('rebuild re-derives the feed from the event log', async () => {
    // Delete this run's audit rows, then rebuild from domain_events and confirm they return.
    await prisma.auditFeedEntry.deleteMany({ where: { eventId: { in: ids } } })
    const res = await rebuildAuditFeed(prisma as unknown as AuditFeedPrisma, { batchSize: 500 })
    expect(res.rebuilt).toBeGreaterThanOrEqual(3)
    for (const id of ids) {
      expect(await prisma.auditFeedEntry.findUnique({ where: { eventId: id } })).toBeTruthy()
    }
  })
})
