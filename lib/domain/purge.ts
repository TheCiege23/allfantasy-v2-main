/**
 * Commissioner OS · the purge job. T-009.
 *
 * The ONLY code permitted to issue `DELETE`, and it runs as `commish_purge` —
 * a role that owns nothing and is granted `DELETE` where nothing else is.
 * Invariant 4 is enforced by that grant, not by this file being well-behaved.
 *
 * ─── CASCADE OR ORDERED DELETE: MEASURED, NOT CHOSEN ─────────────────────────
 * T-009 says "decide and implement cascade: `onDelete: Cascade` on FKs to
 * League and Tenant, or an explicitly ordered delete". The schema already
 * answers most of it. Counted across `schema.prisma`, relations pointing at
 * League:
 *
 *     Cascade             144
 *     SetNull               2   ImportRun, PlatformNotification
 *     Restrict (default)    2   TournamentLeague, LeagueManagerClaim
 *
 * So it is cascade — for 144 of 148 — and a `DELETE FROM leagues` does almost
 * all the work by itself. The ordered part is small and specific: the two
 * relations with NO `onDelete` default to `Restrict` in Prisma, and they will
 * abort the delete rather than cascade. That is precisely the FK violation
 * T-009's acceptance test exists to catch, and it is already present in the
 * schema today.
 *
 * The two `SetNull` relations are left alone deliberately: an `ImportRun` and a
 * `PlatformNotification` outlive the league with a null `leagueId`, which is
 * what `SetNull` means and is a reasonable record of "this happened, to
 * something now gone".
 *
 * ⚠ THE BLOCKER LIST IS DERIVED FROM THE SCHEMA AND WILL DRIFT.
 * A model added in month eight with a League relation and no `onDelete` becomes
 * a third blocker, and nothing here would know. `purge.spec.ts` re-derives the
 * list from `information_schema` and fails if it disagrees with this constant —
 * which is the only way a hardcoded list stays true.
 */

import type { ActorContext } from './actorContext'
import { type DomainError, invariant } from './errors'
import { type Result, err, ok } from './result'

// ─── Retention: config, not prose ────────────────────────────────────────────

/**
 * How long a soft-deleted thing waits before the purge may remove it.
 *
 * ⚠ CONFIG, NOT PROSE — T-009 says so explicitly, and the reason is that a
 * retention period written in a comment cannot be changed without a deploy, and
 * a retention period that needs a deploy gets changed in the database by hand
 * instead.
 *
 * Env-overridable so an operator contract requiring a different window is a
 * configuration change. Deliberately NOT per-tenant: a per-tenant retention
 * window is a product feature with a UI and an audit trail, not a constant.
 */
export const PURGE_RETENTION_DAYS = {
  tenant: readDays('COMMISH_PURGE_RETENTION_TENANT_DAYS', 30),
  league: readDays('COMMISH_PURGE_RETENTION_LEAGUE_DAYS', 30),
} as const

