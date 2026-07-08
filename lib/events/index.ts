/**
 * G15.1 — Event Foundation: public surface.
 *
 * Import from `@/lib/events` everywhere. Internal module layout may change; this
 * barrel is the stable contract.
 *
 * Quick start (see docs/g15-1-event-foundation.md for the full guide):
 *
 *   import { getEventPublisher } from '@/lib/events'
 *   await prisma.$transaction(async (tx) => {
 *     // ... your business writes on tx ...
 *     await getEventPublisher().publish(
 *       { type: 'lifecycle.season.activated', sport: 'NFL', leagueConcept: 'redraft',
 *         leagueId, seasonId, actor: { type: 'commissioner', id: userId },
 *         metadata: { source: 'engine' }, payload: { seasonId } },
 *       { tx },
 *     )
 *   })
 */
export * from './types'
export { domainEventEnvelopeSchema, normalizeDomainEvent } from './envelope'
export { InMemoryEventSchemaRegistry, zodValidator } from './schemaRegistry'
export { InProcessEventBus, inProcessEventBus } from './eventBus'
export { EventNormalizer, type EventNormalizerOptions } from './normalizer'
export { EventPublisher } from './eventPublisher'
export {
  OutboxRelay,
  type OutboxRelayOptions,
  type DispatchSummary,
  type RunOptions,
  type RelayLogger,
  type RelayLogLevel,
} from './outboxRelay'
// G15.3 — first projection (event audit feed / activity timeline)
export {
  AUDIT_FEED_PROJECTION,
  summarizeEvent,
  toAuditFeedEntry,
  createAuditFeedConsumer,
  createPrismaAuditFeedUpsert,
  createPrismaAuditFeedConsumer,
  rebuildAuditFeed,
  type AuditFeedEntryInput,
  type AuditFeedUpsert,
  type AuditFeedPrisma,
} from './projections/auditFeed'
export {
  PrismaOutboxStore,
  InMemoryOutboxStore,
  rowToDomainEvent,
  type PrismaLike,
} from './outboxStore'
export {
  getEventInfrastructure,
  configureEventInfrastructure,
  resetEventInfrastructure,
  getEventPublisher,
  getEventBus,
  getEventSchemaRegistry,
  getOutboxRelay,
  type EventInfrastructure,
  type EventInfrastructureOverrides,
} from './container'
// G15.2 — catalog + producers
export {
  EVENT,
  EVENT_PAYLOAD_SCHEMAS,
  EVENT_SCHEMA_VERSION,
  ALL_EVENT_TYPES,
  registerPlatformEventSchemas,
  type EventType,
  type PayloadByType,
} from './catalog'
export {
  PlatformEventProducer,
  getPlatformEvents,
  resetPlatformEvents,
  type EmitContext,
  type EmitArgs,
} from './producers'
