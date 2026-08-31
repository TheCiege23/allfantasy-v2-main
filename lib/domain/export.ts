/**
 * Commissioner OS · tenant data export. T-107.
 *
 * "A tenant can take their data and leave: all leagues, members, rosters,
 * audit, as structured files."
 *
 * ─── ⚠ THE EXPORT IS SCOPED BY TWO DIFFERENT MECHANISMS, AND ONE OF THEM IS
 *     APPLICATION CODE ──────────────────────────────────────────────────────
 * This is the first place the deferred-RLS decision has a security consequence
 * in TypeScript, so it is worth being blunt about.
 *
 * For the six tables T-102 protects, the export issues an UNFILTERED read
 * inside `withTenant` and RLS supplies the scoping. That is the design working:
 * there is no `where` to forget, and a bug in this file cannot leak another
 * operator's rows.
 *
 * For `leagues` — and the five pre-existing `tenantId` tables — RLS is
 * deferred, because enabling it would take AllFantasy down across 1,020 call
 * sites. So those reads MUST carry an explicit `tenantId` filter, and that
 * filter is the ONLY thing standing between one operator's export and another
 * operator's data.
 *
 * Two consequences, both handled below rather than hoped about:
 *   - the plan records WHICH mechanism scopes each model, so the asymmetry is
 *     visible in the output rather than buried in a query;
 *   - `verifyExport` re-reads the produced rows and refuses to hand over a
 *     bundle containing a foreign tenantId, whatever the queries did.
 *
 * The verification is not belt-and-braces. For the RLS half it is redundant;
 * for the unprotected half it is the actual control.
 */

import type { ActorContext } from './actorContext'
import type { Tx } from './db'
import { type DomainError, forbidden, invariant } from './errors'
import { type Result, err, ok } from './result'
import { validateReason } from './reason'
import { type Authorize, type WriteAudit, denyAll, refuseAudit } from './ports'
import { TENANT_SCOPED_TABLES } from './tenantScopedTables'

export const EXPORT_ACTION = 'tenant.export'

/**
 * Fields removed from an export.
 *
 * ⚠ AN EXPORT IS A RETURN, AND TENANCY.md §7 SAYS THESE ARE "never returned by
 * the API after creation".
 *
 *  - `hash` — a SHA-256 of a live API key. Of limited use to an attacker, but
 *    it is credential material and there is no reason for it to leave.
 *  - `secretRef` — the webhook HMAC secret's handle. Exporting it hands over
 *    the ability to forge signed deliveries.
 *  - `passwordHash` — not on any tenancy model today; listed so that a model
 *    which gains one is covered on arrival rather than on discovery.
 *
 * ⚠ PII IS **NOT** REDACTED, DELIBERATELY. `TenantUser` carries the operator's
 * staff names and emails, and that is precisely the data they are entitled to
 * take with them. Redacting it would produce a compliant-looking export that
 * fails the purpose — GDPR Art. 20 portability is about giving people their
 * data, not a censored summary of it.
 */
export const EXPORT_REDACTED_FIELDS = new Set(['hash', 'secretRef', 'passwordHash'])

export const EXPORT_REDACTION_MARKER = '[not exported: credential material]'

export type ExportScopeMechanism = 'rls' | 'explicit-filter'

export type ExportPlanEntry = {
  readonly model: string
  readonly table: string
  readonly fileName: string
  readonly scopedBy: ExportScopeMechanism
  /** The `where` to issue. Empty for RLS-scoped models — that is the point. */
  readonly where: Record<string, unknown>
}

/**
 * What an export reads, derived from the register rather than hand-listed.
 *
 * A hand-written list covers the models that existed when someone wrote it.
 * T-103 already fails when a model with `tenantId` is unregistered, so deriving
 * from the same register means a new tenant-scoped model is exported
 * automatically — and a tenant leaving does not discover that six months of
 * their data was never included.
 */
export function buildExportPlan(tenantId: string): readonly ExportPlanEntry[] {
  return TENANT_SCOPED_TABLES.map((t) => ({
    model: t.model,
    table: t.table,
    fileName: `${t.model}.json`,
    scopedBy: t.rlsEnabled ? ('rls' as const) : ('explicit-filter' as const),
    where: t.rlsEnabled
      ? // Empty ON PURPOSE. Inside withTenant, RLS supplies the predicate —
        // there is no `where` here to get wrong.
        {}
      : // The only thing separating this operator's export from another's.
        t.keyColumn === 'id'
        ? { id: tenantId }
        : { tenantId },
  }))
}

export function redactExportRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    out[k] = EXPORT_REDACTED_FIELDS.has(k) ? EXPORT_REDACTION_MARKER : v
  }
  return out
}

// ─── Verification ────────────────────────────────────────────────────────────

export type ExportFile = {
  readonly model: string
  readonly fileName: string
  readonly scopedBy: ExportScopeMechanism
  readonly rows: ReadonlyArray<Record<string, unknown>>
}

export type ForeignRow = { model: string; index: number; foundTenantId: unknown }

/**
 * Scan produced rows for anything belonging to another tenant.
 *
 * 🛑 THIS READS THE OUTPUT, NOT THE QUERIES. T-107's acceptance is "no other
 * tenant's rows appear anywhere in the OUTPUT" — a claim about the bundle, and
 * the only honest way to make it is to look at the bundle. Asserting that the
 * queries were correctly scoped is a different, weaker claim, and it is the one
 * that is true right up until someone adds a model to the unprotected half.
 *
 * `Tenant` is checked on `id` rather than `tenantId`, for the same reason its
 * RLS policy is (TENANCY.md §5): it has no tenantId, it IS the tenant.
 */
