/**
 * Commissioner OS · T-004 acceptance — the mutation wrapper.
 *
 * Three criteria from HANDOFF.md:
 *   1. no event is emitted when the transaction rolls back
 *   2. the audit row is written in the same transaction
 *   3. a concurrent phase change yields CONFLICT, not a write against a stale phase
 *
 * All three are about ORDERING and ATOMICITY, which is control flow — so they
 * are asserted here against a fake transaction that records what happened and
 * when. `mutationConcurrency.spec.ts` re-proves (3) against real Postgres with
 * two competing transactions, because a fake cannot prove that `FOR UPDATE`
 * actually blocks.
 */

import { describe, it, expect, vi } from 'vitest'
import { createActorContext, type ActorContext } from '@/lib/domain/actorContext'
import { createMutationRunner, type MutationDefinition } from '@/lib/domain/mutation'
import { denyAll } from '@/lib/domain/ports'
import { err, ok } from '@/lib/domain/result'
import { forbidden, invariant } from '@/lib/domain/errors'

type League = { id: string; phase: string; name: string }

function actor(overrides: Partial<Parameters<typeof createActorContext>[0]> = {}): ActorContext {
  const r = createActorContext({
    userId: 'u1',
    actorLabel: 'Dana Okafor',
    tenantId: 'tenant_dynastyco',
    tenantRole: 'TENANT_ADMIN',
    ...overrides,
  })
  if (!r.ok) throw new Error('fixture actor is invalid')
  return r.value
}

/**
 * A fake `withTenant` that records commit/rollback, so "in the same
 * transaction" is observable rather than assumed.
 */
function makeHarness(opts: { allow?: boolean } = {}) {
  const log: string[] = []
  const tx = { id: 'tx-1' } as any

  const withTenant = vi.fn(async <T,>(tenantId: string, fn: (t: any) => Promise<T>) => {
    log.push(`begin:${tenantId}`)
    try {
      const value = await fn(tx)
      log.push('commit')
      return value
    } catch (e) {
      log.push('rollback')
      throw e
    }
  })

  const writeAudit = vi.fn(async (t: any) => {
    // Recording the tx identity is the actual assertion for criterion 2 — an
    // audit writer holding its own connection would receive a different one.
    log.push(t === tx ? 'audit:same-tx' : 'audit:OTHER-TX')
  })

  const emit = vi.fn(async () => {
    log.push('emit')
  })

  const authorize = opts.allow === false ? denyAll : vi.fn(async () => ok(undefined))
  const onEmitError = vi.fn()

  return {
    log,
    tx,
    withTenant,
    writeAudit,
    emit,
    authorize,
    onEmitError,
    run: createMutationRunner({ withTenant, authorize, writeAudit, emit, onEmitError }),
  }
}

function renameLeague(
  overrides: Partial<MutationDefinition<League, { name: string }, League>> = {},
): MutationDefinition<League, { name: string }, League> {
  return {
    action: 'league.rename',
    requires: 'league.settings.update',
    resourceType: 'League',
    load: async () => ({ id: 'l1', phase: 'PRESEASON', name: 'Old' }),
    phases: { of: (l) => l.phase, allowed: ['PRESEASON', 'OFFSEASON'], remedy: 'league.pause' },
    run: async ({ resource, input }) => ok({ ...resource, name: input.name }),
    audit: ({ resource, output }) => ({
      action: 'league.rename',
      resourceType: 'League',
      resourceId: resource.id,
      before: { name: resource.name },
      after: { name: output.name },
    }),
    events: ({ output }) => [{ type: 'league.renamed', payload: { id: output.id } }],
    ...overrides,
  }
}

describe('T-004 · ordering', () => {
  it('runs the whole pipeline and commits before emitting', async () => {
    const h = makeHarness()
    const r = await h.run(renameLeague(), actor(), { name: 'New' })

    expect(r.ok).toBe(true)
    // Criterion 2 and the emit-after-commit rule, in one readable sequence.
    expect(h.log).toEqual(['begin:tenant_dynastyco', 'audit:same-tx', 'commit', 'emit'])
  })

  it('opens the transaction with the actor’s tenantId', async () => {
    const h = makeHarness()
    await h.run(renameLeague(), actor(), { name: 'New' })
    expect(h.withTenant).toHaveBeenCalledWith('tenant_dynastyco', expect.any(Function))
  })
})

