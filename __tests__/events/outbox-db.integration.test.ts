/**
 * G15.1 — Event Foundation: DB integration (transactional outbox).
 *
 * OPT-IN: runs only when RUN_EVENT_DB_IT=1 with DATABASE_URL pointed at a NON-prod
 * DB (the migration must be applied first). Proves the real transactional
 * guarantee that unit tests (in-memory) cannot: events commit atomically with the
 * business transaction, and the relay delivers them to the bus.
 *
 *   RUN_EVENT_DB_IT=1 DATABASE_URL=<staging> \
 *     npx vitest run __tests__/events/outbox-db.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  PrismaOutboxStore,
  EventPublisher,
  EventNormalizer,
  OutboxRelay,
  InProcessEventBus,
  InMemoryEventSchemaRegistry,
  type DomainEvent,
  type PrismaLike,
} from '@/lib/events'

const RUN = process.env.RUN_EVENT_DB_IT === '1'
const d = RUN ? describe : describe.skip

d('transactional outbox against a real database', () => {
  const prisma = new PrismaClient()
  const store = new PrismaOutboxStore(prisma as unknown as PrismaLike)
  const bus = new InProcessEventBus()
  const publisher = new EventPublisher(new EventNormalizer(new InMemoryEventSchemaRegistry()), store)
  const relay = new OutboxRelay(store, { bus })
  const created: string[] = []
  const mark = `EVTIT-${Date.now()}`

  beforeAll(async () => {
    await prisma.$connect()
  })

  afterAll(async () => {
    if (created.length) {
      await prisma.eventOutbox.deleteMany({ where: { eventId: { in: created } } }).catch(() => undefined)
      await prisma.domainEvent.deleteMany({ where: { eventId: { in: created } } }).catch(() => undefined)
    }
    await prisma.$disconnect()
  })

  it('persists event + outbox row atomically inside a business transaction', async () => {
    const eventId = `${mark}-ok`
    created.push(eventId)
    await prisma.$transaction(async (tx) => {
      // (a real caller would also do business writes on tx here)
      await publisher.publish(
        {
          type: 'lifecycle.season.activated',
          eventId,
          idempotencyKey: eventId,
          sport: 'NFL',
          leagueConcept: 'redraft',
          leagueId: `${mark}-L`,
          seasonId: `${mark}-S`,
          actor: { type: 'system' },
          period: { kind: 'week', index: 1 },
          subjects: [{ kind: 'season', id: `${mark}-S` }],
          payload: { seasonId: `${mark}-S` },
          metadata: { source: 'engine', correlationId: `${mark}-corr` },
        },
        { tx },
      )
    })

    const ev = await prisma.domainEvent.findUnique({ where: { eventId } })
    const ob = await prisma.eventOutbox.findUnique({ where: { eventId } })
    expect(ev).toBeTruthy()
    expect(ev?.type).toBe('lifecycle.season.activated')
    expect(ev?.sport).toBe('NFL')
    expect(ev?.correlationId).toBe(`${mark}-corr`)
    expect(ob?.status).toBe('pending')
  })

  it('rolls back the event when the business transaction throws (atomicity)', async () => {
    const eventId = `${mark}-rollback`
    await expect(
      prisma.$transaction(async (tx) => {
        await publisher.publish(
          { type: 'lifecycle.league.created', eventId, idempotencyKey: eventId, payload: {}, metadata: { source: 'engine' } },
          { tx },
        )
        throw new Error('business failure after publish')
      }),
    ).rejects.toThrow('business failure')

    // Neither the event nor the outbox row should exist — they were rolled back.
    expect(await prisma.domainEvent.findUnique({ where: { eventId } })).toBeNull()
    expect(await prisma.eventOutbox.findUnique({ where: { eventId } })).toBeNull()
  })

  it('relay delivers pending events to the bus and marks them dispatched', async () => {
    const received: DomainEvent[] = []
    const off = bus.subscribe('lifecycle.*', (e) => {
      if (e.eventId.startsWith(mark)) received.push(e)
    })
    const summary = await relay.dispatchPending()
    off()

    expect(summary.dispatched).toBeGreaterThanOrEqual(1)
    expect(received.some((e) => e.eventId === `${mark}-ok`)).toBe(true)
    const ob = await prisma.eventOutbox.findUnique({ where: { eventId: `${mark}-ok` } })
    expect(ob?.status).toBe('dispatched')
    expect(ob?.dispatchedAt).toBeTruthy()
  })
})
