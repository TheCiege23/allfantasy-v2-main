/**
 * Commissioner OS · the mutation wrapper. T-004.
 *
 * Every write goes through this, in this order:
 *
 *   1. withTenant                     (T-002)
 *   2. load the target, SELECT … FOR UPDATE
 *   3. authorize(ctx, requires, resource)
 *   4. phase gate
 *   5. precondition hook
 *   6. reason present and valid when required
 *   7. run
 *   8. write AuditEvent — in THIS transaction
 *   9. commit, THEN emit domain events
 *
 * ─── WHY THE ORDER IS THE DESIGN ─────────────────────────────────────────────
 * Steps 2–6 are all inside the transaction opened at step 1, and step 2 takes a
 * row lock. That is what makes the gates real: `CLAUDE.md` calls a phase gate
 * checked before the transaction a TOCTOU bug, and it is — read the phase,
 * decide, then write, and something else changes the phase in between. The
 * decision was correct about a world that no longer exists.
 *
 * Step 8 inside and step 9 outside is the other half. An audit row written
 * outside the transaction survives a rollback and records something that never
 * happened; an event emitted inside is pushed and then un-happens. Both are
 * "the write succeeded" told to someone who cannot check.
 *
 * ─── HOW FAILURE GETS OUT OF A TRANSACTION ───────────────────────────────────
 * A Prisma interactive transaction COMMITS unless its callback throws. So a
 * step that returns `err(...)` cannot simply be returned — that would report
 * the refusal and commit the partial work anyway. Refusals are thrown as
 * `MutationAbort` carrying the `DomainError`, caught outside the transaction,
 * and converted back into a `Result`. That is the single place in this codebase
 * where the "errors are returned, not thrown" convention is inverted, and it is
 * inverted because the alternative is silent data corruption.
 */

import type { ActorContext } from './actorContext'
import type { Tx } from './db'
import { type DomainError, conflict, invariant, wrongPhase } from './errors'
import { type Result, err, ok } from './result'
import { validateReason } from './reason'
import {
  type AuditDraft,
  type Authorize,
  type DomainEventDraft,
  type EmitEvents,
  type EnqueueEvents,
  type WriteAudit,
  denyAll,
  noopEmit,
  refuseAudit,
} from './ports'

/** Carries a refusal across the transaction boundary. Internal. */
class MutationAbort extends Error {
  constructor(readonly domainError: DomainError) {
    super(`MutationAbort: ${domainError.code}`)
    this.name = 'MutationAbort'
  }
}

export type PhaseGate<TResource> = {
  /** Reads the current phase off the locked row. */
  readonly of: (resource: TResource) => string
  readonly allowed: readonly string[]
  /** An action key the UI can render as a button, e.g. `draft.pause`. */
  readonly remedy?: string
}

export type MutationDefinition<TResource, TInput, TOutput> = {
  readonly action: string
  /** Permission key handed to `authorize`. Becomes `ActionKey` at T-104. */
  readonly requires: string
  readonly resourceType: string

  /**
   * Load the target row.
   *
   * 🛑 THIS MUST TAKE A ROW LOCK — `SELECT … FOR UPDATE`. Everything below it
   * decides against what this returns, and without the lock all of those
   * decisions are about a row another transaction is free to change before the
   * write lands. `runMutation` cannot verify the lock (the query is opaque to
   * it), so this is a contract the definition keeps.
   *
   * With Prisma that means `tx.$queryRaw` — the query builder has no FOR UPDATE.
   * That raw call is inside `lib/domain/`, which is exactly where T-005's lint
   * rule permits raw SQL.
   */
  readonly load: (tx: Tx, input: TInput, ctx: ActorContext) => Promise<TResource | null>

  readonly phases?: PhaseGate<TResource>
  readonly reasonRequired?: boolean

  /**
   * Non-phase preconditions — draft status, rate limits, entitlements.
   *
   * A separate hook rather than more branches in the phase gate, because a
   * phase gate that also checks entitlements produces WRONG_PHASE for a billing
   * problem, and the operator goes looking at the draft.
   */
  readonly precondition?: (args: {
    tx: Tx
    ctx: ActorContext
    resource: TResource
    input: TInput
  }) => Promise<Result<void, DomainError>> | Result<void, DomainError>

  readonly run: (args: {
    tx: Tx
    ctx: ActorContext
    resource: TResource
    input: TInput
  }) => Promise<Result<TOutput, DomainError>>

  readonly audit: (args: {
    ctx: ActorContext
    resource: TResource
    input: TInput
    output: TOutput
  }) => AuditDraft

  readonly events?: (args: {
    ctx: ActorContext
    resource: TResource
    input: TInput
    output: TOutput
  }) => readonly DomainEventDraft[]
}

export type MutationOptions = {
  /**
   * Optimistic concurrency. The phase the CALLER believed the resource was in
   * when it decided to act — typically rendered into the page the operator
   * clicked.
   *
   * ⚠ THIS IS WHAT MAKES A CONCURRENT CHANGE A `CONFLICT` RATHER THAN A
   * `WRONG_PHASE`, and the distinction is the whole point of T-004's third
   * acceptance test. Without it the two are indistinguishable: "you cannot do
   * that in this phase" and "someone changed the phase while you were deciding"
   * produce the same refusal, and only the second one means "look again, you
   * may still be able to". Omit it and only the plain phase gate applies.
   */
  readonly expectedPhase?: string
}

