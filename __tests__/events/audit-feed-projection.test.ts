import { describe, it, expect, vi } from 'vitest'
import {
  summarizeEvent,
  toAuditFeedEntry,
  createAuditFeedConsumer,
  rebuildAuditFeed,
  normalizeDomainEvent,
  type AuditFeedEntryInput,
  type DomainEventInput,
} from '@/lib/events'

function evt(over: Partial<DomainEventInput> = {}) {
  return normalizeDomainEvent({
    type: 'competition.champion.crowned',
    leagueId: 'L',
    seasonId: 'S',
    period: { kind: 'week', index: 14 },
    payload: { seasonId: 'S' },
    metadata: { source: 'engine' },
    ...over,
  })
}

describe('audit feed projection', () => {
  it('summarizes known + unknown types (privacy-safe, no payload content)', () => {
    expect(summarizeEvent(evt())).toBe('Champion crowned (week 14)')
    expect(summarizeEvent(evt({ type: 'some.unknown.type', period: null }))).toBe('some.unknown.type')
  })

  it('maps a domain event to an audit-feed entry', () => {
    const e = evt({ eventId: 'x', actor: { type: 'commissioner', id: 'u1' } })
    const entry = toAuditFeedEntry(e)
    expect(entry).toMatchObject({
      eventId: 'x',
      leagueId: 'L',
      seasonId: 'S',
      type: 'competition.champion.crowned',
      actorType: 'commissioner',
      actorId: 'u1',
    })
    expect(entry.occurredAt instanceof Date).toBe(true)
  })

  it('consumer is idempotent by eventId (at-least-once → one row)', async () => {
    const rows = new Map<string, AuditFeedEntryInput>()
    const upsert = vi.fn(async (e: AuditFeedEntryInput) => {
      rows.set(e.eventId, e)
    })
    const consumer = createAuditFeedConsumer(upsert)
    const e = evt({ eventId: 'dup' })
    await consumer.handle(e)
    await consumer.handle(e) // redelivery
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(rows.size).toBe(1)
  })

  it('rebuild clears + replays all domain events and writes a checkpoint', async () => {
    const row = {
      id: '1', eventId: 'a', type: 'lifecycle.season.activated', occurredAt: new Date(), recordedAt: new Date(),
      sport: null, leagueConcept: null, tenantId: 'allfantasy', leagueId: 'L', seasonId: 'S',
      actorType: 'system', actorId: null, source: 'engine', correlationId: null, causationId: null,
      idempotencyKey: 'a', payload: {}, metadata: {}, period: null, subjects: [],
    }
    const upserts: unknown[] = []
    const checkpoints: unknown[] = []
    let cleared = false
    const fake = {
      auditFeedEntry: {
        upsert: async (a: unknown) => { upserts.push(a) },
        deleteMany: async () => { cleared = true },
        count: async () => upserts.length,
      },
      domainEvent: {
        findMany: async (args: { cursor?: unknown }) => (args.cursor ? [] : [row]),
        count: async () => 1,
      },
      projectionCheckpoint: { upsert: async (a: unknown) => { checkpoints.push(a) } },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await rebuildAuditFeed(fake as any, { batchSize: 500 })
    expect(cleared).toBe(true)
    expect(res.rebuilt).toBe(1)
    expect(upserts).toHaveLength(1)
    expect(checkpoints).toHaveLength(1)
  })
})
