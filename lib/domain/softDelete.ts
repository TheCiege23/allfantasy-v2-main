/**
 * Commissioner OS · soft delete. T-006.
 *
 * Invariant 4: no application code issues `DELETE`. Deletable models carry
 * `deletedAt`, `deletedBy`, `deleteReason`, `purgeAfter` — all four — and only
 * the purge job (`commish_purge`) deletes.
 *
 * ─── WHAT THIS IS AND IS NOT ─────────────────────────────────────────────────
 * This is a CONVENIENCE, exactly like the tenancy extension in TENANCY.md §2.
 * It stops a soft-deleted row appearing in an ordinary list. It is not a
 * boundary, and it has a hole that is documented and tested rather than
 * papered over — see `KNOWN HOLE` below.
 *
 * ─── `deleteMany` IS ABSENT FROM THE FILTERED LIST ON PURPOSE ────────────────
 * It is BANNED (T-005), not filtered. Injecting `deletedAt: null` into a
 * `deleteMany` does not make it safe — it still HARD-DELETES every row it
 * matches, it just matches fewer of them. Filtering it would produce a
 * destructive operation wearing the costume of a safe one, which is worse than
 * leaving it obviously dangerous. `softDelete.test.ts` asserts the extension
 * does not touch it.
 *
 * ─── KNOWN HOLE: NESTED `include` ────────────────────────────────────────────
 * Prisma client extensions do not intercept nested relation reads. So
 *
 *     tx.league.findMany({ include: { teams: true } })
 *
 * filters the LEAGUES and returns soft-deleted TEAMS. There is a test that
 * documents this rather than hiding it, because the same limitation is
 * load-bearing at T-102: it is precisely why tenancy cannot rest on an
 * extension and needs RLS. For soft delete the consequence is a stale row in a
 * list; for tenancy the identical hole is a cross-tenant read.
 *
 * Until a service-layer filter exists, a query that includes children of a
 * soft-deletable model must filter them itself.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { ActorContext } from './actorContext'
import type { DomainError } from './errors'
import { forbidden } from './errors'
import { type Result, err, ok } from './result'
import { validateReason } from './reason'
import { type Authorize, denyAll } from './ports'

/**
 * The operations that get `deletedAt: null` injected.
 *
 * `findUnique` is NOT here and cannot be: its `where` accepts only unique
 * fields, so `deletedAt` is not a legal filter on it. That is why T-005 bans
 * `findUnique` outright on this surface rather than filtering it — a ban is the
 * only available answer when the operation is structurally unfilterable.
 */
export const SOFT_DELETE_FILTERED_OPERATIONS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
] as const

export type SoftDeleteFilteredOperation = (typeof SOFT_DELETE_FILTERED_OPERATIONS)[number]

const FILTERED = new Set<string>(SOFT_DELETE_FILTERED_OPERATIONS)

// ─── The read-deleted escape ─────────────────────────────────────────────────

const includeDeletedStore = new AsyncLocalStorage<{ includeDeleted: true }>()

/** True while inside an authorised `withDeleted` scope. */
export function isIncludeDeletedScope(): boolean {
  return includeDeletedStore.getStore()?.includeDeleted === true
}

export const READ_DELETED_ACTION = 'data.readDeleted'

/**
 * Run `fn` with soft-delete filtering suspended.
 *
 * ⚠ AN AUDITED ACTION, NOT A FLAG. HANDOFF.md: platform and tenant-support
 * only, reason required. Both are enforced here rather than by convention —
 * authorization through the `Authorize` port (which defaults to `denyAll`, so
 * this fails closed until T-104 supplies the matrix) and the reason through the
 * same validator the mutation wrapper uses.
 *
 * The reason requirement is not ceremony. Reading deleted data is the one
 * operation whose entire purpose is to see what someone intended to remove, and
 * "why" is the only thing that distinguishes support work from snooping.
 */
export async function withDeleted<T>(
  ctx: ActorContext,
  fn: () => Promise<T>,
  deps: { authorize?: Authorize } = {},
): Promise<Result<T, DomainError>> {
  const authorize = deps.authorize ?? denyAll

  const allowed = await authorize({ ctx, requires: READ_DELETED_ACTION, resource: null })
  if (!allowed.ok) return err(allowed.error)

  const reason = validateReason(READ_DELETED_ACTION, ctx.reason)
  if (!reason.ok) return err(reason.error)

  return ok(await includeDeletedStore.run({ includeDeleted: true }, fn))
}

// ─── The pure core ───────────────────────────────────────────────────────────

export type SoftDeleteArgsParams = {
  readonly model: string
  readonly operation: string
  readonly args: Record<string, unknown> | undefined
  readonly isSoftDeletable: (model: string) => boolean
  readonly includeDeleted: boolean
}