function readDays(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  // A malformed value falls back rather than throwing, and rather than becoming
  // NaN — `now - NaN days` is an invalid date, every comparison against it is
  // false, and the purge would silently stop running while reporting success.
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

// ─── The ordered part ────────────────────────────────────────────────────────

/**
 * Relations to League that default to `Restrict` and therefore abort a delete.
 *
 * Delete these first, then let the 144 cascades do the rest.
 */
export const LEAGUE_PURGE_BLOCKERS = ['TournamentLeague', 'LeagueManagerClaim'] as const

/**
 * Never purged, whatever else is.
 *
 * `AuditEvent.leagueId` carries NO foreign key (T-007), so it survives a league
 * delete by construction rather than by this list — the list is the second
 * line, and exists so a future "tidy up related rows" pass has something
 * explicit to trip over.
 *
 * ⚠ `LeagueFeature` IS NAMED BY T-009 AND DOES NOT EXIST IN THIS REPO. Recorded
 * rather than silently dropped: if a model by that name is added later it must
 * join this list, because the ticket's intent is that feature history outlives
 * the league it described.
 */
export const PURGE_EXEMPT_MODELS = ['AuditEvent'] as const

export type PurgeStep = {
  readonly model: string
  readonly reason: string
}

/**
 * The ordered plan for purging one league.
 *
 * Returned as data rather than executed inline so the ordering is assertable
 * without a database — the thing most likely to regress here is the order, and
 * the thing least likely to be noticed is that it regressed.
 */
export function planLeaguePurge(): readonly PurgeStep[] {
  return [
    ...LEAGUE_PURGE_BLOCKERS.map((model) => ({
      model,
      reason: `Relation to League has no onDelete, so Prisma defaults it to Restrict — it aborts the delete instead of cascading.`,
    })),
    {
      model: 'League',
      reason: '144 relations cascade from here. This one statement removes teams, rosters, drafts, members and the rest.',
    },
  ]
}

// ─── Execution ───────────────────────────────────────────────────────────────

/**
 * What the purge needs to do its job.
 *
 * ⚠ `deleteMany` IS THE ONLY WRITE, AND IT IS INJECTED. The purge does not
 * construct a client: it is handed one built from `COMMISH_PURGE_URL`. That
 * keeps the role boundary visible at the composition root rather than buried
 * here, and it is what makes this testable without granting a test DELETE.
 */
export type PurgeDeps = {
  readonly deleteMany: (model: string, where: Record<string, unknown>) => Promise<number>
  readonly now?: () => Date
}

export type PurgeReport = {
  readonly leagueId: string
  readonly deleted: ReadonlyArray<{ model: string; rows: number }>
}

/**
 * Purge one league, in order.
 *
 * Not wrapped in `withTenant`: the purge runs as `commish_purge`, which has a
 * maintenance policy rather than the tenant-scoped one (TENANCY.md §3.2), and
 * a purge scoped to `app.tenant_id` would silently match zero rows — the same
 * trap the T-101 backfill guards against.
 */
export async function purgeLeague(
  deps: PurgeDeps,
  leagueId: string,
): Promise<Result<PurgeReport, DomainError>> {
  if (!leagueId) {
    // A blank id reaching `deleteMany(model, { leagueId: '' })` matches nothing
    // and reports success. Harmless here, but the same shape with a `{}` where
    // clause deletes the table, so the guard is worth having at the door.
    return err(invariant('purge.leagueId', 'purgeLeague requires a leagueId.'))
  }

  const deleted: Array<{ model: string; rows: number }> = []

  for (const step of planLeaguePurge()) {
    const where = step.model === 'League' ? { id: leagueId } : { leagueId }
    deleted.push({ model: step.model, rows: await deps.deleteMany(step.model, where) })
  }

  return ok({ leagueId, deleted })
}

/**
 * The cutoff a row must be older than to be purgeable.
 *
 * Separate from the query so the arithmetic is testable and so a caller can log
 * the boundary it used — "purged everything before X" is answerable, where
 * "purged everything eligible" is not.
 */
export function purgeCutoff(kind: keyof typeof PURGE_RETENTION_DAYS, now: Date): Date {
  return new Date(now.getTime() - PURGE_RETENTION_DAYS[kind] * 24 * 60 * 60 * 1000)
}

/**
 * Eligibility for a tenant purge.
 *
 * ⚠ THERE IS NO LEAGUE EQUIVALENT, AND THAT IS A REAL GAP RATHER THAN AN
 * OMISSION. `Tenant` carries the four soft-delete columns (`deletedAt`,
 * `deletedBy`, `deleteReason`, `purgeAfter`) so "which tenants are purgeable"
 * is answerable. AllFantasy's `League` carries NONE of them — it cannot be
 * soft-deleted, so there is no state that means "deleted, waiting to be
 * purged", and no query can find one.
 *
 * So `purgeLeague` above is an EXPLICIT operation — someone or something names
 * the league — and league purge cannot yet be scheduled. Giving League the four
 * columns is the prerequisite, and it belongs with whoever owns that table.
 */
export function tenantPurgeFilter(now: Date): Record<string, unknown> {
  const cutoff = purgeCutoff('tenant', now)
  return {
    // Both, not either. `deletedAt` says it was deleted; `purgeAfter` is the
    // explicit hold an operator or a contract can extend. A purge that honoured
    // only the first would ignore a legal hold.
    deletedAt: { not: null, lte: cutoff },
    OR: [{ purgeAfter: null }, { purgeAfter: { lte: now } }],
  }
}

/**
 * A purge always names who ran it and why.
 *
 * The purge is the one path that destroys data, so an unattributed run is the
 * one audit gap that cannot be reconstructed afterwards from anything else.
 */
export function purgeAuditDraft(ctx: ActorContext, report: PurgeReport) {
  return {
    action: 'data.purgeLeague',
    resourceType: 'League',
    resourceId: report.leagueId,
    leagueId: report.leagueId,
    metadata: {
      deleted: report.deleted,
      actor: ctx.actorLabel,
    },
  }
}
