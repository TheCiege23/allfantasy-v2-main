/**
 * G15.1 — Event Foundation: envelope construction + structural validation.
 *
 * `normalizeDomainEvent` turns loose input into a complete, frozen DomainEvent
 * with stable defaults. `domainEventEnvelopeSchema` validates the envelope shape
 * (Zod) independent of any per-type payload schema.
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DEFAULT_TENANT, type DomainEvent, type DomainEventInput } from './types'

const eventActorSchema = z.object({
  type: z.enum(['user', 'commissioner', 'system', 'provider']),
  id: z.string().nullable().optional(),
})

const eventPeriodSchema = z
  .object({
    kind: z.enum(['week', 'day', 'gameday', 'stage', 'continuous', 'none']),
    index: z.number().int().nullable().optional(),
    label: z.string().nullable().optional(),
  })
  .nullable()

const eventSubjectSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
  label: z.string().nullable().optional(),
})

const eventMetadataSchema = z
  .object({ source: z.string().min(1) })
  .catchall(z.unknown())

/** Structural schema for the full envelope (payload validated separately by the registry). */
export const domainEventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  type: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:[._][a-z0-9]+)*$/i, 'type must be dot/underscore namespaced (e.g. "competition.matchup.finalized")'),
  schemaVersion: z.number().int().positive(),
  occurredAt: z.string().min(1),
  recordedAt: z.string().min(1),
  sport: z.string().nullable(),
  leagueConcept: z.string().nullable(),
  tenantId: z.string().min(1),
  leagueId: z.string().nullable(),
  seasonId: z.string().nullable(),
  actor: eventActorSchema,
  period: eventPeriodSchema,
  subjects: z.array(eventSubjectSchema),
  payload: z.record(z.unknown()),
  metadata: eventMetadataSchema,
  idempotencyKey: z.string().min(1),
})

function isoOf(v: string | Date | undefined, fallback: string): string {
  if (!v) return fallback
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString()
}

/**
 * Build a complete, immutable DomainEvent from loose input. Pure and
 * deterministic except for generated id/timestamps (override via input for tests).
 */
export function normalizeDomainEvent<T extends Record<string, unknown>>(
  input: DomainEventInput<T>,
): DomainEvent<T> {
  const now = new Date().toISOString()
  const eventId = input.eventId ?? randomUUID()
  const { source: _s, correlationId: _c, causationId: _cz, ...extraMeta } = input.metadata ?? {}

  const event: DomainEvent<T> = {
    eventId,
    type: input.type,
    schemaVersion: input.schemaVersion ?? 1,
    occurredAt: isoOf(input.occurredAt, now),
    recordedAt: now,
    sport: input.sport ?? null,
    leagueConcept: input.leagueConcept ?? null,
    tenantId: input.tenantId ?? DEFAULT_TENANT,
    leagueId: input.leagueId ?? null,
    seasonId: input.seasonId ?? null,
    actor: { type: input.actor?.type ?? 'system', id: input.actor?.id ?? null },
    period: input.period ?? null,
    subjects: input.subjects ?? [],
    payload: input.payload,
    metadata: {
      source: input.metadata?.source ?? 'unknown',
      correlationId: input.metadata?.correlationId ?? null,
      causationId: input.metadata?.causationId ?? null,
      ...extraMeta,
    },
    idempotencyKey: input.idempotencyKey ?? eventId,
  }

  return Object.freeze(event)
}
