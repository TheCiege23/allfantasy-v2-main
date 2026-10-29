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
import { NATIVE_PLATFORM_VALUES } from '@/lib/dashboard/platform-label'
import { prisma } from '@/lib/prisma'
import { engineSeasonScope, SCORING_SEASON_STATUSES } from '@/lib/redraft/seasonStatus'

export const WORKSPACE_REFRESH_JOB_TYPE = 'workspace.refreshTasks'

export interface DueWorkspaceLeague {
  leagueId: string
  idempotencyKey: string
  /**
   * Newest imported event for the league at discovery time — the staleness the scan will judge.
   * Null for a native league found only by the native path: it has no imported feed to be stale.
   */
  lastActivityAt: Date | null
  /** True when the native-in-season path found the league (it may also have imported rows). */
  native: boolean
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
 * Draft statuses that mean a native draft is happening NOW.
 *
 * ⚠ `pre_draft` IS DELIBERATELY ABSENT. It is the column's DEFAULT — every `DraftSession` is born in
 * it — so a league somebody created and abandoned sits in `pre_draft` forever. Admitting it would
 * fill the batch with dead leagues competing for the same `limit` as live ones. `in_progress` and
 * `paused` are states a draft only reaches once someone actually started it.
 */
export const ACTIVE_NATIVE_DRAFT_STATUSES: readonly string[] = ['in_progress', 'paused']

/**
 * Native AllFantasy leagues that are actively in season, or mid-draft.
 *
 * 🛑 WHY THIS PATH EXISTS: imported activity is written ONLY by the provider emitters (Sleeper,
 * ESPN, Yahoo, MFL, Fleaflicker — `lib/decision-os/ingestion/platformActivityEmitter.ts` and the
 * Sleeper ingest). A native league never has a `decision_os_imported_activity` row, so the imported
 * path alone could never reach one — a native NBA guillotine league in week 6 was simply not in
 * this job's universe.
 *
 * "Active native league" reuses the engines' own definition rather than inventing one:
 * `engineSeasonScope({ statuses: SCORING_SEASON_STATUSES })` is exactly what waiver-process runs
 * over — native platform values only, regular season OR playoffs, both status spellings. A league
 * mid-draft has no running season yet, so an `in_progress`/`paused` draft also qualifies.
 */
async function discoverActiveNativeLeagueIds(leagueId?: string): Promise<string[]> {
  const [seasons, drafts] = await Promise.all([
    prisma.redraftSeason.findMany({
      where: {
        AND: [engineSeasonScope({ statuses: SCORING_SEASON_STATUSES }), ...(leagueId ? [{ leagueId }] : [])],
      },
      select: { leagueId: true },
      orderBy: { leagueId: 'asc' },
    }),
    prisma.draftSession.findMany({
      where: {
        status: { in: [...ACTIVE_NATIVE_DRAFT_STATUSES] },
        league: { platform: { in: [...NATIVE_PLATFORM_VALUES] } },
        ...(leagueId ? { leagueId } : {}),
      },
      select: { leagueId: true },
      orderBy: { leagueId: 'asc' },
    }),
  ])
  return [...new Set([...seasons, ...drafts].map((row) => row.leagueId).filter(Boolean))]
}

/**
 * Leagues with imported activity, plus native leagues in season or mid-draft
 * (`discoverActiveNativeLeagueIds`), LEAST-RECENTLY-SCANNED FIRST.
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

  const [grouped, scans, nativeIds] = await Promise.all([
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
    discoverActiveNativeLeagueIds(options?.leagueId),
  ])

  const lastScanned = new Map<string, Date>()
  for (const row of scans) {
    if (row.leagueId && row._max.startedAt) lastScanned.set(row.leagueId, row._max.startedAt)
  }

  /*
   * One row per league, whichever path found it. A league found by BOTH keeps its imported
   * `lastActivityAt` — that is the staleness the scan judges — and is flagged native as well.
   */
  const byLeague = new Map<
    string,
    { leagueId: string; lastActivityAt: Date | null; lastScannedAt: Date | null; native: boolean }
  >()
  for (const row of grouped) {
    const leagueId = row.afLeagueId
    const lastActivityAt = row._max.occurredAt
    if (!leagueId || !lastActivityAt) continue
    byLeague.set(leagueId, {
      leagueId,
      lastActivityAt,
      lastScannedAt: lastScanned.get(leagueId) ?? null,
      native: false,
    })
  }
  for (const leagueId of nativeIds) {
    const existing = byLeague.get(leagueId)
    if (existing) {
      existing.native = true
      continue
    }
    byLeague.set(leagueId, {
      leagueId,
      lastActivityAt: null,
      lastScannedAt: lastScanned.get(leagueId) ?? null,
      native: true,
    })
  }
  const rows = [...byLeague.values()]

  rows.sort((a, b) => {
    // Never scanned goes first — a league the queue has not reached yet is showing its users an
    // error, which outranks re-checking one we already have an answer for.
    if (a.lastScannedAt === null && b.lastScannedAt !== null) return -1
    if (b.lastScannedAt === null && a.lastScannedAt !== null) return 1
    if (a.lastScannedAt && b.lastScannedAt) {
      const byScan = a.lastScannedAt.getTime() - b.lastScannedAt.getTime()
      if (byScan !== 0) return byScan
    }
    /*
     * Among equally-overdue leagues, stalest imported data first. A league with no imported feed
     * (native-only) has no staleness to be urgent about, so it follows those that do. It is still
     * reached: being scanned is what sends the others to the back.
     */
    if (a.lastActivityAt && b.lastActivityAt) {
      const byActivity = a.lastActivityAt.getTime() - b.lastActivityAt.getTime()
      if (byActivity !== 0) return byActivity
    } else if (a.lastActivityAt) {
      return -1
    } else if (b.lastActivityAt) {
      return 1
    }
    /*
     * ⚠ FINAL TIE-BREAK ON THE ID, SO THE ORDER IS A FUNCTION OF THE DATA AND NOT OF THE QUERY
     * PLAN. Without it equal keys keep whatever order Postgres returned the rows in — the same
     * shape as the waiver job's old `take: 20` with no `orderBy`, which starved seasons.
     */
    return a.leagueId < b.leagueId ? -1 : a.leagueId > b.leagueId ? 1 : 0
  })

  return rows.slice(0, limit).map((row) => ({
    leagueId: row.leagueId,
    lastActivityAt: row.lastActivityAt,
    lastScannedAt: row.lastScannedAt,
    native: row.native,
    scheduledFor: now,
    idempotencyKey: buildWorkspaceRefreshIdempotencyKey(row.leagueId, now),
  }))
}
