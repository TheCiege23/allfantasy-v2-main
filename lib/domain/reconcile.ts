/**
 * Commissioner OS · the reconciler. T-203.
 *
 * "Provider data enters through a reconciler with an integration
 * `ActorContext`, so `cause: SYNC` rows are distinguishable from human writes.
 * A provider can never trigger an action the matrix would deny a commissioner."
 *
 * ─── 🛑 PLAN THEN APPLY, BECAUSE "NO PARTIAL WRITES" IS STRUCTURAL ───────────
 * T-203's acceptance feeds hostile data and requires each case "rejected with
 * NO PARTIAL WRITES". A reconciler that validates each row as it writes it
 * satisfies the rejection and fails the second half: by the time row nine is
 * refused, rows one to eight are committed, and the league is left half-synced
 * with no record of what happened.
 *
 * So validation produces a PLAN — every operation, or nothing. Nothing here
 * writes. `applyReconcilePlan` takes a complete plan and a tx, and a plan is
 * only ever complete. The transaction is a second line of defence, not the
 * first: a rollback still leaves the sync job to explain, whereas a rejected
 * plan never started.
 *
 * ─── AND THE CEILING IS A COMMISSIONER, NOT AN ADMIN ─────────────────────────
 * `SYNC_PERMITTED_ACTIONS` is the complete set of things provider data may
 * cause. `reconcile.test.ts` asserts every one is grantable to COMMISSIONER,
 * which is the machine-checkable form of the handoff's sentence. Adding an
 * action here that a commissioner cannot take fails that test.
 */

import type { ActorContext } from './actorContext'
import type { Tx } from './db'
import { type ActionKey } from './authorize'
import { type DomainError, invariant } from './errors'
import { type Result, err, ok } from './result'
import { syntheticIntegrationActor } from './actorContext'
import type { ExternalManager, ExternalTeam } from './providers'

/**
 * Everything provider data is permitted to cause. One action, deliberately.
 *
 * ⚠ THIS IS A CEILING, NOT A CONVENIENCE. Widening it is how a provider ends up
 * able to do something no human in the product can — and provider data is
 * untrusted input from a third party who has never agreed to our permission
 * model.
 */
export const SYNC_PERMITTED_ACTIONS: readonly ActionKey[] = ['league.sync.reconcile']

/** Marks a write as caused by sync rather than by a person. */
export const SYNC_CAUSE = 'SYNC' as const

// ─── Input ───────────────────────────────────────────────────────────────────

export type ReconcileInput = {
  readonly tenantId: string
  readonly leagueId: string
  readonly bindingId: string
  readonly provider: string
  readonly teams: readonly ExternalTeam[]
  readonly managers: readonly ExternalManager[]
  /** Roster membership, if the provider supplied any. */
  readonly rosterEntries?: readonly { externalTeamId: string; playerId: string }[]
}

/**
 * What the reconciler is allowed to believe already exists.
 *
 * ⚠ SUPPLIED BY US, NEVER BY THE PROVIDER. Every hostile case in T-203's
 * acceptance is a reference the provider asserts and we cannot confirm — a team
 * in another tenant, a manager that does not exist, a player we have never
 * heard of. The only way to catch those is to check against a set the provider
 * did not write.
 */
export type ReconcileWorld = {
  /** Our leagues, with their owning tenant. */
  readonly leagueTenant: ReadonlyMap<string, string>
  /** Team ids we already have for this binding, and their owning tenant. */
  readonly teamTenant: ReadonlyMap<string, string>
  readonly knownPlayerIds: ReadonlySet<string>
}

export type ReconcileOp =
  | { readonly kind: 'upsertTeam'; readonly externalTeamId: string; readonly name: string; readonly externalManagerId: string | null }
  | { readonly kind: 'upsertManager'; readonly externalManagerId: string; readonly displayName: string }
  | { readonly kind: 'setRoster'; readonly externalTeamId: string; readonly playerIds: readonly string[] }

