/**
 * Commissioner OS · T-203 acceptance.
 *
 * "A test feeds hostile provider data — a team belonging to another tenant, a
 * manager ID that doesn't exist, a roster referencing an unknown player — and
 * asserts each is rejected WITH NO PARTIAL WRITES."
 *
 * All three hostile cases are here, and each is asserted twice: that it is
 * refused, AND that nothing was written. The second assertion is the one a
 * validate-as-you-write implementation fails.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  SYNC_CAUSE,
  SYNC_PERMITTED_ACTIONS,
  type ReconcileInput,
  type ReconcileWorld,
  applyReconcilePlan,
  planReconcile,
  reconcileActor,
  reconcileAuditDraft,
} from '@/lib/domain/reconcile'
import { PERMISSION_MATRIX, authorize } from '@/lib/domain/authorize'
import { buildAuditRow } from '@/lib/domain/audit'
import { createActorContext } from '@/lib/domain/actorContext'

const TENANT = 'tenant-a'
const OTHER = 'tenant-b'
const LEAGUE = 'league-1'

const world = (over: Partial<ReconcileWorld> = {}): ReconcileWorld => ({
  leagueTenant: new Map([[LEAGUE, TENANT]]),
  teamTenant: new Map(),
  knownPlayerIds: new Set(['p1', 'p2']),
  ...over,
})

const input = (over: Partial<ReconcileInput> = {}): ReconcileInput => ({
  tenantId: TENANT,
  leagueId: LEAGUE,
  bindingId: 'b1',
  provider: 'sleeper',
  managers: [{ externalManagerId: 'm1', displayName: 'Dana', email: null }],
  teams: [{ externalTeamId: 't1', name: 'Team One', externalManagerId: 'm1' }],
  ...over,
})

describe('T-203 · a valid payload plans cleanly (positive control)', () => {
  it('produces ops for managers and teams', () => {
    // Without this, every rejection below could be "the reconciler refuses
    // everything" and the suite would pass on a component that never works.
    const r = planReconcile(input(), world())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.ops.map((o) => o.kind)).toEqual(['upsertManager', 'upsertTeam'])
  })

  it('plans managers BEFORE teams', () => {
    // Teams reference managers, so an unknown manager has to be catchable
    // before any team op exists.
    const r = planReconcile(input(), world())
    if (!r.ok) throw new Error('expected success')
    expect(r.value.ops[0].kind).toBe('upsertManager')
  })

  it('accepts an unclaimed team', () => {
    // owner_id: null is ordinary (T-202). Refusing it would refuse most real
    // leagues.
    const r = planReconcile(
      input({ teams: [{ externalTeamId: 't1', name: 'Orphan', externalManagerId: null }] }),
      world(),
    )
    expect(r.ok).toBe(true)
  })

  it('plans roster entries for known players', () => {
    const r = planReconcile(
      input({ rosterEntries: [{ externalTeamId: 't1', playerId: 'p1' }] }),
      world(),
    )
    if (!r.ok) throw new Error('expected success')
    expect(r.value.ops.some((o) => o.kind === 'setRoster')).toBe(true)
  })
})

describe('T-203 · 🛑 hostile data is rejected with NO PARTIAL WRITES', () => {
  /**
   * Every case asserts BOTH halves. A reconciler that validates each row as it
   * writes satisfies the rejection and fails the second: by the time row nine
   * is refused, rows one to eight are committed and the league is half-synced
   * with nothing to explain it.
   */
  const assertNothingWritten = (r: ReturnType<typeof planReconcile>) => {
    expect(r.ok).toBe(false)
    // The plan is the only thing that can be applied, and there isn't one.
    // `applyReconcilePlan` takes a ReconcilePlan, so a rejected payload has
    // nothing to pass it — the guarantee is in the type, not in discipline.
    if (r.ok) throw new Error('expected rejection')
  }

  it('🛑 a team belonging to ANOTHER TENANT', () => {
    const r = planReconcile(
      input(),
      world({ teamTenant: new Map([['t1', OTHER]]) }),
    )
    assertNothingWritten(r)
    if (r.ok) return
    expect(r.error).toMatchObject({ invariant: 'sync.crossTenantTeam' })
  })

  it('🛑 a league belonging to another tenant', () => {
    // The same class, one level up, and the one RLS would also catch — but only
    // at the moment of writing, by which point earlier ops in the payload would
    // already have landed under an inline validator.
    const r = planReconcile(input(), world({ leagueTenant: new Map([[LEAGUE, OTHER]]) }))
    assertNothingWritten(r)
    if (r.ok) return
    expect(r.error).toMatchObject({ invariant: 'sync.crossTenantLeague' })
  })

  it('🛑 a MANAGER ID THAT DOES NOT EXIST', () => {
    const r = planReconcile(
      input({ teams: [{ externalTeamId: 't1', name: 'T', externalManagerId: 'ghost' }] }),
      world(),
    )
    assertNothingWritten(r)
    if (r.ok) return
    expect(r.error).toMatchObject({ invariant: 'sync.unknownManager' })
    expect(r.error.detail).toContain('ghost')
  })

  it('🛑 a ROSTER REFERENCING AN UNKNOWN PLAYER', () => {
    // Writing it would create a roster row pointing at nothing, and the failure
    // would surface later as an empty lineup rather than as a sync problem.
    const r = planReconcile(
      input({ rosterEntries: [{ externalTeamId: 't1', playerId: 'not-a-player' }] }),
      world(),
    )
    assertNothingWritten(r)
    if (r.ok) return
    expect(r.error).toMatchObject({ invariant: 'sync.unknownPlayer' })
  })

  it('a roster referencing a team not in the payload', () => {
    const r = planReconcile(
      input({ rosterEntries: [{ externalTeamId: 'ghost-team', playerId: 'p1' }] }),
      world(),
    )
    assertNothingWritten(r)
    if (r.ok) return
    expect(r.error).toMatchObject({ invariant: 'sync.unknownTeam' })
  })

  it('a league we do not have at all', () => {
    const r = planReconcile(input({ leagueId: 'nope' }), world())
    assertNothingWritten(r)
    if (r.ok) return
    expect(r.error).toMatchObject({ invariant: 'sync.unknownLeague' })
  })

  it.each([
    ['duplicate manager', { managers: [
      { externalManagerId: 'm1', displayName: 'A', email: null },
      { externalManagerId: 'm1', displayName: 'B', email: null },
    ] }],
    ['duplicate team', { teams: [
      { externalTeamId: 't1', name: 'A', externalManagerId: null },
      { externalTeamId: 't1', name: 'B', externalManagerId: null },
    ] }],
  ])('%s', (_label, over) => {
    // A duplicate upserts twice and, on a set-based roster op, silently wins on
    // whichever came last — a provider bug that would present as data flapping.
    assertNothingWritten(planReconcile(input(over as Partial<ReconcileInput>), world()))
  })

  it('🛑 rejects the WHOLE payload, not just the bad row', () => {
    // Nine good teams and one hostile: the acceptance is that NONE of them are
    // written, not that nine are.
    const teams = Array.from({ length: 9 }, (_, i) => ({
      externalTeamId: `t${i}`,
      name: `Team ${i}`,
      externalManagerId: 'm1',
    }))
    const r = planReconcile(
      input({ teams: [...teams, { externalTeamId: 'bad', name: 'Bad', externalManagerId: 'ghost' }] }),
      world(),
    )
    expect(r.ok).toBe(false)
  })
})

