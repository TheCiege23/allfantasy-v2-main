/**
 * Commissioner OS · cross-tenant read for platform staff. T-105.
 *
 * TENANCY.md §3.3 calls the decision behind this "the single most important
 * thing in this document": cross-tenant access is a ROLE, reached through a
 * SEPARATE CONNECTION POOL, never a session variable. Any role can set an
 * `app.*` GUC with no privilege check, so a policy gated on one is not a
 * boundary — it is application code promising not to call something.
 *
 * ─── ⚠ WHAT RLS DOES AND DOES NOT PROTECT AGAINST, STATED PLAINLY ────────────
 * Worth writing down because it is easy to over-read the guarantee, and the
 * documents gesture at it without spelling it out.
 *
 * `commish_app` CAN scope itself to any tenant it names — `set_config
 * ('app.tenant_id', 'some-other-tenant', true)` is not privileged, and the
 * isolation policy will then honestly return that tenant's rows. RLS is not
 * protection against application code that passes the wrong tenantId; the
 * SESSION is what decides which tenant a request belongs to, and that decision
 * lives above this layer.
 *
 * What RLS protects against is the thing that actually happens: a missing
 * `where`, a nested `include`, a `findUnique` that cannot be filtered, a raw
 * query someone wrote from memory. Those leak the WRONG tenant's rows into a
 * request that was scoped correctly. That is the realistic failure and RLS
 * closes it completely.
 *
 * What the ROLE adds, and the GUC could never give, is that no single
 * connection can see EVERY tenant at once. `commish_app` can be one tenant at a
 * time; only `commish_platform` can be all of them. That is the difference
 * between a bug that exposes one operator and a bug that exposes the book.
 */

import { PrismaClient } from '@prisma/client'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ActorContext } from './actorContext'
import type { DomainError } from './errors'
import { forbidden } from './errors'
import { type Result, err, ok } from './result'
import { validateReason } from './reason'
import { type Authorize, type WriteAudit, denyAll, refuseAudit } from './ports'

export const CROSS_TENANT_READ_ACTION = 'tenant.crossTenantRead'

/**
 * Why platform staff looked.
 *
 * ⚠ A CLOSED SET, SEPARATE FROM THE FREE-TEXT REASON, AND THAT SPLIT IS THE
 * POINT. TENANCY.md §7 requires the operator to be shown "platform support
 * accessed this tenant at T, reason category X" — a CATEGORY, not the reason.
 *
 * The free text is written by our staff for our records and can legitimately
 * name a third party ("investigating DynastyCo's report that leagues are
 * cross-posting"), reference an internal incident, or quote another operator's
 * ticket. Showing it verbatim to the operator would leak someone else's
 * information in the name of transparency. Deriving the category from the text
 * by keyword would be worse — it would be a guess, presented as a fact, about
 * the one field a contract will be read against.
 *
 * So the caller states both.
 */
export const PLATFORM_READ_CATEGORIES = [
  'SUPPORT_TICKET',
  'INCIDENT',
  'BILLING_DISPUTE',
  'LEGAL_REQUEST',
  'SECURITY_REVIEW',
] as const

export type PlatformReadCategory = (typeof PLATFORM_READ_CATEGORIES)[number]

// ─── The scope ───────────────────────────────────────────────────────────────

type PlatformReadScope = {
  readonly category: PlatformReadCategory
  readonly targetTenantId: string
}

const scopeStore = new AsyncLocalStorage<PlatformReadScope>()

/**
 * True while inside an authorised cross-tenant read.
 *
 * ⚠ READ BY `buildAuditRow`, WHICH IS WHY IT IS AMBIENT RATHER THAN A
 * PARAMETER. `isPlatformRead` marks rows for an operator-facing disclosure that
 * a DPA is read against. A flag that every call site has to remember to pass is
 * a flag that will be missing from exactly the row somebody later needs — and
 * the failure is silent, because an unmarked row simply looks like ordinary
 * activity.
 */
