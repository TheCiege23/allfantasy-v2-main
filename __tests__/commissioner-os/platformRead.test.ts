/**
 * Commissioner OS · T-105 acceptance.
 *
 * Three criteria:
 *   1. commish_app cannot reach the platform policy by any means available to it
 *   2. every override use produces an audit row
 *   3. isPlatformRead rows appear REDACTED in the operator-facing audit view —
 *      not hidden (TENANCY.md §7)
 *
 * (2) and (3) are application behaviour and are here. (1) is a database
 * property — a role that is a member of nothing cannot SET ROLE, and a policy
 * scoped TO another role does not apply — so it lives in `platformRead.spec.ts`
 * alongside the isolation suite.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  CROSS_TENANT_READ_ACTION,
  PLATFORM_READ_CATEGORIES,
  isPlatformReadScope,
  operatorAuditView,
  redactPlatformReadForOperator,
  withPlatformRead,
} from '@/lib/domain/platformRead'
import { buildAuditRow } from '@/lib/domain/audit'
import { createActorContext, type ActorContext } from '@/lib/domain/actorContext'
import { authorize } from '@/lib/domain/authorize'
import { ok } from '@/lib/domain/result'

const OWN = 'tenant-own'
const TARGET = 'tenant-target'
const REASON = 'Support ticket 4192: operator reports duplicated league rows.'

function actor(over: Record<string, unknown> = {}): ActorContext {
  const r = createActorContext({
    userId: 'staff-1',
    actorLabel: 'Sam Okonkwo',
    tenantId: OWN,
    reason: REASON,
    ...over,
  } as any)
  if (!r.ok) throw new Error('bad fixture')
  return r.value
}

/** A fake platform client whose $transaction hands back a marker tx. */
function fakeClient() {
  const tx = { id: 'platform-tx' }
  return {
    tx,
    client: { $transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx) } as any,
  }
}

const allow = async () => ok(undefined)

describe('T-105 · the scope is not open by default', () => {
  it('isPlatformReadScope is false outside', () => {
    expect(isPlatformReadScope()).toBe(false)
  })

  it('an ordinary audit row is not marked', () => {
    const row = buildAuditRow(actor({ platformRole: 'PLATFORM_ADMIN' }), {
      action: 'league.rename',
      resourceType: 'League',
      resourceId: 'l1',
    })
    // Being a platform admin is not a cross-tenant read.
    expect(row.isPlatformRead).toBe(false)
  })
})