export type MutationDeps = {
  readonly withTenant: <T>(tenantId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>
  readonly authorize?: Authorize
  readonly writeAudit?: WriteAudit
  readonly emit?: EmitEvents
  /**
   * Transactional outbox (T-007). PREFERRED over `emit`.
   *
   * When supplied, events are written INSIDE the transaction and `emit` is not
   * called — a relay delivers them after commit. That closes the lost-event
   * window `emit` cannot: a crash between COMMIT and an in-process emit loses
   * the event permanently, and no ordering of two in-process steps fixes it.
   */
  readonly enqueueEvents?: EnqueueEvents
  /**
   * Where a post-commit emission failure goes. It cannot become a failed
   * result — the mutation is committed and telling the caller it failed would
   * make them retry a write that already happened.
   */
  readonly onEmitError?: (error: unknown, ctx: ActorContext) => void
}

export function createMutationRunner(deps: MutationDeps) {
  const authorize = deps.authorize ?? denyAll
  const writeAudit = deps.writeAudit ?? refuseAudit
  const emit = deps.emit ?? noopEmit

  return async function runMutation<TResource, TInput, TOutput>(
    def: MutationDefinition<TResource, TInput, TOutput>,
    ctx: ActorContext,
    input: TInput,
    options: MutationOptions = {},
  ): Promise<Result<TOutput, DomainError>> {
    let pending: readonly DomainEventDraft[] = []

    let output: TOutput
    try {
      // 1 · withTenant. Everything below runs in one transaction on one
      //     connection, with app.tenant_id set for RLS.
      output = await deps.withTenant(ctx.tenantId, async (tx) => {
        // 2 · Load the target under a row lock. First statement, deliberately.
        const resource = await def.load(tx, input, ctx)
        if (resource === null || resource === undefined) {
          throw new MutationAbort(
            invariant(`${def.resourceType}.notFound`, `No ${def.resourceType} matched this request.`),
          )
        }

        // 3 · Authorize against the row we actually locked, never against an
        //     id or a caller-supplied copy of it.
        const authorized = await authorize({ ctx, requires: def.requires, resource })
        if (!authorized.ok) throw new MutationAbort(authorized.error)

        // 4 · Phase gate, against the locked row.
        if (def.phases) {
          const actual = def.phases.of(resource)

          // Optimistic-concurrency check first. If the caller told us what they
          // believed and it is no longer true, that is CONFLICT — someone moved
          // it underneath them — even when the new phase would also have been
          // allowed. Reporting WRONG_PHASE here would be wrong twice: wrong code,
          // and it hides that a race happened at all.
          if (options.expectedPhase !== undefined && options.expectedPhase !== actual) {
            throw new MutationAbort(
              conflict(
                def.resourceType,
                `This ${def.resourceType} moved from ${options.expectedPhase} to ${actual} while you were deciding. Re-read it and try again.`,
              ),
            )
          }

          if (!def.phases.allowed.includes(actual)) {
            throw new MutationAbort(
              wrongPhase(def.action, actual, def.phases.allowed, def.phases.remedy),
            )
          }
        }

        // 5 · Non-phase preconditions.
        if (def.precondition) {
          const pre = await def.precondition({ tx, ctx, resource, input })
          if (!pre.ok) throw new MutationAbort(pre.error)
        }

        // 6 · Reason. AFTER authorization on purpose: telling someone their
        //     reason is too short for an action they were never allowed to take
        //     leaks which actions exist and wastes their time.
        if (def.reasonRequired) {
          const reason = validateReason(def.action, ctx.reason)
          if (!reason.ok) throw new MutationAbort(reason.error)
        }

        // 7 · The write.
        const result = await def.run({ tx, ctx, resource, input })
        if (!result.ok) throw new MutationAbort(result.error)

        // 8 · Audit, in THIS transaction, before commit. If this throws the
        //     mutation rolls back — an unaudited write is not a degraded mode,
        //     it is an invariant violation.
        await writeAudit(tx, ctx, def.audit({ ctx, resource, input, output: result.value }))

        const produced = def.events?.({ ctx, resource, input, output: result.value }) ?? []

        if (deps.enqueueEvents) {
          // 8b · Transactional outbox. Written HERE, in the mutation's own
          //      transaction, so it rolls back with the mutation and cannot
          //      describe something that did not happen. Delivery is the
          //      relay's job, after commit.
          if (produced.length > 0) await deps.enqueueEvents(tx, ctx, produced)
          // Nothing left to do after commit.
          pending = []
        } else {
          // Buffered, not emitted. Nothing leaves the process until commit.
          pending = produced
        }

        return result.value
      })
    } catch (error) {
      if (error instanceof MutationAbort) return err(error.domainError)
      // Anything else — a lock timeout, a constraint violation, a failed audit
      // write — is not a domain refusal and must not be flattened into one.
      throw error
    }

    // 9 · Committed. Only now does anything leave the process.
    if (pending.length > 0) {
      try {
        await emit(ctx, pending)
      } catch (error) {
        // The mutation is committed. Reporting failure would make the caller
        // retry a write that already happened, which is worse than a missed
        // notification.
        deps.onEmitError?.(error, ctx)
      }
    }

    return ok(output)
  }
}

export type MutationRunner = ReturnType<typeof createMutationRunner>
