/**
 * Commissioner OS · T-007 — the audit writer and the outbox adapter.
 *
 * The append-only guarantee itself is a database property (a REVOKE plus a
 * BEFORE UPDATE OR DELETE trigger) and is asserted in `audit.spec.ts`, which
 * needs the T-001 roles and a real Postgres. What is testable here is
 * everything that decides WHAT gets written: the field mapping, the redaction,
 * and the ordering guarantees the mutation wrapper provides around it.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  REDACTION_MARKER,
  buildAuditRow,
  createAuditWriter,
  redactSensitive,
} from '@/lib/domain/audit'
import { buildDomainEvent, createOutboxEnqueue, eventActorFor } from '@/lib/domain/events'
import { createActorContext, syntheticIntegrationActor } from '@/lib/domain/actorContext'
import { createMutationRunner } from '@/lib/domain/mutation'
import { ok } from '@/lib/domain/result'

const ctx = (over: Record<string, unknown> = {}) => {
  const r = createActorContext({
    userId: 'u1',
    actorLabel: 'Dana Okafor',
    tenantId: 't1',
    tenantRole: 'TENANT_ADMIN',
    requestId: 'req-1',
    ...over,
  } as any)
  if (!r.ok) throw new Error('bad fixture')
  return r.value
}

const draft = {
  action: 'league.rename',
  resourceType: 'League',
  resourceId: 'l1',
  before: { name: 'Old' },
  after: { name: 'New' },
}

describe('T-007 · the audit row', () => {
  it('denormalises the actor label rather than referencing the user', () => {
    // The trail must stay readable after the person is deleted. A join renders
    // years of history as "unknown" the day someone leaves — which is exactly
    // what LeagueAuditLog does with its onDelete: SetNull actor FK.
    const row = buildAuditRow(ctx(), draft)
    expect(row.actorLabel).toBe('Dana Okafor')
    expect(row.actorUserId).toBe('u1')
  })

  it('records all three role axes', () => {
    const row = buildAuditRow(
      ctx({ platformRole: 'PLATFORM_SUPPORT', leagueRole: 'COMMISSIONER' }),
      draft,
    )
    expect(row).toMatchObject({
      platformRole: 'PLATFORM_SUPPORT',
      tenantRole: 'TENANT_ADMIN',
      leagueRole: 'COMMISSIONER',
    })
  })

  it('carries the requestId that ties it to the logs and the events', () => {
    expect(buildAuditRow(ctx(), draft).requestId).toBe('req-1')
  })

  it('is tenant-scoped', () => {
    expect(buildAuditRow(ctx(), draft).tenantId).toBe('t1')
  })

  it('does NOT infer isPlatformRead from the platform role', () => {
    // A platform admin doing ordinary work inside their own tenant is not a
    // cross-tenant read. Marking it as one would flood the operator-facing
    // disclosure list until it means nothing — which is worse than not
    // disclosing, because it looks like disclosure.
    const row = buildAuditRow(ctx({ platformRole: 'PLATFORM_ADMIN' }), draft)
    expect(row.isPlatformRead).toBe(false)
  })

  it('falls back to onBehalfOfLeagueId when the draft names no league', () => {
    const row = buildAuditRow(ctx({ onBehalfOfLeagueId: 'l9' }), draft)
    expect(row.leagueId).toBe('l9')
    expect(row.onBehalfOfLeagueId).toBe('l9')
  })

  it('prefers the draft’s explicit leagueId', () => {
    const row = buildAuditRow(ctx({ onBehalfOfLeagueId: 'l9' }), { ...draft, leagueId: 'l1' })
    expect(row.leagueId).toBe('l1')
  })

  it('uses null rather than undefined for absent optional fields', () => {
    // undefined does not survive JSON, and a Prisma `create` treats it as
    // "leave unset" rather than "set null" — different rows for the same input.
    const row = buildAuditRow(ctx(), { action: 'a', resourceType: 'R', resourceId: 'r' })
    expect(row.before).toBeNull()
    expect(row.after).toBeNull()
    expect(row.metadata).toBeNull()
    expect(row.reason).toBeNull()
  })
})

describe('T-007 · redaction', () => {
  it.each([
    'password',
    'apiKey',
    'api_key',
    'secret',
    'clientSecret',
    'token',
    'RSC_token',
    'authorization',
    'cookie',
    'privateKey',
  ])('redacts %s', (key) => {
    expect(redactSensitive({ [key]: 'real-value' })).toEqual({ [key]: REDACTION_MARKER })
  })

  it('is case-insensitive', () => {
    expect(redactSensitive({ PASSWORD: 'x', ApiKey: 'y' })).toEqual({
      PASSWORD: REDACTION_MARKER,
      ApiKey: REDACTION_MARKER,
    })
  })

  it('redacts nested values', () => {
    expect(redactSensitive({ provider: { config: { token: 'abc' }, name: 'sleeper' } })).toEqual({
      provider: { config: { token: REDACTED_OBJECT_MARKER() }, name: 'sleeper' },
    })
  })

  it('redacts inside arrays', () => {
    expect(redactSensitive({ creds: [{ token: 'a' }, { token: 'b' }] })).toEqual({
      creds: [{ token: REDACTION_MARKER }, { token: REDACTION_MARKER }],
    })
  })

  it('leaves ordinary fields alone', () => {
    expect(redactSensitive({ name: 'Mike', week: 4, active: true, at: null })).toEqual({
      name: 'Mike',
      week: 4,
      active: true,
      at: null,
    })
  })

  it('matches on the KEY, not the value shape', () => {
    // A field called apiKey holds a key whatever its value looks like.
    // Value-shape detection is the secret scanner's job, at the push boundary.
    expect(redactSensitive({ apiKey: 12345 })).toEqual({ apiKey: REDACTION_MARKER })
  })

  it('bounds depth rather than throwing', () => {
    // A pathological payload must not turn an audit write — which runs inside
    // the caller's transaction, holding its row locks — into a hang. And it
    // must not throw: failing the audit fails the mutation, and deep nesting is
    // not a reason to refuse a legitimate write.
    let deep: Record<string, unknown> = { end: true }
    for (let i = 0; i < 40; i++) deep = { nested: deep }
    expect(() => redactSensitive(deep)).not.toThrow()
    expect(JSON.stringify(redactSensitive(deep))).toContain('too deep')
  })

  it('is applied by buildAuditRow to before, after and metadata', () => {
    const row = buildAuditRow(ctx(), {
      action: 'a',
      resourceType: 'R',
      resourceId: 'r',
      before: { token: 'before-secret' },
      after: { token: 'after-secret' },
      metadata: { apiKey: 'meta-secret' },
    })
    const serialized = JSON.stringify(row)
    expect(serialized).not.toContain('before-secret')
    expect(serialized).not.toContain('after-secret')
    expect(serialized).not.toContain('meta-secret')
  })
})

function REDACTED_OBJECT_MARKER() {
  return REDACTION_MARKER
}

describe('T-007 · the writer joins the caller’s transaction', () => {
  it('writes through the tx it was given, not its own client', () => {
    // Invariant 3. A writer holding its own connection commits independently,
    // so a rolled-back mutation leaves a record of something that never
    // happened — worse than no audit, because it is confidently wrong.
    const create = vi.fn(async () => ({}))
    const tx = { auditEvent: { create } } as any

    return createAuditWriter()(tx, ctx(), draft).then(() => {
      expect(create).toHaveBeenCalledTimes(1)
      expect(create.mock.calls[0][0].data).toMatchObject({ tenantId: 't1', action: 'league.rename' })
    })
  })
})

describe('T-007 · the outbox adapter', () => {
  const now = () => new Date('2026-08-31T12:00:00.000Z')

  it('maps the synthetic integration actor to `provider`, not `system`', () => {
    // T-203 requires sync-caused rows to be distinguishable from human writes.
    // `system` is what a cron job is; a provider is untrusted input wearing an
    // actor, and collapsing the two loses the distinction that matters.
    const r = syntheticIntegrationActor('t1', 'sleeper')
    if (!r.ok) throw new Error('bad fixture')
    expect(eventActorFor(r.value)).toEqual({ type: 'provider', id: 'integration:sleeper' })
  })

  it('maps a commissioner distinctly from an ordinary user', () => {
    expect(eventActorFor(ctx({ leagueRole: 'COMMISSIONER' })).type).toBe('commissioner')
    expect(eventActorFor(ctx()).type).toBe('user')
  })

  it('carries tenantId and the requestId as correlationId', () => {
    const event = buildDomainEvent(ctx(), { type: 'league.renamed', payload: { id: 'l1' } }, now(), 'e1')
    expect(event).toMatchObject({ tenantId: 't1', type: 'league.renamed' })
    expect((event.metadata as Record<string, unknown>).correlationId).toBe('req-1')
  })

  it('defaults idempotencyKey to the eventId', () => {
    const event = buildDomainEvent(ctx(), { type: 't', payload: {} }, now(), 'e1')
    expect(event.idempotencyKey).toBe('e1')
  })

  it('enqueues through the caller’s tx', async () => {
    const enqueue = vi.fn(async () => {})
    const tx = { id: 'tx-1' } as any
    const enqueueEvents = createOutboxEnqueue({ outbox: { enqueue }, now, newEventId: () => 'e1' })

    await enqueueEvents(tx, ctx(), [{ type: 'a', payload: {} }])

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: 'a' }), { tx })
  })

  it('enqueues sequentially, preserving declared order', async () => {
    const seen: string[] = []
    const enqueue = vi.fn(async (e: any) => {
      seen.push(e.type)
    })
    const enqueueEvents = createOutboxEnqueue({ outbox: { enqueue }, now, newEventId: () => 'e' })

    await enqueueEvents({} as any, ctx(), [
      { type: 'first', payload: {} },
      { type: 'second', payload: {} },
    ])

    expect(seen).toEqual(['first', 'second'])
  })
})

describe('T-007 · the outbox path in the mutation wrapper', () => {
  function harness(withOutbox: boolean) {
    const log: string[] = []
    const tx = { id: 'tx-1' } as any
    const withTenant = async <T,>(_t: string, fn: (t: any) => Promise<T>) => {
      log.push('begin')
      try {
        const v = await fn(tx)
        log.push('commit')
        return v
      } catch (e) {
        log.push('rollback')
        throw e
      }
    }
    const enqueueEvents = vi.fn(async () => {
      log.push('enqueue')
    })
    const emit = vi.fn(async () => {
      log.push('emit')
    })
    return {
      log,
      tx,
      enqueueEvents,
      emit,
      run: createMutationRunner({
        withTenant,
        authorize: async () => ok(undefined),
        writeAudit: async () => {
          log.push('audit')
        },
        emit,
        ...(withOutbox ? { enqueueEvents } : {}),
      }),
    }
  }

  const def = {
    action: 'league.rename',
    requires: 'league.settings.update',
    resourceType: 'League',
    load: async () => ({ id: 'l1' }),
    run: async () => ok({ id: 'l1' }),
    audit: () => ({ action: 'league.rename', resourceType: 'League', resourceId: 'l1' }),
    events: () => [{ type: 'league.renamed', payload: {} }],
  } as any

  it('enqueues INSIDE the transaction and does not emit after commit', async () => {
    const h = harness(true)
    await h.run(def, ctx(), {})

    // The enqueue lands before commit — it is a row in the same transaction,
    // not a delivery. Delivery is the relay's job.
    expect(h.log).toEqual(['begin', 'audit', 'enqueue', 'commit'])
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('the enqueue rolls back with the mutation', async () => {
    const h = harness(true)
    const failing = {
      ...def,
      run: async () => {
        throw new Error('boom')
      },
    }
    await expect(h.run(failing, ctx(), {})).rejects.toThrow('boom')

    // Never reached the enqueue, and nothing committed — so no event exists to
    // describe something that did not happen.
    expect(h.log).toEqual(['begin', 'rollback'])
    expect(h.enqueueEvents).not.toHaveBeenCalled()
  })

  it('falls back to after-commit emit when no outbox is configured', async () => {
    const h = harness(false)
    await h.run(def, ctx(), {})
    expect(h.log).toEqual(['begin', 'audit', 'commit', 'emit'])
  })
})
