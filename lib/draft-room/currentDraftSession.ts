import type { Prisma } from '@prisma/client'

/**
 * Resolving "the draft session for this league" now that `DraftSession.leagueId` is no longer
 * globally unique.
 *
 * A league runs several drafts over its life — a startup, then a rookie draft each year, plus
 * dispersal and supplemental pools. `leagueId @unique` allowed exactly one, ever, which is what
 * blocked dynasty year two. Only one draft may be OPEN at a time, and that is enforced by a
 * partial unique index on `draft_sessions("leagueId") WHERE status <> 'completed'`.
 *
 * 🛑 `findUnique({ where: { leagueId } })` no longer type-checks. Every one of those reads meant
 * "the current draft for this league", so the replacement is
 * `findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })`.
 */

/**
 * Statuses a draft session holds while it is still open. `completed` is the only terminal one —
 * verified against every literal written to `draftSession.status` (2026-09-24). A draft is never
 * cancelled or archived; it is reopened by setting `pre_draft` again.
 */
export const OPEN_DRAFT_SESSION_STATUSES = [
  'pre_draft',
  'configuring',
  'configured',
  'in_progress',
  'paused',
] as const

/** The one terminal status. The partial unique index keys off this exact string. */
export const COMPLETED_DRAFT_SESSION_STATUS = 'completed'

/**
 * Newest first, with `id` breaking a `createdAt` tie so the row chosen is deterministic.
 *
 * Newest-first is the correct rule rather than a convenient one: a league's next draft is only
 * created once the previous has completed, so whenever an open draft exists it is also the
 * newest row. When none is open this yields the most recently completed draft, which is what
 * every post-draft read (results, grades, grounding, history) wants.
 */
export const CURRENT_DRAFT_SESSION_ORDER: Prisma.DraftSessionOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
]

/** True when the session is still open — i.e. not `completed`. */
export function isDraftSessionOpen(status: string | null | undefined): boolean {
  return status != null && status !== COMPLETED_DRAFT_SESSION_STATUS
}

/**
 * `where` fragment for "the league's OPEN draft, if it has one".
 *
 * Use this for anything that acts on a draft in flight — starting it, submitting a pick, running
 * the timer — so a league that has finished drafting is not mistaken for one mid-draft. Reads
 * that want the current draft whatever its state should use `CURRENT_DRAFT_SESSION_ORDER`.
 */
export function openDraftSessionWhere(leagueId: string): Prisma.DraftSessionWhereInput {
  return { leagueId, status: { not: COMPLETED_DRAFT_SESSION_STATUS } }
}