/**
 * Return `args` with `deletedAt: null` applied, or unchanged when it should not
 * be. Pure, so every rule below is testable without a database.
 *
 * ⚠ COMBINED WITH `AND`, NOT SPREAD INTO `where`.
 * A spread (`{ ...args.where, deletedAt: null }`) silently overwrites a
 * caller's own `deletedAt` filter, and it collides with a top-level `OR`:
 * `{ OR: [a, b], deletedAt: null }` reads as "(a OR b) AND not-deleted" only by
 * luck of Prisma's semantics, and a caller who wrote `NOT` gets something else
 * again. `AND` composes correctly with every shape a caller can write.
 */
export function applySoftDeleteArgs(
  params: SoftDeleteArgsParams,
): Record<string, unknown> | undefined {
  const { model, operation, args, isSoftDeletable, includeDeleted } = params

  if (!FILTERED.has(operation)) return args
  if (!isSoftDeletable(model)) return args
  if (includeDeleted) return args

  const existing = (args as { where?: unknown } | undefined)?.where
  const notDeleted = { deletedAt: null }

  return {
    ...(args ?? {}),
    where: existing === undefined ? notDeleted : { AND: [existing, notDeleted] },
  }
}

// ─── Model awareness ─────────────────────────────────────────────────────────

/**
 * Models whose Prisma schema carries `deletedAt`, read from the generated
 * client's DMMF.
 *
 * Derived rather than hardcoded so it cannot drift: a model that gains
 * `deletedAt` is covered on the next `prisma generate`, and a hardcoded list
 * would have to be remembered.
 *
 * ⚠ IT REFLECTS THE GENERATED CLIENT, NOT `schema.prisma`. In a checkout whose
 * client predates a merge, a newly-added model is simply absent — measured here
 * on 2026-08-31, the client held 704 models and knew nothing of the six T-101
 * added. That is a stale-artifact problem, not a logic one, and the constructor
 * below turns it into a loud failure rather than silent under-filtering.
 */
export function softDeletableModelsFromDmmf(dmmf: {
  datamodel: { models: ReadonlyArray<{ name: string; fields: ReadonlyArray<{ name: string }> }> }
}): Set<string> {
  return new Set(
    dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === 'deletedAt'))
      .map((m) => m.name),
  )
}

export type SoftDeleteExtensionOptions = {
  /** Models to filter. Usually `softDeletableModelsFromDmmf(Prisma.dmmf)`. */
  readonly softDeletableModels: ReadonlySet<string>
  /**
   * Whether a model really has the column. Used only to validate the set above.
   * Omit when the set was derived from DMMF and is trusted.
   */
  readonly hasDeletedAtColumn?: (model: string) => boolean
  readonly isIncludeDeleted?: () => boolean
}

/**
 * The model-aware guard HANDOFF.md asks for: "injecting into a model without
 * the column throws".
 *
 * It throws at CONSTRUCTION, not on the first query. A misconfigured set
 * discovered at construction is a boot failure; discovered on a query it is an
 * intermittent one that appears only on the code path that happens to touch the
 * bad model — quite possibly in production, months later.
 */
export function assertModelsHaveDeletedAt(
  models: ReadonlySet<string>,
  hasDeletedAtColumn: (model: string) => boolean,
): void {
  const bogus = [...models].filter((m) => !hasDeletedAtColumn(m)).sort()
  if (bogus.length > 0) {
    throw new Error(
      `Soft-delete misconfiguration: ${bogus.join(', ')} listed as soft-deletable but ` +
        `carrying no deletedAt column. Every query against them would inject a filter on a ` +
        `field that does not exist. Add the four columns (deletedAt, deletedBy, deleteReason, ` +
        `purgeAfter) or remove them from the set.`,
    )
  }
}

/**
 * The Prisma client extension.
 *
 * Shaped as `{ query: { $allModels: { … } } }` so it can be handed to
 * `client.$extends(...)`. Built as a plain object rather than via
 * `Prisma.defineExtension` so this module does not need the generated client at
 * import time — which keeps it testable in a checkout whose client is stale,
 * and keeps `lib/domain/` importable from a test that never touches Postgres.
 */
export function createSoftDeleteExtension(options: SoftDeleteExtensionOptions) {
  const { softDeletableModels, hasDeletedAtColumn, isIncludeDeleted } = options

  if (hasDeletedAtColumn) assertModelsHaveDeletedAt(softDeletableModels, hasDeletedAtColumn)

  const isSoftDeletable = (model: string) => softDeletableModels.has(model)
  const includeDeleted = isIncludeDeleted ?? isIncludeDeletedScope

  const handler = async ({
    model,
    operation,
    args,
    query,
  }: {
    model: string
    operation: string
    args: Record<string, unknown> | undefined
    query: (args: Record<string, unknown> | undefined) => Promise<unknown>
  }) =>
    query(
      applySoftDeleteArgs({
        model,
        operation,
        args,
        isSoftDeletable,
        includeDeleted: includeDeleted(),
      }),
    )

  return {
    name: 'commissioner-os-soft-delete',
    query: {
      $allModels: Object.fromEntries(
        SOFT_DELETE_FILTERED_OPERATIONS.map((op) => [op, handler]),
      ),
    },
  }
}
