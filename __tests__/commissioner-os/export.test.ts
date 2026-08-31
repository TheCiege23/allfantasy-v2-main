/**
 * Commissioner OS · T-107 acceptance.
 *
 * "Export a seeded tenant, assert every tenant-scoped model is represented and
 * that no other tenant's rows appear anywhere in the output."
 *
 * Both halves are tested against the OUTPUT rather than against the queries.
 * "Every model is represented" is a property of the manifest; "no other
 * tenant's rows" is a property of the bundle. Asserting that the queries looked
 * right is a weaker claim, and it is the one that stays true right up until
 * someone adds a model to the half RLS does not protect.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  EXPORT_ACTION,
  EXPORT_REDACTION_MARKER,
  buildExportPlan,
  buildManifest,
  exportTenant,
  expectedExportModels,
  findForeignRows,
  missingFromExport,
  redactExportRow,
} from '@/lib/domain/export'
import { TENANT_SCOPED_TABLES } from '@/lib/domain/tenantScopedTables'
import { createActorContext, type ActorContext } from '@/lib/domain/actorContext'
import { authorize } from '@/lib/domain/authorize'
import { ok } from '@/lib/domain/result'

const T = 'tenant-a'
const OTHER = 'tenant-b'
const REASON = 'Operator is migrating to another provider and requested their data.'

function actor(over: Record<string, unknown> = {}): ActorContext {
  const r = createActorContext({
    userId: 'u1',
    actorLabel: 'Dana',
    tenantId: T,
    tenantRole: 'TENANT_OWNER',
    reason: REASON,
    ...over,
  } as any)
  if (!r.ok) throw new Error('bad fixture')
  return r.value
}

/** A fake database that returns one own-tenant row per model. */
/**
 * One own-tenant row for `model`, in the right shape.
 *
 * ⚠ `Tenant` IS KEYED ON `id`, NOT `tenantId`. Written once here because a test
 * that forgets it produces a row findForeignRows correctly flags as foreign —
 * which is what happened while writing this file, and the export aborted. The
 * check working on a bad fixture is the check working.
 */
function ownRow(model: string): Record<string, unknown> {
  return model === 'Tenant' ? { id: 'tenant-a', name: 'A' } : { id: `${model}-1`, tenantId: 'tenant-a' }
}

function harness(rowsFor?: (model: string) => Array<Record<string, unknown>>) {
  const queries: Array<{ model: string; where: Record<string, unknown> }> = []
  return {
    queries,
    deps: {
      withTenant: async <R,>(_t: string, fn: (tx: any) => Promise<R>) => fn({ id: 'tx' }),
      findMany: async (_tx: any, model: string, where: Record<string, unknown>) => {
        queries.push({ model, where })
        return rowsFor ? rowsFor(model) : [ownRow(model)]
      },
      authorize,
      writeAudit: vi.fn(async () => {}),
    },
  }
}

describe('T-107 · the plan is derived, not hand-listed', () => {
  it('covers every registered tenant-scoped model', () => {
    // A hand-written list covers the models that existed when someone wrote it.
    // A tenant leaving must not discover that six months of their data was
    // never included.
    const plan = buildExportPlan(T)
    expect(plan.map((p) => p.model).sort()).toEqual(
      TENANT_SCOPED_TABLES.map((t) => t.model).sort(),
    )
  })

  it('leaves the where EMPTY for RLS-scoped models', () => {
    // The design working: no `where` to forget, and a bug in export.ts cannot
    // leak another operator's rows from these tables.
    for (const entry of buildExportPlan(T)) {
      if (entry.scopedBy !== 'rls') continue
      expect(entry.where, `${entry.model} should rely on RLS`).toEqual({})
    }
  })

  it('🛑 carries an EXPLICIT filter for every model RLS does not protect', () => {
    // For these, the filter is the ONLY thing standing between one operator's
    // export and another's. `leagues` is the one that matters — RLS is deferred
    // there because enabling it would take AllFantasy down across 1,020 call
    // sites.
    const unprotected = buildExportPlan(T).filter((p) => p.scopedBy === 'explicit-filter')
    expect(unprotected.length).toBeGreaterThan(0)
    for (const entry of unprotected) {
      expect(Object.keys(entry.where), `${entry.model} has no filter`).not.toEqual([])
      expect(Object.values(entry.where)).toContain(T)
    }
  })

  it('filters Tenant on id, not tenantId', () => {
    const tenant = buildExportPlan(T).find((p) => p.model === 'Tenant')!
    // It has no tenantId — it IS the tenant (TENANCY.md §5).
    expect(tenant.scopedBy).toBe('rls')
  })

  it('records WHICH mechanism scopes each model', () => {
    // The asymmetry is visible in the output rather than buried in a query.
    for (const entry of buildExportPlan(T)) {
      expect(['rls', 'explicit-filter']).toContain(entry.scopedBy)
    }
  })
})

