/**
 * Which leagues the `workspace.refreshTasks` job should scan.
 *
 * ── WHY THIS JOB EXISTS: THE ENGINE WAS IDLE, NOT BROKEN ─────────────────────────────────────
 *
 * Measured on production 2026-09-08. `automation_runs` held 251 rows, all of one job type, all
 * for one seed league, the newest dated 2026-06-21 — 249 of them `skipped` with
 * `reason: idempotency_completed`:
 *
 *     waivers.processLeague  skipped    249   newest 2026-06-21T03:55:02Z
 *     waivers.processLeague  completed    2   newest 2026-06-21T04:00:02Z
 *
 * The engine, the audit trail and the idempotency guard were all working correctly. The problem
 * was upstream of them: `discoverDueWaiverLeagues` finds work by grouping `WaiverClaim` rows with
 * `status = 'pending'`, and that table is EMPTY platform-wide, because every league on the
 * platform is an import and an imported league never writes AF-native waiver claims. The one
 * wired job was pointed at a queue that is empty by construction, so the engine correctly had
 * nothing to do and correctly did nothing.
 *
 * 🛑 SO THE FIX IS NOT TO REPAIR THE ENGINE. It is to give it a job with real work on the leagues
 * that actually exist. Measured the same day: 119 leagues have imported activity, and 44 of them
 * are past `MANAGER_INACTIVE_AFTER_DAYS` — the threshold that flips every manager inactive and
 * makes the whole commissioner surface read "your league is dead". That is a real backlog on the
 * first run, not a queue waiting for a feature nobody uses yet.
 *
 * ⚠ AND IT IS A STANDING QUEUE, NOT A ONE-OFF BACKLOG. Freshness decays continuously, so leagues
 * enter and leave this set on their own. That is what keeps the engine non-dormant after the
 * first pass, and it is the property the waiver job never had.
 */

import { buildIdempotencyKey, hashIdempotencyKey } from '@/lib/automation/idempotency'
import { prisma } from '@/lib/prisma'

export const WORKSPACE_REFRESH_JOB_TYPE = 'workspace.refreshTasks'

export interface DueWorkspaceLeague {
  leagueId: string
  idempotencyKey: string
  /** Newest imported event for the league at discovery time — the staleness the scan will judge. */
  lastActivityAt: Date
  /** When this league was last scanned, or null if it never has been. Null sorts to the front. */
  lastScannedAt: Date | null
  scheduledFor: Date
}

export interface DiscoverWorkspaceRefreshOptions {
  limit?: number
  now?: Date
  leagueId?: string
}

function utcDateBucket(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * One scan per league per UTC day.
 *
 * The daily bucket is deliberate and matches the waiver job's. A task list changes on the scale of
 * days, so scanning more often would spend queries to rewrite `lastSeenAt` and nothing else — and
 * a second dispatch on the same day is a cheap `skipped` row rather than duplicated work, which is
 * exactly how the idempotency guard is meant to be used.
 */
export function buildWorkspaceRefreshIdempotencyKey(leagueId: string, scheduledFor: Date): string {
  return hashIdempotencyKey(
    buildIdempotencyKey([WORKSPACE_REFRESH_JOB_TYPE, leagueId, utcDateBucket(scheduledFor)]),
  )
}

/**
 * Leagues with imported activity, LEAST-RECENTLY-SCANNED FIRST.
 *
 * ⚠ EVERY LEAGUE IS IN SCOPE, NOT ONLY THE STALE ONES. A league whose feed recovered still needs
 * a scan — that is the run which CLOSES its stale-data task — so filtering to "currently stale"
 * would leave resolved tasks open forever and make the queue grow monotonically.
 *
 * 🛑 AND THAT IS EXACTLY WHY THE ORDER IS NOT "STALEST FIRST", WHICH IS WHAT THIS FUNCTION DID
 * FIRST AND WAS WRONG. Ordering by data staleness under a `limit` is a starvation bug wearing the
 * costume of a priority queue: the stalest N leagues sort to the front every single day, so they
 * are the only ones ever scanned, and a healthy league is never reached at all. Its findings never
 * auto-resolve, and `hasEverBeenScanned` stays false for it forever — so the Workspace page shows
 * that league the "not scanned yet" error permanently. The bug is invisible in any test with fewer
 * leagues than the limit, and invisible in production because the leagues it starves are the ones
 * with nothing to report.
 *
 * Rotating on last scan is what guarantees coverage: every league reaches the front eventually,
 * because being scanned is what sends it to the back. Staleness is only the tie-break among
 * leagues that are equally overdue — so the most urgent work still leads within any given batch.
 *
 * `afLeagueId` is non-null on every row in production (22,264 of 22,264, measured 2026-09-08), so
 * grouping on it loses nothing. It is typed nullable, and the filter below is what makes that
 * measurement a precondition rather than an assumption.
 */
export async function discoverWorkspaceRefreshLeagues(
  options?: DiscoverWorkspaceRefreshOptions,
): Promise<DueWorkspaceLeague[]> {
  const limit = options?.limit ?? 25
  const now = options?.now ?? new Date()

  const [grouped, scans] = await Promise.all([
    prisma.decisionOsImportedActivity.groupBy({
      by: ['afLeagueId'],
      where: { afLeagueId: options?.leagueId ? options.leagueId : { not: null } },
      _max: { occurredAt: true },
    }),
    prisma.automationRun.groupBy({
      by: ['leagueId'],
      where: { jobType: WORKSPACE_REFRESH_JOB_TYPE, leagueId: { not: null } },
      _max: { startedAt: true },
    }),
  ])

  const lastScanned = new Map<string, Date>()
  for (const row of scans) {
    if (row.leagueId && row._max.startedAt) lastScanned.set(row.leagueId, row._max.startedAt)
  }

  const rows = grouped.flatMap((row) => {
    const leagueId = row.afLeagueId
    const lastActivityAt = row._max.occurredAt
    if (!leagueId || !lastActivityAt) return []
    return [{ leagueId, lastActivityAt, lastScannedAt: lastScanned.get(leagueId) ?? null }]
  })

  rows.sort((a, b) => {
    // Never scanned goes first — a league the queue has not reached yet is showing its users an
    // error, which outranks re-checking one we already have an answer for.
    if (a.lastScannedAt === null && b.lastScannedAt !== null) return -1
    if (b.lastScannedAt === null && a.lastScannedAt !== null) return 1
    if (a.lastScannedAt && b.lastScannedAt) {
      const byScan = a.lastScannedAt.getTime() - b.lastScannedAt.getTime()
      if (byScan !== 0) return byScan
    }
    return a.lastActivityAt.getTime() - b.lastActivityAt.getTime()
  })

  return rows.slice(0, limit).map((row) => ({
    leagueId: row.leagueId,
    lastActivityAt: row.lastActivityAt,
    lastScannedAt: row.lastScannedAt,
    scheduledFor: now,
    idempotencyKey: buildWorkspaceRefreshIdempotencyKey(row.leagueId, now),
  }))
}
