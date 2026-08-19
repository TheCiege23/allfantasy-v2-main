/**
 * G15.1 — Event Foundation: dependency-injection composition root.
 *
 * Existing systems resolve the event infrastructure here without changing their
 * behavior — nothing is auto-wired onto the bus in G15.1. The default graph is
 * built lazily and cached on globalThis; tests/adapters swap any part via
 * `configureEventInfrastructure` (DIP — every component is replaceable).
 */
import { prisma } from '@/lib/prisma'
import { inProcessEventBus } from './eventBus'
import { EventNormalizer } from './normalizer'
import { EventPublisher } from './eventPublisher'
import { OutboxRelay } from './outboxRelay'
import { InMemoryEventSchemaRegistry } from './schemaRegistry'
import { PrismaOutboxStore, type PrismaLike } from './outboxStore'
import type { IEventBus, IEventPublisher, IEventSchemaRegistry, IOutboxStore } from './types'

export interface EventInfrastructure {
  registry: IEventSchemaRegistry
  normalizer: EventNormalizer
  bus: IEventBus
  outboxStore: IOutboxStore
  publisher: IEventPublisher
  relay: OutboxRelay
}

export interface EventInfrastructureOverrides {
  registry?: IEventSchemaRegistry
  normalizer?: EventNormalizer
  bus?: IEventBus
  outboxStore?: IOutboxStore
  publisher?: IEventPublisher
  relay?: OutboxRelay
  /** Reject events whose (type, version) has no registered schema. Default false. */
  strict?: boolean
}

function build(overrides: EventInfrastructureOverrides = {}): EventInfrastructure {
  const registry = overrides.registry ?? new InMemoryEventSchemaRegistry()
  const normalizer = overrides.normalizer ?? new EventNormalizer(registry, { strict: overrides.strict ?? false })
  const bus = overrides.bus ?? inProcessEventBus
  const outboxStore = overrides.outboxStore ?? new PrismaOutboxStore(prisma as unknown as PrismaLike)
  const publisher = overrides.publisher ?? new EventPublisher(normalizer, outboxStore)
  // Default relay does best-effort fan-out only (no DB consumers) so unit tests and
  // the default runtime stay side-effect-light. Durable consumers (e.g. the audit-feed
  // projection) are wired by the relay runner — see scripts/run-outbox-relay.ts.
  const relay = overrides.relay ?? new OutboxRelay(outboxStore, { bus })
  return { registry, normalizer, bus, outboxStore, publisher, relay }
}

const g = globalThis as typeof globalThis & { __afEventInfra?: EventInfrastructure }

/** Resolve the process-wide event infrastructure (builds + caches defaults on first call). */
export function getEventInfrastructure(): EventInfrastructure {
  return g.__afEventInfra ?? (g.__afEventInfra = build())
}

/** Replace the infrastructure with a consistent graph built from `overrides` (swap/test seam). */
export function configureEventInfrastructure(overrides: EventInfrastructureOverrides): EventInfrastructure {
  g.__afEventInfra = build(overrides)
  return g.__afEventInfra
}

/** Clear the cached infrastructure so the next resolve rebuilds defaults (tests). */
export function resetEventInfrastructure(): void {
  delete g.__afEventInfra
}

// Convenience resolvers for the common dependencies.
export const getEventPublisher = (): IEventPublisher => getEventInfrastructure().publisher
export const getEventBus = (): IEventBus => getEventInfrastructure().bus
export const getEventSchemaRegistry = (): IEventSchemaRegistry => getEventInfrastructure().registry
export const getOutboxRelay = (): OutboxRelay => getEventInfrastructure().relay