describe('T-105 · it fails closed', () => {
  it('refuses with no authorize configured', async () => {
    const r = await withPlatformRead(actor(), { targetTenantId: TARGET, category: 'SUPPORT_TICKET' }, async () => 'x')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('FORBIDDEN')
  })

  it('the real matrix refuses a tenant admin', async () => {
    // Wired to the actual T-104 matrix, not a stub — tenant.crossTenantRead is
    // platform-scope, so no tenant role reaches it however senior.
    const r = await withPlatformRead(
      actor({ tenantRole: 'TENANT_OWNER' }),
      { targetTenantId: TARGET, category: 'SUPPORT_TICKET' },
      async () => 'x',
      { authorize, writeAudit: async () => {} },
    )
    expect(r.ok).toBe(false)
  })

  it('the real matrix allows platform support', async () => {
    const f = fakeClient()
    const r = await withPlatformRead(
      actor({ platformRole: 'PLATFORM_SUPPORT' }),
      { targetTenantId: TARGET, category: 'SUPPORT_TICKET' },
      async () => 'seen',
      { authorize, writeAudit: async () => {}, client: f.client },
    )
    expect(r.ok).toBe(true)
  })

  it('requires a reason', async () => {
    const f = fakeClient()
    const r = await withPlatformRead(
      actor({ platformRole: 'PLATFORM_ADMIN', reason: undefined }),
      { targetTenantId: TARGET, category: 'SUPPORT_TICKET' },
      async () => 'x',
      { authorize: allow, writeAudit: async () => {}, client: f.client },
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('REASON_REQUIRED')
  })

  it('rejects a placeholder reason', async () => {
    const r = await withPlatformRead(
      actor({ platformRole: 'PLATFORM_ADMIN', reason: 'n/a' }),
      { targetTenantId: TARGET, category: 'SUPPORT_TICKET' },
      async () => 'x',
      { authorize: allow, writeAudit: async () => {} },
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatchObject({ problem: 'STOPLISTED' })
  })

  it('rejects an unknown reason category', async () => {
    const r = await withPlatformRead(
      actor({ platformRole: 'PLATFORM_ADMIN' }),
      { targetTenantId: TARGET, category: 'CURIOSITY' as never },
      async () => 'x',
      { authorize: allow, writeAudit: async () => {} },
    )
    expect(r.ok).toBe(false)
  })

  it('requires a target tenant', async () => {
    const r = await withPlatformRead(
      actor({ platformRole: 'PLATFORM_ADMIN' }),
      { targetTenantId: '', category: 'SUPPORT_TICKET' },
      async () => 'x',
      { authorize: allow, writeAudit: async () => {} },
    )
    expect(r.ok).toBe(false)
  })
})

describe('T-105 · every use produces an audit row', () => {
  it('writes exactly one, before the callback runs', async () => {
    // Before, not after: a read that throws — or a process that dies mid-read —
    // must still leave the record. "We looked at your data" is precisely the
    // trace that has to survive the thing going wrong.
    const order: string[] = []
    const f = fakeClient()
    const writeAudit = vi.fn(async () => {
      order.push('audit')
    })

    await withPlatformRead(
      actor({ platformRole: 'PLATFORM_ADMIN' }),
      { targetTenantId: TARGET, category: 'INCIDENT' },
      async () => {
        order.push('read')
        return 'x'
      },
      { authorize: allow, writeAudit, client: f.client },
    )

    expect(writeAudit).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['audit', 'read'])
  })

  it('audits against the TARGET tenant, not the actor’s own', async () => {
    // It is the target's operator who is entitled to see that this happened.
    // Writing it against the platform staffer's own tenant would file the
    // disclosure where the person owed it will never look.
    const f = fakeClient()
    const writeAudit = vi.fn(async () => {})

    await withPlatformRead(
      actor({ platformRole: 'PLATFORM_ADMIN' }),
      { targetTenantId: TARGET, category: 'INCIDENT' },
      async () => 'x',
      { authorize: allow, writeAudit, client: f.client },
    )

    expect(writeAudit.mock.calls[0][1]).toMatchObject({ tenantId: TARGET })
  })

  it('the row carries the category and the action', async () => {
    const f = fakeClient()
    const writeAudit = vi.fn(async () => {})
    await withPlatformRead(
      actor({ platformRole: 'PLATFORM_ADMIN' }),
      { targetTenantId: TARGET, category: 'LEGAL_REQUEST' },
      async () => 'x',
      { authorize: allow, writeAudit, client: f.client },
    )
    expect(writeAudit.mock.calls[0][2]).toMatchObject({
      action: CROSS_TENANT_READ_ACTION,
      metadata: { platformReadCategory: 'LEGAL_REQUEST' },
    })
  })

  it('writes the audit through the platform tx, not a separate connection', async () => {
    const f = fakeClient()
    const writeAudit = vi.fn(async () => {})
    await withPlatformRead(
      actor({ platformRole: 'PLATFORM_ADMIN' }),
      { targetTenantId: TARGET, category: 'INCIDENT' },
      async () => 'x',
      { authorize: allow, writeAudit, client: f.client },
    )
    expect(writeAudit.mock.calls[0][0]).toBe(f.tx)
  })

  it('🛑 any audit row written INSIDE the scope is marked isPlatformRead', async () => {
    // The flag is ambient rather than a parameter, so a nested domain call that
    // writes its own audit row is marked too — without its author having to
    // know they were inside a platform read.
    const f = fakeClient()
    let marked: boolean | undefined

    await withPlatformRead(
      actor({ platformRole: 'PLATFORM_ADMIN' }),
      { targetTenantId: TARGET, category: 'INCIDENT' },
      async () => {
        marked = buildAuditRow(actor({ platformRole: 'PLATFORM_ADMIN' }), {
          action: 'audit.read',
          resourceType: 'League',
          resourceId: 'l1',
        }).isPlatformRead
        return 'x'
      },
      { authorize: allow, writeAudit: async () => {}, client: f.client },
    )

    expect(marked).toBe(true)
  })

  it('the scope closes afterwards', async () => {
    const f = fakeClient()
    await withPlatformRead(
      actor({ platformRole: 'PLATFORM_ADMIN' }),
      { targetTenantId: TARGET, category: 'INCIDENT' },
      async () => 'x',
      { authorize: allow, writeAudit: async () => {}, client: f.client },
    )
    expect(isPlatformReadScope()).toBe(false)
  })

  it('the scope closes even when the read throws', async () => {
    const f = fakeClient()
    await expect(
      withPlatformRead(
        actor({ platformRole: 'PLATFORM_ADMIN' }),
        { targetTenantId: TARGET, category: 'INCIDENT' },
        async () => {
          throw new Error('boom')
        },
        { authorize: allow, writeAudit: async () => {}, client: f.client },
      ),
    ).rejects.toThrow('boom')
    expect(isPlatformReadScope()).toBe(false)
  })
})

describe('T-105 · the operator-facing view redacts, it does not hide', () => {
  const platformRow = {
    at: new Date('2026-08-31T10:00:00Z'),
    action: CROSS_TENANT_READ_ACTION,
    resourceType: 'Tenant',
    resourceId: TARGET,
    actorLabel: 'Sam Okonkwo',
    actorUserId: 'staff-1',
    isPlatformRead: true,
    reason: 'Investigating DynastyCo’s report that leagues are cross-posting.',
    metadata: { platformReadCategory: 'SUPPORT_TICKET' },
  }

  const ownRow = {
    at: new Date('2026-08-31T11:00:00Z'),
    action: 'league.rename',
    resourceType: 'League',
    resourceId: 'l1',
    actorLabel: 'Dana Okafor',
    isPlatformRead: false,
    reason: 'Operator rebranded the league.',
  }

  it('🛑 the row is SHOWN, not filtered out', () => {
    // §7: "Suppressing them entirely becomes a contract problem." We are a
    // sub-processor; the operator is entitled to know access occurred.
    const view = operatorAuditView([platformRow, ownRow])
    expect(view).toHaveLength(2)
    expect(view[0].isPlatformRead).toBe(true)
  })

  it('shows the time and the reason CATEGORY', () => {
    const out = redactPlatformReadForOperator(platformRow)
    expect(out.at).toEqual(platformRow.at)
    expect(out.reasonCategory).toBe('SUPPORT_TICKET')
  })

  it('does NOT show the free-text reason', () => {
    // It names another operator. Transparency about access must not become a
    // leak of a third party's information.
    const out = redactPlatformReadForOperator(platformRow)
    expect(JSON.stringify(out)).not.toContain('DynastyCo')
    expect(out.reason).toBeUndefined()
  })

  it('does NOT identify the individual staff member', () => {
    // The operator is entitled to know their data was accessed by our support
    // function, not which employee did it.
    const out = redactPlatformReadForOperator(platformRow)
    expect(out.actorLabel).toBe('Platform support')
    expect(JSON.stringify(out)).not.toContain('Sam Okonkwo')
    expect(JSON.stringify(out)).not.toContain('staff-1')
  })

  it('reports UNSPECIFIED rather than dropping a missing category', () => {
    // A missing field would render as though the row had no reason, when in
    // fact it has one we failed to record. Say so.
    const out = redactPlatformReadForOperator({ ...platformRow, metadata: null })
    expect(out.reasonCategory).toBe('UNSPECIFIED')
  })

  it('leaves the operator’s OWN rows completely untouched', () => {
    // Redacting these would hide the operator's own staff from them, which is
    // the opposite of the point.
    const out = redactPlatformReadForOperator(ownRow)
    expect(out.actorLabel).toBe('Dana Okafor')
    expect(out.reason).toBe('Operator rebranded the league.')
    expect(out.isPlatformRead).toBe(false)
  })

  it('every category is a legal value', () => {
    for (const c of PLATFORM_READ_CATEGORIES) {
      const out = redactPlatformReadForOperator({
        ...platformRow,
        metadata: { platformReadCategory: c },
      })
      expect(out.reasonCategory).toBe(c)
    }
  })
})
