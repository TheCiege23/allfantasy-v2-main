/**
 * Telling a scheduled job apart from a person, at the one boundary where it matters.
 *
 * 🛑 A SYNTHETIC ACTOR WRITTEN TO `audit_logs.userId` VIOLATES A FOREIGN KEY AND
 * TAKES THE WHOLE TRANSACTION WITH IT. That column is `String?` with an
 * `AppUser?` relation — nullable precisely so a non-user action can be recorded
 * — but a non-null value must be a real `AppUser.id`. Passing a label like
 * `system:week-roller` is neither.
 *
 * Measured 2026-09-07, against a real database, in the first end-to-end season
 * run this repo has ever done: the scheduled postseason roller crowned a
 * champion and then `enterRedraftOffseason` died on
 * `audit_logs_userId_fkey`. The league was left at `completed` with no
 * `LeagueSeason` archive, no `FranchiseSeason` rows and no offseason — and the
 * failure was swallowed and logged, because the archive step is deliberately
 * non-fatal so a crowned champion is never lost to it.
 *
 * ⚠ NO UNIT TEST COULD HAVE CAUGHT IT. Every suite that covers this path mocks
 * Prisma, and a mock has no foreign keys. The bug is invisible until a real
 * database refuses the write, which is the entire argument for the e2e run that
 * found it.
 *
 * ⚠ AND THE ACTOR STRING IS STILL WORTH KEEPING EVERYWHERE ELSE. Event payloads
 * and metadata are JSON, not FK-constrained, so they should carry
 * `system:week-roller` verbatim — that is more informative than a null and is
 * how an operator tells an automated transition from a commissioner's click.
 * Only the FK column is narrowed.
 */

export const SYSTEM_ACTOR_PREFIX = 'system:'

/** The convention: an actor id that names a job rather than a person. */
export function isSystemActor(actor: string | null | undefined): boolean {
  return typeof actor === 'string' && actor.startsWith(SYSTEM_ACTOR_PREFIX)
}

/**
 * The value safe to store in an FK-constrained `userId` column.
 *
 * Returns null for a system actor — which is what the nullable column means —
 * and passes a real user id through untouched.
 */
export function auditUserId(actor: string | null | undefined): string | null {
  if (!actor) return null
  return isSystemActor(actor) ? null : actor
}