export function isPlatformReadScope(): boolean {
  return scopeStore.getStore() !== undefined
}

export function currentPlatformReadScope(): PlatformReadScope | undefined {
  return scopeStore.getStore()
}

// ─── The separate pool ───────────────────────────────────────────────────────

let platformClient: PrismaClient | null = null

/**
 * The `commish_platform` connection.
 *
 * ⚠ SEPARATE FROM `lib/domain/db.ts`'s CLIENT, AND NOT EXPORTED. §3.3 requires
 * its own pool: reaching cross-tenant data must mean deliberately picking up a
 * different client, not passing a flag to the usual one. It is constructed
 * lazily and only ever handed to the callback inside an authorised scope.
 *
 * 🛑 IT REFUSES TO FALL BACK. `lib/domain/db.ts` falls back to `DATABASE_URL`
 * when `COMMISH_APP_URL` is unset, because before RLS exists there is nothing
 * to bypass. That reasoning does NOT transfer here: a fallback would silently
 * run a cross-tenant read as whatever role happens to be configured — quite
 * possibly the table owner — and the audit row would still say
 * `isPlatformRead`, which is worse than not having the feature.
 */
function getPlatformClient(): PrismaClient {
  if (platformClient) return platformClient
  const url = process.env.COMMISH_PLATFORM_URL
  if (!url) {
    throw new Error(
      'COMMISH_PLATFORM_URL is not set. The cross-tenant path has no fallback by design — ' +
        'running it as any other role would produce audit rows claiming a platform read that ' +
        'was not one. See docs/commissioner-os/LOCAL-SETUP.md.',
    )
  }
  platformClient = new PrismaClient({ datasources: { db: { url } } })
  return platformClient
}

export async function disconnectPlatformClient(): Promise<void> {
  await platformClient?.$disconnect()
  platformClient = null
}

// ─── The audited action ──────────────────────────────────────────────────────

export type PlatformReadDeps = {
  readonly authorize?: Authorize
  readonly writeAudit?: WriteAudit
  /** Injectable for tests; production omits it and gets the platform pool. */
  readonly client?: Pick<PrismaClient, '$transaction'>
}

export type PlatformReadRequest = {
  readonly targetTenantId: string
  readonly category: PlatformReadCategory
  readonly resourceType?: string
  readonly resourceId?: string
}

/**
 * Read another tenant's data, as platform support.
 *
 * Every use is the audited action `tenant.crossTenantRead`, requires a reason,
 * and marks the resulting audit row `isPlatformRead = true`.
 *
 * ⚠ THE AUDIT ROW IS WRITTEN IN THE SAME TRANSACTION AS THE READ, and it is
 * written BEFORE the callback runs. Writing it after would mean a read that
 * threw — or a process that died mid-read — left no trace, and "we looked at
 * your data" is precisely the record that must survive the thing going wrong.
 * The cost is an audit row for a read that may not have completed, which is the
 * correct direction to be wrong in.
 */
export async function withPlatformRead<T>(
  ctx: ActorContext,
  request: PlatformReadRequest,
  fn: (tx: unknown) => Promise<T>,
  deps: PlatformReadDeps = {},
): Promise<Result<T, DomainError>> {
  const authorize = deps.authorize ?? denyAll
  const writeAudit = deps.writeAudit ?? refuseAudit

  const allowed = await authorize({
    ctx,
    requires: CROSS_TENANT_READ_ACTION,
    // Deliberately null: this action is NOT scoped to the actor's own tenant,
    // so passing the target here would trip authorize's cross-tenant guard —
    // which is exactly what that guard is for on every other action.
    resource: null,
  })
  if (!allowed.ok) return err(allowed.error)

  const reason = validateReason(CROSS_TENANT_READ_ACTION, ctx.reason)
  if (!reason.ok) return err(reason.error)

  if (!PLATFORM_READ_CATEGORIES.includes(request.category)) {
    return err(forbidden(CROSS_TENANT_READ_ACTION, `Unknown reason category "${request.category}".`))
  }

  if (!request.targetTenantId) {
    return err(forbidden(CROSS_TENANT_READ_ACTION, 'A cross-tenant read must name a target tenant.'))
  }

  const client = deps.client ?? getPlatformClient()

  const value = await scopeStore.run({ category: request.category, targetTenantId: request.targetTenantId }, () =>
    client.$transaction(async (tx) => {
      // The audit row lands FIRST, and it is written against the TARGET tenant
      // — not the actor's own — because it is the target's operator who is
      // entitled to see that this happened.
      await writeAudit(
        tx as never,
        { ...ctx, tenantId: request.targetTenantId } as ActorContext,
        {
          action: CROSS_TENANT_READ_ACTION,
          resourceType: request.resourceType ?? 'Tenant',
          resourceId: request.resourceId ?? request.targetTenantId,
          metadata: { platformReadCategory: request.category },
        },
      )
      return fn(tx)
    }),
  )

  return ok(value)
}