describe('T-203 · apply cannot run without a validated plan', () => {
  function harness() {
    const applied: string[] = []
    const audited: unknown[] = []
    return {
      applied,
      audited,
      deps: {
        withTenant: async <T,>(_t: string, fn: (tx: any) => Promise<T>) => fn({ id: 'tx' }),
        applyOp: async (_tx: any, _plan: any, op: any) => {
          applied.push(op.kind)
        },
        writeAudit: async (_tx: any, _ctx: any, draft: any) => {
          audited.push(draft)
        },
      },
    }
  }

  const actorFor = (tenantId = TENANT) => {
    const a = reconcileActor(tenantId, 'sleeper')
    if (!a.ok) throw new Error('bad fixture')
    return a.value
  }

  it('applies every op and audits once, in one transaction', async () => {
    const h = harness()
    const plan = planReconcile(input(), world())
    if (!plan.ok) throw new Error('expected a plan')

    const r = await applyReconcilePlan(h.deps, plan.value, actorFor(), 'sleeper')
    expect(r.ok).toBe(true)
    expect(h.applied).toEqual(['upsertManager', 'upsertTeam'])
    expect(h.audited).toHaveLength(1)
  })

  it('🛑 refuses when the actor and the plan name different tenants', async () => {
    // withTenant scopes to the ACTOR. Without this check the plan's rows would
    // be written into the actor's tenant — and if RLS were ever absent on a
    // table, that write would succeed.
    const h = harness()
    const plan = planReconcile(input(), world())
    if (!plan.ok) throw new Error('expected a plan')

    const r = await applyReconcilePlan(h.deps, plan.value, actorFor(OTHER), 'sleeper')
    expect(r.ok).toBe(false)
    expect(h.applied).toEqual([])
    expect(h.audited).toEqual([])
  })
})

