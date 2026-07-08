/**
 * G15.3 — First projection: Event Audit Feed (a.k.a. League Activity Timeline).
 *
 * A DISPOSABLE read model derived from DomainEvents. It is the relay's first durable
 * consumer. No business behavior depends on it; it can be dropped and rebuilt from
 * `domain_events` at any time. Idempotent by `eventId` (at-least-once delivery → upsert).
 *
 * Privacy: the summary contains NO chat content and NO PII — only a readable label
 * plus ids/period already present in the envelope.
 */
import type { DomainEvent, EventConsumer } from '../types'
import { rowToDomainEvent, type PrismaLike } from '../outboxStore'

export const AUDIT_FEED_PROJECTION = 'event_audit_feed'

export interface AuditFeedEntryInput {
  eventId: string
  tenantId: string
  leagueId: string | null
  seasonId: string | null
  type: string
  summary: string
  sport: string | null
  leagueConcept: string | null
  actorType: string | null
  actorId: string | null
  occurredAt: Date
}

/** Human-readable labels for known types; unknown types fall back to the type string. */
const LABELS: Record<string, string> = {
  'lifecycle.league.created': 'League created',
  'lifecycle.league.archived': 'League archived',
  'lifecycle.season.activated': 'Season activated',
  'lifecycle.season.completed': 'Season completed',
  'lifecycle.schedule.generated': 'Schedule generated',
  'draft.session.started': 'Draft started',
  'draft.session.completed': 'Draft completed',
  'draft.pick.made': 'Draft pick made',
  'transaction.trade.accepted': 'Trade accepted',
  'transaction.trade.processed': 'Trade processed',
  'transaction.trade.vetoed': 'Trade vetoed',
  'transaction.waiver.processed': 'Waiver processed',
  'transaction.waiver.window_processed': 'Waiver run processed',
  'competition.matchup.finalized': 'Matchup finalized',
  'competition.matchup.updated': 'Matchup updated',
  'competition.standings.updated': 'Standings updated',
  'competition.champion.crowned': 'Champion crowned',
  'governance.settings.changed': 'League settings changed',
  'auth.user.registered': 'User registered',
}

/** Pure, privacy-safe summary. */
export function summarizeEvent(event: DomainEvent): string {
  const base = LABELS[event.type] ?? event.type
  const p = event.period
  const suffix = p && p.kind !== 'none' && p.index != null ? ` (${p.kind} ${p.index})` : ''
  return base + suffix
}

/** Pure mapping from a DomainEvent to an audit-feed row. */
export function toAuditFeedEntry(event: DomainEvent): AuditFeedEntryInput {
  return {
    eventId: event.eventId,
    tenantId: event.tenantId,
    leagueId: event.leagueId,
    seasonId: event.seasonId,
    type: event.type,
    summary: summarizeEvent(event),
    sport: event.sport,
    leagueConcept: event.leagueConcept,
    actorType: event.actor.type,
    actorId: event.actor.id ?? null,
    occurredAt: new Date(event.occurredAt),
  }
}

export type AuditFeedUpsert = (entry: AuditFeedEntryInput) => Promise<void>

/** The relay consumer. Idempotent: upsert keyed on eventId. */
export function createAuditFeedConsumer(upsert: AuditFeedUpsert): EventConsumer {
  return {
    name: AUDIT_FEED_PROJECTION,
    handle: async (event: DomainEvent) => {
      await upsert(toAuditFeedEntry(event))
    },
  }
}

// ── Prisma binding ───────────────────────────────────────────────────────────

export interface AuditFeedPrisma extends PrismaLike {
  auditFeedEntry: {
    upsert(args: Record<string, unknown>): Promise<unknown>
    deleteMany(args: Record<string, unknown>): Promise<unknown>
    count(args?: Record<string, unknown>): Promise<number>
  }
  projectionCheckpoint: {
    upsert(args: Record<string, unknown>): Promise<unknown>
  }
  domainEvent: PrismaLike['domainEvent'] & { count(args?: Record<string, unknown>): Promise<number> }
}

export function createPrismaAuditFeedUpsert(client: AuditFeedPrisma): AuditFeedUpsert {
  return async (entry: AuditFeedEntryInput) => {
    await client.auditFeedEntry.upsert({
      where: { eventId: entry.eventId },
      create: entry as unknown as Record<string, unknown>,
      update: { summary: entry.summary, type: entry.type, occurredAt: entry.occurredAt },
    })
  }
}

/** Build the audit-feed relay consumer backed by a Prisma client. */
export function createPrismaAuditFeedConsumer(client: AuditFeedPrisma): EventConsumer {
  return createAuditFeedConsumer(createPrismaAuditFeedUpsert(client))
}

/**
 * Rebuild the audit feed from scratch by replaying every domain event (oldest first).
 * Safe to run any time — clears then re-derives. Returns the number of events replayed.
 */
export async function rebuildAuditFeed(
  client: AuditFeedPrisma,
  opts: { batchSize?: number } = {},
): Promise<{ rebuilt: number }> {
  const batchSize = opts.batchSize ?? 500
  await client.auditFeedEntry.deleteMany({})
  const upsert = createPrismaAuditFeedUpsert(client)
  const consumer = createAuditFeedConsumer(upsert)

  let cursor: string | undefined
  let total = 0
  let lastEventId: string | null = null
  let lastOccurredAt: Date | null = null

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await client.domainEvent.findMany({
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (rows.length === 0) break
    for (const row of rows) {
      const event = rowToDomainEvent(row)
      await consumer.handle(event)
      lastEventId = event.eventId
      lastOccurredAt = new Date(event.occurredAt)
    }
    total += rows.length
    cursor = (rows[rows.length - 1] as { id?: string }).id
    if (rows.length < batchSize) break
  }

  await client.projectionCheckpoint.upsert({
    where: { projection: AUDIT_FEED_PROJECTION },
    create: { projection: AUDIT_FEED_PROJECTION, lastEventId, lastOccurredAt, eventsProcessed: total },
    update: { lastEventId, lastOccurredAt, eventsProcessed: total },
  })

  return { rebuilt: total }
}