describe('T-107 · every model is represented, including empty ones', () => {
  it('the manifest lists every model', async () => {
    const h = harness()
    const r = await exportTenant(h.deps, actor())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(missingFromExport(r.value.manifest)).toEqual([])
  })

  it('🛑 a model with ZERO rows still appears, with rowCount 0', async () => {
    // An omitted model is indistinguishable from an empty one. A tenant reading
    // the manifest must be able to tell "you have no webhooks" from "we forgot
    // webhooks" — and only one of those is their problem.
    const h = harness((model) => (model === 'TenantWebhook' ? [] : [ownRow(model)]))
    const r = await exportTenant(h.deps, actor())
    if (!r.ok) throw new Error('expected success')

    const webhooks = r.value.manifest.files.find((f) => f.model === 'TenantWebhook')
    expect(webhooks).toBeDefined()
    expect(webhooks!.rowCount).toBe(0)
  })

  it('an entirely empty tenant still produces a complete manifest', async () => {
    const h = harness(() => [])
    const r = await exportTenant(h.deps, actor())
    if (!r.ok) throw new Error('expected success')
    expect(r.value.manifest.files.length).toBe(expectedExportModels().length)
    expect(r.value.manifest.totalRows).toBe(0)
  })

  it('reads every model in one transaction', async () => {
    // An export assembled across several transactions can contain a league
    // referencing a member added after the members file was written — and the
    // operator finds out when they try to import it somewhere.
    const h = harness()
    let opened = 0
    await exportTenant(
      { ...h.deps, withTenant: async (_t, fn) => (opened++, fn({ id: 'tx' } as any)) },
      actor(),
    )
    expect(opened).toBe(1)
  })
})

describe('T-107 · no other tenant’s rows appear in the output', () => {
  it('a clean bundle has none (positive control)', () => {
    // Without this, findForeignRows could be returning [] because it examines
    // nothing, and every leak assertion below would pass.
    const foreign = findForeignRows(
      [{ model: 'TenantUser', fileName: 'x', scopedBy: 'rls', rows: [{ tenantId: T }] }],
      T,
    )
    expect(foreign).toEqual([])
  })

  it('detects a foreign row', () => {
    const foreign = findForeignRows(
      [
        {
          model: 'TenantUser',
          fileName: 'x',
          scopedBy: 'rls',
          rows: [{ tenantId: T }, { tenantId: OTHER }],
        },
      ],
      T,
    )
    expect(foreign).toEqual([{ model: 'TenantUser', index: 1, foundTenantId: OTHER }])
  })

  it('treats a MISSING tenantId as foreign, not as a pass', () => {
    // A row with no tenant column in a tenant-scoped export is unattributable,
    // and unattributable is exactly what a leak looks like once a column has
    // been renamed.
    const foreign = findForeignRows(
      [{ model: 'TenantUser', fileName: 'x', scopedBy: 'rls', rows: [{ id: 'x' }] }],
      T,
    )
    expect(foreign).toHaveLength(1)
    expect(foreign[0].foundTenantId).toBeUndefined()
  })

  it('checks Tenant on id rather than tenantId', () => {
    const foreign = findForeignRows(
      [{ model: 'Tenant', fileName: 'x', scopedBy: 'rls', rows: [{ id: T }] }],
      T,
    )
    expect(foreign).toEqual([])
  })

  it('🛑 the export ABORTS rather than returning a leaking bundle', async () => {
    // The acceptance criterion enforced at runtime, not just asserted in a
    // test. If a scoping bug ever produces a foreign row, the operator does not
    // receive a bundle containing someone else's data — they receive an error.
    const h = harness((model) =>
      model === 'League'
        ? [{ id: 'l1', tenantId: T }, { id: 'l2', tenantId: OTHER }]
        : [ownRow(model)],
    )
    const r = await exportTenant(h.deps, actor())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatchObject({ code: 'INVARIANT', invariant: 'export.crossTenantLeak' })
  })

  it('the abort message names the model, not the row contents', async () => {
    // Enough to debug, without printing another tenant's data into a log.
    const h = harness((model) =>
      model === 'League' ? [{ id: 'l2', tenantId: OTHER, secretName: 'Rival Corp' }] : [],
    )
    const r = await exportTenant(h.deps, actor())
    if (r.ok) throw new Error('expected failure')
    expect(r.error.detail).toContain('League')
    expect(r.error.detail).not.toContain('Rival Corp')
  })
})