export type ReconcilePlan = {
  readonly tenantId: string
  readonly leagueId: string
  readonly bindingId: string
  readonly ops: readonly ReconcileOp[]
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Build a plan, or refuse the whole payload.
 *
 * Refusals name the FIRST problem and stop. Reporting all of them would be
 * friendlier for a human filling in a form; for a provider payload it is not,
 * because the payload is machine-generated and one bad reference usually means
 * the whole response is from the wrong league.
 */
export function planReconcile(
  input: ReconcileInput,
  world: ReconcileWorld,
): Result<ReconcilePlan, DomainError> {
  const reject = (name: string, detail: string) => err(invariant(`sync.${name}`, detail))

  // ── The league must be ours, and in THIS tenant.
  const owner = world.leagueTenant.get(input.leagueId)
  if (owner === undefined) {
    return reject('unknownLeague', `Sync targets league ${input.leagueId}, which does not exist.`)
  }
  if (owner !== input.tenantId) {
    // 🛑 The hostile case that matters most. RLS would also refuse the write,
    // but only at the moment of writing — by which point earlier ops in the
    // same payload would already have landed if this were validated inline.
    return reject(
      'crossTenantLeague',
      `Sync targets league ${input.leagueId}, which belongs to another tenant.`,
    )
  }

  // ── Managers first: teams reference them, so an unknown manager must be
  //    caught before any team op is built.
  const managerIds = new Set<string>()
  const ops: ReconcileOp[] = []

  for (const m of input.managers) {
    if (!m.externalManagerId) {
      return reject('malformedManager', 'A manager arrived with no external id.')
    }
    if (managerIds.has(m.externalManagerId)) {
      // A duplicate would upsert twice and, in a set-based roster op, silently
      // win on whichever came last.
      return reject('duplicateManager', `Manager ${m.externalManagerId} appears twice.`)
    }
    managerIds.add(m.externalManagerId)
    ops.push({
      kind: 'upsertManager',
      externalManagerId: m.externalManagerId,
      displayName: m.displayName,
    })
  }

  // ── Teams.
  const teamIds = new Set<string>()
  for (const t of input.teams) {
    if (!t.externalTeamId) {
      return reject('malformedTeam', 'A team arrived with no external id.')
    }
    if (teamIds.has(t.externalTeamId)) {
      return reject('duplicateTeam', `Team ${t.externalTeamId} appears twice.`)
    }

    // A team we already hold, owned by someone else.
    const existingOwner = world.teamTenant.get(t.externalTeamId)
    if (existingOwner !== undefined && existingOwner !== input.tenantId) {
      return reject(
        'crossTenantTeam',
        `Team ${t.externalTeamId} already belongs to another tenant.`,
      )
    }

    // ⚠ A NULL manager is legal — an unclaimed roster is ordinary (T-202). A
    // NON-NULL manager we have never seen is not: the provider is asserting a
    // relationship to something that does not exist.
    if (t.externalManagerId !== null && !managerIds.has(t.externalManagerId)) {
      return reject(
        'unknownManager',
        `Team ${t.externalTeamId} names manager ${t.externalManagerId}, who is not in this payload.`,
      )
    }

    teamIds.add(t.externalTeamId)
    ops.push({
      kind: 'upsertTeam',
      externalTeamId: t.externalTeamId,
      name: t.name,
      externalManagerId: t.externalManagerId,
    })
  }

  // ── Rosters.
  if (input.rosterEntries && input.rosterEntries.length > 0) {
    const byTeam = new Map<string, string[]>()
    for (const entry of input.rosterEntries) {
      if (!teamIds.has(entry.externalTeamId)) {
        return reject(
          'unknownTeam',
          `Roster entry names team ${entry.externalTeamId}, which is not in this payload.`,
        )
      }
      if (!world.knownPlayerIds.has(entry.playerId)) {
        // 🛑 The provider asserting a player we do not have. Writing it would
        // create a roster row pointing at nothing, and the failure would
        // surface later as an empty lineup rather than as a sync problem.
        return reject(
          'unknownPlayer',
          `Roster entry names player ${entry.playerId}, which we do not have.`,
        )
      }
      byTeam.set(entry.externalTeamId, [...(byTeam.get(entry.externalTeamId) ?? []), entry.playerId])
    }
    for (const [externalTeamId, playerIds] of byTeam) {
      ops.push({ kind: 'setRoster', externalTeamId, playerIds })
    }
  }

  return ok({
    tenantId: input.tenantId,
    leagueId: input.leagueId,
    bindingId: input.bindingId,
    ops,
  })
}

// ─── The synthetic actor ─────────────────────────────────────────────────────

/**
 * The actor every reconcile runs as.
 *
 * ⚠ IT HOLDS NO ROLE ON ANY AXIS. `syntheticIntegrationActor` gives integration
 * strictly LESS authority than any person rather than equal authority under a
 * different name — so the ceiling is enforced by `SYNC_PERMITTED_ACTIONS`
 * above, not by the actor happening to be privileged enough.
 *
 * The actor's job is ATTRIBUTION: `integration:<provider>` in the audit trail,
 * so a sync-caused row is distinguishable from a human one at a glance and by a
 * query.
 */
export function reconcileActor(
  tenantId: string,
  provider: string,
  requestId?: string,
): Result<ActorContext, DomainError> {
  return syntheticIntegrationActor(tenantId, provider, requestId)
}

/**
 * The audit row a reconcile writes.
 *
 * `cause: SYNC` in metadata AND `integration:<provider>` as the actor. Both,
 * because they answer different questions: the actor says WHO, the cause says
 * WHY, and a query for "everything sync did last night" wants the second
 * without having to pattern-match on the first.
 */
export function reconcileAuditDraft(plan: ReconcilePlan, provider: string) {
  return {
    action: 'league.sync.reconcile' satisfies ActionKey,
    resourceType: 'LeagueBinding',
    resourceId: plan.bindingId,
    leagueId: plan.leagueId,
    metadata: {
      cause: SYNC_CAUSE,
      provider,
      ops: plan.ops.length,
      teams: plan.ops.filter((o) => o.kind === 'upsertTeam').length,
      managers: plan.ops.filter((o) => o.kind === 'upsertManager').length,
    },
  }
}

// ─── Apply ───────────────────────────────────────────────────────────────────

export type ReconcileApplyDeps = {
  readonly withTenant: <T>(tenantId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>
  readonly applyOp: (tx: Tx, plan: ReconcilePlan, op: ReconcileOp) => Promise<void>
  readonly writeAudit: (tx: Tx, ctx: ActorContext, draft: ReturnType<typeof reconcileAuditDraft>) => Promise<void>
}

/**
 * Apply a plan.
 *
 * Takes a PLAN, not an input — so there is no code path that writes without
 * having validated everything first. That is the "no partial writes" guarantee
 * expressed in the type rather than in a comment: a caller cannot skip the
 * validation because it has nothing else to pass.
 */
export async function applyReconcilePlan(
  deps: ReconcileApplyDeps,
  plan: ReconcilePlan,
  ctx: ActorContext,
  provider: string,
): Promise<Result<{ applied: number }, DomainError>> {
  if (ctx.tenantId !== plan.tenantId) {
    // The plan and the actor disagree about whose data this is. Refuse rather
    // than trusting either — withTenant would scope to the actor and happily
    // write the plan's rows into the wrong tenant if RLS were ever absent.
    return err(
      invariant('sync.actorPlanMismatch', 'The reconcile actor and the plan name different tenants.'),
    )
  }

  await deps.withTenant(plan.tenantId, async (tx) => {
    for (const op of plan.ops) await deps.applyOp(tx, plan, op)
    // Audited in the same transaction, like every other mutation (invariant 3).
    await deps.writeAudit(tx, ctx, reconcileAuditDraft(plan, provider))
  })

  return ok({ applied: plan.ops.length })
}