describe('T-004 · criterion 2 — audit is written in the same transaction', () => {
  it('receives the same tx object the mutation ran on', async () => {
    const h = makeHarness()
    await h.run(renameLeague(), actor(), { name: 'New' })
    expect(h.writeAudit).toHaveBeenCalledWith(h.tx, expect.anything(), expect.anything())
    expect(h.log).toContain('audit:same-tx')
  })

  it('writes audit BEFORE commit, not after', async () => {
    const h = makeHarness()
    await h.run(renameLeague(), actor(), { name: 'New' })
    expect(h.log.indexOf('audit:same-tx')).toBeLessThan(h.log.indexOf('commit'))
  })

  it('rolls the mutation back when the audit write fails', async () => {
    // An unaudited write is an invariant violation, not a degraded mode. If
    // audit throws, the mutation must not survive it.
    const h = makeHarness()
    h.writeAudit.mockImplementationOnce(async () => {
      throw new Error('audit table is append-only and rejected this')
    })

    await expect(h.run(renameLeague(), actor(), { name: 'New' })).rejects.toThrow(/append-only/)
    expect(h.log).toContain('rollback')
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('carries a before/after pair for the operator-facing diff', async () => {
    const h = makeHarness()
    await h.run(renameLeague(), actor(), { name: 'New' })
    const draft = h.writeAudit.mock.calls[0][2]
    expect(draft).toMatchObject({
      resourceId: 'l1',
      before: { name: 'Old' },
      after: { name: 'New' },
    })
  })
})

describe('T-004 · criterion 1 — no event when the transaction rolls back', () => {
  it('does not emit when run() returns a domain error', async () => {
    const h = makeHarness()
    const def = renameLeague({ run: async () => err(invariant('league.locked', 'Locked.')) })

    const r = await h.run(def, actor(), { name: 'New' })

    expect(r.ok).toBe(false)
    expect(h.log).toContain('rollback')
    expect(h.log).not.toContain('commit')
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('does not emit when run() throws', async () => {
    const h = makeHarness()
    const def = renameLeague({
      run: async () => {
        throw new Error('deadlock detected')
      },
    })

    await expect(h.run(def, actor(), { name: 'New' })).rejects.toThrow('deadlock detected')
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('does not emit when authorization refuses', async () => {
    const h = makeHarness({ allow: false })
    const r = await h.run(renameLeague(), actor(), { name: 'New' })
    expect(r.ok).toBe(false)
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('a post-commit emit failure does NOT fail the mutation', async () => {
    // The write is committed. Reporting failure would make the caller retry a
    // mutation that already happened — worse than a missed notification.
    const h = makeHarness()
    h.emit.mockImplementationOnce(async () => {
      throw new Error('queue unavailable')
    })

    const r = await h.run(renameLeague(), actor(), { name: 'New' })

    expect(r.ok).toBe(true)
    expect(h.onEmitError).toHaveBeenCalledTimes(1)
  })

  it('does not call the emitter at all when there are no events', async () => {
    const h = makeHarness()
    await h.run(renameLeague({ events: undefined }), actor(), { name: 'New' })
    expect(h.emit).not.toHaveBeenCalled()
  })
})

describe('T-004 · criterion 3 — a concurrent phase change is CONFLICT', () => {
  it('returns CONFLICT when the phase moved under the caller', async () => {
    const h = makeHarness()
    // The caller rendered a page showing PRESEASON; by the time we lock the row
    // it is DRAFTING.
    const def = renameLeague({
      load: async () => ({ id: 'l1', phase: 'DRAFTING', name: 'Old' }),
    })

    const r = await h.run(def, actor(), { name: 'New' }, { expectedPhase: 'PRESEASON' })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('CONFLICT')
    expect(h.log).toContain('rollback')
  })

  it('is CONFLICT even when the NEW phase would also have been allowed', async () => {
    // The distinction that matters: the request would have succeeded, but it
    // would have succeeded against a world the caller never saw. Reporting
    // success here is how a stale decision gets written.
    const h = makeHarness()
    const def = renameLeague({
      load: async () => ({ id: 'l1', phase: 'OFFSEASON', name: 'Old' }),
    })

    const r = await h.run(def, actor(), { name: 'New' }, { expectedPhase: 'PRESEASON' })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('CONFLICT')
  })

  it('is WRONG_PHASE, not CONFLICT, when the caller made no claim', async () => {
    // No expectedPhase means no race was detectable — the phase is simply not
    // one this action permits, and the remedy is a different button.
    const h = makeHarness()
    const def = renameLeague({ load: async () => ({ id: 'l1', phase: 'DRAFTING', name: 'Old' }) })

    const r = await h.run(def, actor(), { name: 'New' })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('WRONG_PHASE')
    expect(r.error).toMatchObject({ actual: 'DRAFTING', remedy: 'league.pause' })
  })

  it('proceeds when the expected phase still holds', async () => {
    const h = makeHarness()
    const r = await h.run(renameLeague(), actor(), { name: 'New' }, { expectedPhase: 'PRESEASON' })
    expect(r.ok).toBe(true)
  })

  it('never runs the mutation body on a stale phase', async () => {
    const run = vi.fn()
    const h = makeHarness()
    const def = renameLeague({
      load: async () => ({ id: 'l1', phase: 'DRAFTING', name: 'Old' }),
      run: run as any,
    })

    await h.run(def, actor(), { name: 'New' }, { expectedPhase: 'PRESEASON' })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('T-004 · gate ordering', () => {
  it('authorizes against the LOADED row, not an id', async () => {
    const authorize = vi.fn(async () => ok(undefined))
    const h = makeHarness()
    const runner = createMutationRunner({
      withTenant: h.withTenant,
      authorize,
      writeAudit: h.writeAudit,
      emit: h.emit,
    })

    await runner(renameLeague(), actor(), { name: 'New' })

    expect(authorize).toHaveBeenCalledWith({
      ctx: expect.anything(),
      requires: 'league.settings.update',
      resource: { id: 'l1', phase: 'PRESEASON', name: 'Old' },
    })
  })

  it('checks authorization BEFORE the reason', async () => {
    // Telling someone their reason is too short for an action they were never
    // allowed to take leaks which actions exist, and wastes their time.
    const h = makeHarness({ allow: false })
    const r = await h.run(renameLeague({ reasonRequired: true }), actor(), { name: 'New' })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('FORBIDDEN')
  })

  it('rejects an invalid reason when one is required', async () => {
    const h = makeHarness()
    const r = await h.run(
      renameLeague({ reasonRequired: true }),
      actor({ reason: 'fix' }),
      { name: 'New' },
    )

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('REASON_REQUIRED')
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('accepts a real reason', async () => {
    const h = makeHarness()
    const r = await h.run(
      renameLeague({ reasonRequired: true }),
      actor({ reason: 'Renaming after the operator rebranded the league.' }),
      { name: 'New' },
    )
    expect(r.ok).toBe(true)
  })

  it('runs the precondition hook after the phase gate', async () => {
    const precondition = vi.fn(async () => err(forbidden('league.rename', 'Rate limited.')))
    const h = makeHarness()
    const def = renameLeague({
      load: async () => ({ id: 'l1', phase: 'DRAFTING', name: 'Old' }),
      precondition,
    })

    const r = await h.run(def, actor(), { name: 'New' })

    // Phase failed first, so the precondition never ran — a phase problem
    // reported as a rate limit would send someone to the wrong screen.
    expect(precondition).not.toHaveBeenCalled()
    if (r.ok) return
    expect(r.error.code).toBe('WRONG_PHASE')
  })

  it('surfaces a precondition refusal unchanged', async () => {
    const h = makeHarness()
    const def = renameLeague({
      precondition: async () => err(forbidden('league.rename', 'Rate limited.')),
    })
    const r = await h.run(def, actor(), { name: 'New' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatchObject({ code: 'FORBIDDEN', because: 'Rate limited.' })
  })

  it('reports a missing resource rather than treating null as loaded', async () => {
    const h = makeHarness()
    const r = await h.run(renameLeague({ load: async () => null }), actor(), { name: 'New' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatchObject({ code: 'INVARIANT', invariant: 'League.notFound' })
  })
})

describe('T-004 · the defaults fail closed', () => {
  it('refuses every action with no authorize configured', async () => {
    const h = makeHarness()
    const runner = createMutationRunner({ withTenant: h.withTenant })
    const r = await runner(renameLeague(), actor(), { name: 'New' })

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('FORBIDDEN')
  })

  it('throws rather than silently skipping audit when none is configured', async () => {
    // A permissive default here would let a mutation path go live with no audit
    // trail while looking completely healthy.
    const h = makeHarness()
    const runner = createMutationRunner({
      withTenant: h.withTenant,
      authorize: async () => ok(undefined),
    })

    await expect(runner(renameLeague(), actor(), { name: 'New' })).rejects.toThrow(
      /No audit writer configured/,
    )
    expect(h.log).toContain('rollback')
  })
})

describe('T-004 · non-domain failures are not flattened into refusals', () => {
  it('rethrows an infrastructure error instead of returning a DomainError', async () => {
    // A lock timeout is not "you may not do that". Converting it into a
    // DomainError would tell an operator their request was refused when in fact
    // the database was unavailable, and they would stop retrying.
    const h = makeHarness()
    const def = renameLeague({
      load: async () => {
        throw new Error('P2024 timed out fetching a connection')
      },
    })

    await expect(h.run(def, actor(), { name: 'New' })).rejects.toThrow(/P2024/)
  })
})