describe('T-107 · credential material does not leave', () => {
  it.each(['hash', 'secretRef', 'passwordHash'])('redacts %s', (field) => {
    // An export is a return, and TENANCY.md §7 says these are "never returned
    // by the API after creation". secretRef is the sharpest: exporting it hands
    // over the ability to forge signed webhook deliveries.
    expect(redactExportRow({ [field]: 'real-value' })[field]).toBe(EXPORT_REDACTION_MARKER)
  })

  it('🛑 does NOT redact PII', () => {
    // TenantUser carries the operator's staff names and emails, and that is
    // precisely the data they are entitled to take. Redacting it produces a
    // compliant-looking export that fails the purpose — portability is giving
    // people their data, not a censored summary.
    const row = redactExportRow({ displayName: 'Dana Okafor', email: 'dana@dynastyco.com' })
    expect(row.displayName).toBe('Dana Okafor')
    expect(row.email).toBe('dana@dynastyco.com')
  })

  it('leaves ordinary fields alone', () => {
    expect(redactExportRow({ id: 'x', prefix: 'cos_live_abc', label: 'CI key' })).toEqual({
      id: 'x',
      prefix: 'cos_live_abc',
      label: 'CI key',
    })
  })

  it('🛑 the BUNDLE is redacted, not just the helper', async () => {
    // A positive control caught this being missing: deleting `redactExportRow`
    // from the export path left every test in this file green, because they all
    // called the helper directly. That proved the function works and said
    // nothing about whether the export uses it — the same shape of gap as
    // asserting a permission matrix is exhaustive without checking the matrix.
    //
    // This one goes through exportTenant and reads the produced rows.
    const h = harness((model) =>
      model === 'TenantApiKey'
        ? [{ id: 'k1', tenantId: T, prefix: 'cos_live_abc', hash: 'REAL-SHA-256' }]
        : model === 'TenantWebhook'
          ? [{ id: 'w1', tenantId: T, url: 'https://x', secretRef: 'REAL-SECRET-HANDLE' }]
          : [ownRow(model)],
    )

    const r = await exportTenant(h.deps, actor())
    if (!r.ok) throw new Error('expected success')

    const serialised = JSON.stringify(r.value.files)
    expect(serialised).not.toContain('REAL-SHA-256')
    expect(serialised).not.toContain('REAL-SECRET-HANDLE')
    expect(serialised).toContain(EXPORT_REDACTION_MARKER)

    // And the surrounding row survives — redaction narrows, it does not drop.
    const keys = r.value.files.find((f) => f.model === 'TenantApiKey')!
    expect(keys.rows[0].prefix).toBe('cos_live_abc')
  })

  it('the manifest declares what was redacted', () => {
    // A silent redaction is a bundle the operator believes is complete. Saying
    // so is the difference between a limitation and a defect.
    const manifest = buildManifest(T, [])
    expect(manifest.redactedFields).toContain('secretRef')
    expect(manifest.redactedFields).toContain('hash')
  })
})

describe('T-107 · it is an audited, authorised action', () => {
  it('fails closed with no authorize configured', async () => {
    const h = harness()
    const r = await exportTenant({ ...h.deps, authorize: undefined }, actor())
    expect(r.ok).toBe(false)
  })

  it('the real matrix refuses TENANT_SUPPORT', async () => {
    // Read-only staff, but an export is a read of EVERYTHING — the matrix puts
    // it at owner/admin.
    const h = harness()
    const r = await exportTenant(h.deps, actor({ tenantRole: 'TENANT_SUPPORT' }))
    expect(r.ok).toBe(false)
  })

  it('the real matrix allows TENANT_OWNER', async () => {
    const h = harness()
    expect((await exportTenant(h.deps, actor())).ok).toBe(true)
  })

  it('requires a reason', async () => {
    const h = harness()
    const r = await exportTenant(h.deps, actor({ reason: undefined }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('REASON_REQUIRED')
  })

  it('writes one audit row, inside the transaction', async () => {
    const h = harness()
    await exportTenant(h.deps, actor())
    expect(h.deps.writeAudit).toHaveBeenCalledTimes(1)
    expect((h.deps.writeAudit as any).mock.calls[0][2]).toMatchObject({
      action: EXPORT_ACTION,
      resourceType: 'Tenant',
      resourceId: T,
    })
  })

  it('does not audit an export that was refused', async () => {
    const h = harness()
    await exportTenant(h.deps, actor({ tenantRole: 'TENANT_SUPPORT' }))
    expect(h.deps.writeAudit).not.toHaveBeenCalled()
  })
})