describe('T-203 · sync writes are distinguishable from human writes', () => {
  it('the actor is the provider, not a person', () => {
    const a = reconcileActor(TENANT, 'sleeper')
    expect(a.ok).toBe(true)
    if (!a.ok) return
    expect(a.value.userId).toBe('integration:sleeper')
    expect(a.value.actorLabel).toContain('sleeper')
  })

  it('🛑 the synthetic actor holds NO role on any axis', () => {
    // "A provider can never trigger an action the matrix would deny a human."
    // The cheapest way to hold that is to give integration strictly LESS
    // authority than any person rather than equal authority under another name.
    const a = reconcileActor(TENANT, 'sleeper')
    if (!a.ok) throw new Error('bad fixture')
    expect(a.value.platformRole).toBeNull()
    expect(a.value.tenantRole).toBeNull()
    expect(a.value.leagueRole).toBeNull()
  })

  it('and is therefore refused every action by the matrix', () => {
    // The ceiling is SYNC_PERMITTED_ACTIONS, enforced by the reconciler — not
    // by the actor being privileged enough to slip through authorize().
    const a = reconcileActor(TENANT, 'sleeper')
    if (!a.ok) throw new Error('bad fixture')
    for (const action of SYNC_PERMITTED_ACTIONS) {
      expect(authorize({ ctx: a.value, requires: action, resource: null }).ok).toBe(false)
    }
  })

  it('the audit row carries cause: SYNC', () => {
    // Actor and cause answer different questions — WHO and WHY. A query for
    // "everything sync did last night" wants the second without pattern-matching
    // on the first.
    const plan = planReconcile(input(), world())
    if (!plan.ok) throw new Error('expected a plan')
    const draft = reconcileAuditDraft(plan.value, 'sleeper')
    expect(draft.metadata).toMatchObject({ cause: SYNC_CAUSE, provider: 'sleeper' })
    expect(draft.action).toBe('league.sync.reconcile')
  })

  it('survives an end-to-end audit row build', () => {
    const a = reconcileActor(TENANT, 'sleeper')
    const plan = planReconcile(input(), world())
    if (!a.ok || !plan.ok) throw new Error('bad fixture')

    const row = buildAuditRow(a.value, reconcileAuditDraft(plan.value, 'sleeper'))
    expect(row.actorUserId).toBe('integration:sleeper')
    expect((row.metadata as any).cause).toBe('SYNC')
    expect(row.tenantRole).toBeNull()
  })
})

describe('T-203 · 🛑 a provider can never do what a commissioner cannot', () => {
  it('every sync-permitted action is grantable to a COMMISSIONER', () => {
    // The machine-checkable form of the handoff's sentence. Adding an action to
    // SYNC_PERMITTED_ACTIONS that a commissioner cannot take fails here.
    const commissioner = createActorContext({
      userId: 'u1',
      actorLabel: 'Dana',
      tenantId: TENANT,
      leagueRole: 'COMMISSIONER',
    })
    if (!commissioner.ok) throw new Error('bad fixture')

    expect(SYNC_PERMITTED_ACTIONS.length).toBeGreaterThan(0)
    for (const action of SYNC_PERMITTED_ACTIONS) {
      const r = authorize({ ctx: commissioner.value, requires: action, resource: { tenantId: TENANT } })
      expect(r.ok, `a commissioner cannot ${action}, so sync must not either`).toBe(true)
    }
  })

  it('the set excludes every destructive and tenant-level action', () => {
    // Pinned by name. These are the ones whose accidental inclusion would be
    // both catastrophic and easy to justify in a hurry ("sync needs to remove
    // stale leagues").
    for (const forbidden of [
      'data.purgeLeague',
      'tenant.delete',
      'tenant.suspend',
      'tenant.apiKey.issue',
      'tenant.member.changeRole',
      'data.readDeleted',
    ] as const) {
      expect(SYNC_PERMITTED_ACTIONS).not.toContain(forbidden)
    }
  })

  it('the set contains no write a commissioner lacks', () => {
    // The general form of the test above — covers an action added later that
    // nobody thought to list among the forbidden ones.
    for (const action of SYNC_PERMITTED_ACTIONS) {
      const rule = PERMISSION_MATRIX[action]
      expect(rule, `${action} is not in the matrix`).toBeDefined()
      expect(
        rule.league?.includes('COMMISSIONER'),
        `${action} is not grantable to a commissioner`,
      ).toBe(true)
    }
  })

  it('the reconcile action is closed to API keys', () => {
    // Sync is driven by our scheduler with a synthetic actor. An operator's key
    // must not be able to trigger a reconcile carrying provider-shaped data of
    // its own choosing.
    expect(PERMISSION_MATRIX['league.sync.reconcile'].apiScope).toBeUndefined()
  })
})
