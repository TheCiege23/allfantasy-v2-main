/**
 * Fantasy OS Phase 5H-e — non-production migration safety guard (pure; no DB, no secret).
 *
 * Every migration/backfill executor MUST call `assertApprovedNonProdTarget` before touching a database. It FAILS
 * CLOSED unless the target is positively identified as the ONE approved non-production project, the expected safety
 * marker is present, and nothing about the target looks like production. It never receives or logs a connection
 * string or credential — only structural identifiers the caller has already resolved.
 */

export const APPROVED_NONPROD_PROJECT_ID = 'cool-lab-87438174'
export const APPROVED_NONPROD_PROJECT_NAME = 'decision-os-phaseA-verify'
export const NONPROD_SAFETY_MARKER = 'FANTASY_OS_NONPROD_APPROVED'

export type NonProdTarget = {
  projectId: string | null | undefined
  projectName: string | null | undefined
  /** True only if a SELECT confirmed the marker row exists in the target DB. */
  markerPresent: boolean
  /** Any signal the caller has that the target is production (e.g. a *_PROD env, prod host). */
  looksLikeProduction?: boolean
}

export type GuardResult = { ok: true } | { ok: false; reason: string }

/** Pure check — returns ok/false with a reason. Never throws; use `assertApprovedNonProdTarget` to throw. */
export function checkApprovedNonProdTarget(t: NonProdTarget): GuardResult {
  if (t.looksLikeProduction) return { ok: false, reason: 'target appears to be production' }
  if (!t.projectId || String(t.projectId) !== APPROVED_NONPROD_PROJECT_ID) return { ok: false, reason: `project id is not the approved non-production project (${APPROVED_NONPROD_PROJECT_ID})` }
  if (!t.projectName || String(t.projectName) !== APPROVED_NONPROD_PROJECT_NAME) return { ok: false, reason: `project name is not "${APPROVED_NONPROD_PROJECT_NAME}"` }
  if (!t.markerPresent) return { ok: false, reason: `non-production safety marker "${NONPROD_SAFETY_MARKER}" is absent` }
  return { ok: true }
}

/** Throwing wrapper for executors — FAILS CLOSED on any uncertainty. */
export function assertApprovedNonProdTarget(t: NonProdTarget): void {
  const r = checkApprovedNonProdTarget(t)
  if (!r.ok) throw new Error(`[nonprod-safety-guard] refusing to run migration/backfill: ${r.reason}`)
}