export function findForeignRows(
  files: readonly ExportFile[],
  tenantId: string,
): ForeignRow[] {
  const foreign: ForeignRow[] = []
  for (const file of files) {
    file.rows.forEach((row, index) => {
      const owner = file.model === 'Tenant' ? row.id : row.tenantId
      // `undefined` is not a pass. A row with no tenant column in a
      // tenant-scoped export is unattributable, and unattributable is exactly
      // what a leak looks like when the column was renamed.
      if (owner !== tenantId) foreign.push({ model: file.model, index, foundTenantId: owner })
    })
  }
  return foreign
}

export type ExportManifest = {
  readonly tenantId: string
  readonly files: ReadonlyArray<{
    model: string
    fileName: string
    rowCount: number
    scopedBy: ExportScopeMechanism
  }>
  readonly redactedFields: string[]
  readonly totalRows: number
}

export function buildManifest(tenantId: string, files: readonly ExportFile[]): ExportManifest {
  return {
    tenantId,
    // Every model appears, INCLUDING those with zero rows. An omitted model is
    // indistinguishable from an empty one, and "every tenant-scoped model is
    // represented" is the acceptance criterion — a tenant reading this manifest
    // must be able to tell "you have no webhooks" from "we forgot webhooks".
    files: files.map((f) => ({
      model: f.model,
      fileName: f.fileName,
      rowCount: f.rows.length,
      scopedBy: f.scopedBy,
    })),
    redactedFields: [...EXPORT_REDACTED_FIELDS],
    totalRows: files.reduce((n, f) => n + f.rows.length, 0),
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

export type ExportDeps = {
  readonly withTenant: <T>(tenantId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>
  readonly findMany: (
    tx: Tx,
    model: string,
    where: Record<string, unknown>,
  ) => Promise<Array<Record<string, unknown>>>
  readonly authorize?: Authorize
  readonly writeAudit?: WriteAudit
}

export type ExportResult = {
  readonly manifest: ExportManifest
  readonly files: readonly ExportFile[]
}

/**
 * Export one tenant.
 *
 * Runs inside a single `withTenant` transaction so every file is a consistent
 * snapshot — an export assembled across several transactions can contain a
 * league that references a member added after the members file was written,
 * and the operator discovers that when they try to import it somewhere.
 */
export async function exportTenant(
  deps: ExportDeps,
  ctx: ActorContext,
): Promise<Result<ExportResult, DomainError>> {
  const authorize = deps.authorize ?? denyAll
  const writeAudit = deps.writeAudit ?? refuseAudit

  const allowed = await authorize({ ctx, requires: EXPORT_ACTION, resource: null })
  if (!allowed.ok) return err(allowed.error)

  // Reason required — see the T-104 matrix. It is a read, but a read of
  // everything, and usually the last thing an operator does.
  const reason = validateReason(EXPORT_ACTION, ctx.reason)
  if (!reason.ok) return err(reason.error)

  const plan = buildExportPlan(ctx.tenantId)

  const files = await deps.withTenant(ctx.tenantId, async (tx) => {
    const out: ExportFile[] = []
    for (const entry of plan) {
      const rows = await deps.findMany(tx, entry.model, entry.where)
      out.push({
        model: entry.model,
        fileName: entry.fileName,
        scopedBy: entry.scopedBy,
        rows: rows.map(redactExportRow),
      })
    }

    // Invariant 3: audited in the transaction it describes. An export is the
    // single most consequential read a tenant makes, and the row saying it
    // happened must not be able to outlive a rollback or vice versa.
    await writeAudit(tx, ctx, {
      action: EXPORT_ACTION,
      resourceType: 'Tenant',
      resourceId: ctx.tenantId,
      metadata: {
        models: out.length,
        rows: out.reduce((n, f) => n + f.rows.length, 0),
      },
    })

    return out
  })

  // 🛑 VERIFY THE OUTPUT BEFORE RETURNING IT. Redundant for the RLS-scoped
  // half; the actual control for the half where an application `where` clause
  // is all there is.
  const foreign = findForeignRows(files, ctx.tenantId)
  if (foreign.length > 0) {
    return err(
      invariant(
        'export.crossTenantLeak',
        `Export aborted: ${foreign.length} row(s) belong to another tenant — ` +
          foreign
            .slice(0, 3)
            .map((f) => `${f.model}[${f.index}]`)
            .join(', ') +
          '. This is a scoping bug, not a data problem; the bundle was discarded.',
      ),
    )
  }

  return ok({ manifest: buildManifest(ctx.tenantId, files), files })
}

/**
 * Models an export must cover for the bundle to be complete.
 *
 * Exposed so a caller — or T-107's test — can assert coverage without
 * reimplementing the derivation and agreeing with itself.
 */
export function expectedExportModels(): string[] {
  return TENANT_SCOPED_TABLES.map((t) => t.model)
}

/** Did this bundle cover everything? Returns what is missing, not a boolean. */
export function missingFromExport(manifest: ExportManifest): string[] {
  const present = new Set(manifest.files.map((f) => f.model))
  return expectedExportModels().filter((m) => !present.has(m))
}
