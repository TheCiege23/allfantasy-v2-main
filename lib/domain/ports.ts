/**
 * Commissioner OS · the ports T-004 depends on but does not own.
 *
 * The mutation wrapper composes authorization (T-104), audit (T-007) and domain
 * events. None of the three exists yet, and the handoff sequences T-004 BEFORE
 * all of them — so T-004 defines the seams and the ordering, and the concrete
 * adapters arrive at their own tickets.
 *
 * ⚠ THE DEFAULTS FAIL CLOSED, AND THAT IS THE ONLY SAFE WAY TO SHIP A SEAM.
 * `denyAll` refuses every action; `refuseAudit` throws. A permissive default —
 * "allow until T-104 lands", "no-op the audit until T-007" — would let a
 * mutation path go live with no authorization and no audit trail, and it would
 * look completely healthy while doing it. A wrapper whose guards are stubs is
 * worse than no wrapper, because the wrapper is the reason nobody checks.
 */

import type { ActorContext } from './actorContext'
import type { DomainError } from './errors'
import type { Result } from './result'
import type { Tx } from './db'

// ─── Authorization (T-104 supplies the matrix) ───────────────────────────────

export type AuthorizeArgs<TResource> = {
  readonly ctx: ActorContext
  /** The permission key from the mutation definition. `ActionKey` at T-104. */
  readonly requires: string
  readonly resource: TResource
}

export type Authorize = <TResource>(
  args: AuthorizeArgs<TResource>,
) => Result<void, DomainError> | Promise<Result<void, DomainError>>

/**
 * The default. Refuses everything.
 *
 * T-104's acceptance is "one test per matrix row" and "`ActionKey` is
 * exhaustive so a missing row is a compile error". Until that exists there is
 * no basis on which to permit anything, and inventing one here would be
 * inventing a security policy in a file about plumbing.
 */
export const denyAll: Authorize = ({ requires }) => ({
  ok: false,
  error: {
    code: 'FORBIDDEN',
    action: requires,
    because:
      'Authorization is not configured. T-104 supplies the permission matrix; ' +
      'until then every action is refused rather than allowed.',
  },
})

// ─── Audit (T-007 supplies the model and the append-only trigger) ────────────

/**
 * What a mutation records about itself.
 *
 * `actorLabel` is denormalised from the context rather than joined at read
 * time, per `CLAUDE.md` — an audit trail must stay readable after the person is
 * deleted, and a join would render years of history as "unknown" the day
 * someone leaves.
 */
export type AuditDraft = {
  readonly action: string
  readonly resourceType: string
  readonly resourceId: string
  /**
   * The league this concerns, when there is one.
   *
   * ⚠ A BARE COLUMN ON `AuditEvent`, WITH NO FOREIGN KEY. T-009 requires audit
   * rows to survive a league purge, and the two pre-existing audit tables in
   * this repo both cascade from League — which is precisely why neither could
   * be reused. Falls back to `ctx.onBehalfOfLeagueId` when not given.
   */
  readonly leagueId?: string
  /** State before and after, for the operator-facing diff. */
  readonly before?: unknown
  readonly after?: unknown
  /**
   * ⚠ NEVER put provider credentials in here. `CLAUDE.md` names this
   * explicitly, and audit payloads are the least-inspected data in any system
   * — a token written here is a token nobody notices for a year.
   */
  readonly metadata?: Record<string, unknown>
}

/**
 * Writes the audit row.
 *
 * ⚠ TAKES `tx`, NOT A CLIENT. Invariant 3: "Audit rows are written inside the
 * transaction they describe." A writer holding its own connection would commit
 * the audit row independently, so a rolled-back mutation would leave a record
 * of something that never happened — which is worse than no audit at all,
 * because it is confidently wrong.
 */
export type WriteAudit = (
  tx: Tx,
  ctx: ActorContext,
  draft: AuditDraft,
) => Promise<void>

/** The default. Throws, which aborts the transaction. */
export const refuseAudit: WriteAudit = async () => {
  throw new Error(
    'No audit writer configured. T-007 supplies AuditEvent and its append-only trigger. ' +
      'Refusing rather than silently skipping — an unaudited mutation is an invariant violation, not a degraded mode.',
  )
}

// ─── Domain events ───────────────────────────────────────────────────────────

export type DomainEventDraft = {
  readonly type: string
  readonly payload: Record<string, unknown>
}

/**
 * Emits AFTER commit.
 *
 * ⚠ Never inside the transaction. `CLAUDE.md`: "it may roll back — you'll push
 * a notification about a trade that didn't happen." An emitter that throws must
 * not undo a committed mutation either, which is why `runMutation` reports
 * emission failures separately rather than turning them into a failed result.
 */
export type EmitEvents = (
  ctx: ActorContext,
  events: readonly DomainEventDraft[],
) => Promise<void>

export const noopEmit: EmitEvents = async () => {}

/**
 * Enqueue events INSIDE the transaction, for delivery after it commits.
 *
 * 🛑 THIS IS NOT A CONTRADICTION OF THE RULE ABOVE — IT IS THE FIX FOR IT.
 * `CLAUDE.md` bans emitting inside the transaction because it may roll back and
 * you push a notification about a trade that did not happen. `EmitEvents` above
 * solves that by emitting after commit — and in doing so opens the opposite
 * hole: if the process dies between COMMIT and the emit call, the trade
 * happened and nothing was ever published. There is no in-process ordering that
 * closes both.
 *
 * A transactional outbox closes both. The event row is written in the same
 * transaction as the mutation, so it rolls back with it and cannot describe
 * something that did not happen; a separate relay delivers it after commit, so
 * nothing is lost to a crash. This repo already has one —
 * `lib/events/outboxStore.ts`, whose `enqueue` takes `opts.tx` for exactly this
 * reason — so `lib/domain/events.ts` adapts onto it rather than building a
 * second.
 *
 * `EmitEvents` remains for callers with no outbox. Prefer this.
 */
export type EnqueueEvents = (
  tx: Tx,
  ctx: ActorContext,
  events: readonly DomainEventDraft[],
) => Promise<void>
