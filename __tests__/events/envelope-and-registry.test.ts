import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  normalizeDomainEvent,
  domainEventEnvelopeSchema,
  InMemoryEventSchemaRegistry,
  zodValidator,
  DEFAULT_TENANT,
} from '@/lib/events'

describe('normalizeDomainEvent', () => {
  it('fills envelope defaults and freezes the result', () => {
    const e = normalizeDomainEvent({ type: 'lifecycle.season.activated', payload: { seasonId: 's1' } })
    expect(e.eventId).toMatch(/[0-9a-f-]{36}/)
    expect(e.idempotencyKey).toBe(e.eventId) // defaults to eventId
    expect(e.schemaVersion).toBe(1)
    expect(e.tenantId).toBe(DEFAULT_TENANT)
    expect(e.actor).toEqual({ type: 'system', id: null })
    expect(e.sport).toBeNull()
    expect(e.leagueConcept).toBeNull()
    expect(e.subjects).toEqual([])
    expect(e.period).toBeNull()
    expect(e.metadata.source).toBe('unknown')
    expect(typeof e.occurredAt).toBe('string')
    expect(typeof e.recordedAt).toBe('string')
    expect(Object.isFrozen(e)).toBe(true)
  })

  it('honors provided values and normalizes occurredAt to ISO', () => {
    const when = new Date('2026-01-02T03:04:05.000Z')
    const e = normalizeDomainEvent({
      type: 'competition.matchup.finalized',
      sport: 'NBA',
      leagueConcept: 'dynasty',
      leagueId: 'L1',
      seasonId: 'S1',
      occurredAt: when,
      eventId: 'fixed-id',
      idempotencyKey: 'dedupe-1',
      actor: { type: 'commissioner', id: 'u9' },
      period: { kind: 'day', index: 12 },
      subjects: [{ kind: 'matchup', id: 'm1' }],
      metadata: { source: 'engine', correlationId: 'c1', extra: 7 },
      payload: { homeScore: 110 },
    })
    expect(e.eventId).toBe('fixed-id')
    expect(e.idempotencyKey).toBe('dedupe-1')
    expect(e.occurredAt).toBe('2026-01-02T03:04:05.000Z')
    expect(e.sport).toBe('NBA')
    expect(e.period).toEqual({ kind: 'day', index: 12 })
    expect(e.metadata).toMatchObject({ source: 'engine', correlationId: 'c1', extra: 7 })
  })

  it('falls back to now() for an invalid occurredAt', () => {
    const e = normalizeDomainEvent({ type: 'a.b', occurredAt: 'not-a-date', payload: {} })
    expect(Number.isNaN(new Date(e.occurredAt).getTime())).toBe(false)
  })
})

describe('domainEventEnvelopeSchema', () => {
  it('accepts a normalized event', () => {
    const e = normalizeDomainEvent({ type: 'a.b.c', payload: {}, metadata: { source: 'engine' } })
    expect(domainEventEnvelopeSchema.safeParse(e).success).toBe(true)
  })

  it('rejects a malformed type', () => {
    const e = normalizeDomainEvent({ type: 'Bad Type!', payload: {} })
    expect(domainEventEnvelopeSchema.safeParse(e).success).toBe(false)
  })
})

describe('InMemoryEventSchemaRegistry', () => {
  it('registers, reports versions, and validates', () => {
    const reg = new InMemoryEventSchemaRegistry()
    reg.register('competition.score.updated', 1, zodValidator(z.object({ playerId: z.string(), points: z.number() })))
    expect(reg.has('competition.score.updated')).toBe(true)
    expect(reg.has('competition.score.updated', 1)).toBe(true)
    expect(reg.has('competition.score.updated', 2)).toBe(false)
    expect(reg.latestVersion('competition.score.updated')).toBe(1)
    expect(reg.validate('competition.score.updated', 1, { playerId: 'p', points: 5 })).toEqual({ ok: true })
    const bad = reg.validate('competition.score.updated', 1, { playerId: 'p' })
    expect(bad.ok).toBe(false)
  })

  it('supports additive versioning and forbids mutating an existing version', () => {
    const reg = new InMemoryEventSchemaRegistry()
    reg.register('x.y', 1, () => ({ ok: true }))
    reg.register('x.y', 2, () => ({ ok: true }))
    expect(reg.latestVersion('x.y')).toBe(2)
    expect(() => reg.register('x.y', 1, () => ({ ok: true }))).toThrow(/already registered/)
  })

  it('reports unknown types/versions as invalid', () => {
    const reg = new InMemoryEventSchemaRegistry()
    expect(reg.validate('nope', 1, {}).ok).toBe(false)
  })
})