// ─── The operator-facing view ────────────────────────────────────────────────

export type OperatorVisibleAuditRow = {
  readonly at: Date
  readonly action: string
  readonly resourceType: string
  readonly resourceId: string
  readonly actorLabel: string
  readonly isPlatformRead: boolean
  readonly reasonCategory?: string
  readonly reason?: string | null
}

type StoredAuditRow = {
  at: Date
  action: string
  resourceType: string
  resourceId: string
  actorLabel: string
  actorUserId?: string
  isPlatformRead: boolean
  reason?: string | null
  metadata?: Record<string, unknown> | null
  before?: unknown
  after?: unknown
}

/**
 * Redact a platform-read row for the operator — SHOWN, not hidden.
 *
 * TENANCY.md §7: "Operators are data controllers and we are a sub-processor;
 * DPAs and GDPR Art. 28 generally require transparency about sub-processor
 * access. `isPlatformRead` rows are shown to the operator in redacted form —
 * 'platform support accessed this tenant at T, reason category X' — not hidden.
 * Suppressing them entirely becomes a contract problem."
 *
 * So this NARROWS a row; it never drops one. What goes:
 *
 *  - the individual staff member's name and id. The operator is entitled to
 *    know their data was accessed by our support function, not to know which
 *    employee — that is our staff's personal data, and naming them invites
 *    pressure on an individual over a support decision.
 *  - the free-text reason, replaced by its category. See
 *    PLATFORM_READ_CATEGORIES: the text can name a third party.
 *  - before/after payloads, which for a READ are the shape of what was looked
 *    at rather than a change, and are not needed to establish that access
 *    occurred.
 *
 * ⚠ A ROW THAT IS NOT A PLATFORM READ PASSES THROUGH UNTOUCHED. Redacting the
 * operator's own activity would hide their own staff's actions from them, which
 * is the opposite of what this is for.
 */
export function redactPlatformReadForOperator(row: StoredAuditRow): OperatorVisibleAuditRow {
  if (!row.isPlatformRead) {
    return {
      at: row.at,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      actorLabel: row.actorLabel,
      isPlatformRead: false,
      reason: row.reason ?? null,
    }
  }

  const category = (row.metadata as { platformReadCategory?: string } | null | undefined)
    ?.platformReadCategory

  return {
    at: row.at,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    // Generic by design. Not "[redacted]" — the operator should read this as a
    // fact about who accessed their data, not as something withheld.
    actorLabel: 'Platform support',
    isPlatformRead: true,
    // `UNSPECIFIED` rather than omitting the field: a missing category would
    // render as though the row had no reason, when in fact it has one we failed
    // to record. Say so.
    reasonCategory: category ?? 'UNSPECIFIED',
  }
}

/** Apply to a whole audit page. Never filters — see above. */
export function operatorAuditView(rows: readonly StoredAuditRow[]): OperatorVisibleAuditRow[] {
  return rows.map(redactPlatformReadForOperator)
}
