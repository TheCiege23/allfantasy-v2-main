import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { createRunBudget } from "@/lib/cron/runBudget"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * GET /api/cron/sleeper-historical-refresh
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (same pattern as the other decision-os crons).
 *
 * ── 🛑 STEP 1c: THE ORCHESTRATOR EXISTED AND NOTHING EVER RAN IT AGAIN ───────────────────────
 *
 * `syncSleeperHistoricalBackfillAfterImport` had exactly two callers: the import itself, and a
 * commissioner-only manual retry route with `cron: 0`. So a league imported in March held March's
 * history and nothing since — drafts, matchups, season state and (as of today) transactions all
 * frozen at the moment of import.
 *
 * ⚠ THIS COULD NOT HAVE BEEN SCHEDULED BEFORE THE GATES WERE FIXED, AND SCHEDULING IT WOULD HAVE
 * BEEN WORSE THAN LEAVING IT ALONE. Every sibling's completion gate used to test whether ROWS
 * EXISTED rather than whether the season was OVER. On a timer that converts "stale after import"
 * into "confidently reports the live season as finished, forever, on a schedule". Four gates were
 * repaired first; the fifth — `lib/dynasty-import/backfill-orchestrator.ts` — was found while
 * writing this route and repaired in the same change, because it is the one this cron would have
 * driven hardest.
 *
 * ── ⚠ WHAT THIS DELIBERATELY DOES NOT SOLVE ─────────────────────────────────────────────────
 *
 * Transactions for a given league are now fetched by up to three paths: this orchestrator (via
 * both the new transaction sibling AND `runDynastyBackfill`, which loops weeks of its own), and
 * `decision-os-activity-ingest`, which already pulls 18 transaction weeks daily for ≤40 leagues
 * into a DIFFERENT table (`DecisionOsImportedActivity`, not `TransactionFact`). With the gates
 * working each path only touches the season still being played, so the duplication is bounded —
 * but it is real, it is not free, and it is recorded here rather than discovered later. Collapsing
 * it means giving the orchestrator one fetch to share, which is a refactor and not this change.
 *
 * ── ⚠ COVERAGE IS HONEST AND IT IS NOT "FRESH" YET ──────────────────────────────────────────
 *
 * Twice a day, budget-bounded. That cadence is the user's standing instruction for system-side
 * refreshes, and it is kept deliberately rather than quietly raised. The arithmetic that follows
 * from it should be read before anyone calls this solved: at ~25 leagues a fire and two fires a
 * day, a 543-league account laps in roughly eleven days. That is a large improvement on the
 * ~45-day trade rotation it supplements and it is still not "up to date". Raising the frequency
 * is a one-line change to `cron-schedule.json`; raising it silently is not this route's call.
 *
 * Bounds: staleness-ordered (oldest `DynastyBackfillStatus.updatedAt` first), ≤25 leagues a fire,
 * 240s budget checked BETWEEN leagues, per-league failure isolation, `SyncJobRun` telemetry.
 */

/** Oldest-refreshed first, so successive fires cover everything without a stored cursor. */
const LEAGUE_CAP = 25

/**
 * 240s against the 300s platform ceiling, matching `CRON_RUN_BUDGET_MS`.
 *
 * ⚠ Checked BETWEEN leagues, never during one. A league started at 239s runs to completion past
 * the check — which is the point of the 60s of headroom, not padding.
 */
const REFRESH_BUDGET_MS = 240_000

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get("authorization")
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null
  return Boolean(bearer && bearer === secret)
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const summary = await withSyncJobRun(
    { jobName: "cron-sleeper-historical-refresh", provider: "sleeper", trigger: "cron" },
    async () => {
      const budget = createRunBudget(REFRESH_BUDGET_MS)

      /*
       * Staleness ordering rather than a stored cursor. `runDynastyBackfill` upserts this row at
       * the START of every run, so `updatedAt` is touched by the act of refreshing and the
       * ordering maintains itself — and coverage is complete, because every imported Sleeper
       * league ran the orchestrator once at import and therefore has a row.
       */
      const stale = await prisma.dynastyBackfillStatus.findMany({
        where: { provider: "sleeper" },
        orderBy: { updatedAt: "asc" },
        take: LEAGUE_CAP,
        select: { leagueId: true, updatedAt: true },
      })

      if (stale.length === 0) {
        return {
          status: "success" as const,
          rowsRead: 0,
          rowsWritten: 0,
          leaguesConsidered: 0,
          leaguesRefreshed: 0,
          leaguesFailed: 0,
          skippedForTime: 0,
          metadata: { note: "No Sleeper leagues carry a backfill status row yet." },
        }
      }

      const leagues = await prisma.league.findMany({
        where: {
          id: { in: stale.map((s) => s.leagueId) },
          platform: "sleeper",
          // `platformLeagueId` is a non-nullable String, so the empty string is the "unset"
          // value here — `{ not: null }` does not typecheck. Same filter the activity-ingest
          // cron uses on the same column.
          platformLeagueId: { not: "" },
        },
        select: { id: true, isDynasty: true },
      })

      /*
       * ⚠ `findMany({ id: { in } })` DOES NOT PRESERVE THE ORDER OF THE `in` LIST. Reordering by
       * the staleness query is what keeps this a rotation; without it the run would iterate in
       * whatever order Postgres returned and the tail could starve while the budget looks fine.
       */
      const byId = new Map(leagues.map((l) => [l.id, l]))
      const ordered = stale.map((s) => byId.get(s.leagueId)).filter((l): l is NonNullable<typeof l> => Boolean(l))

      const { syncSleeperHistoricalBackfillAfterImport } = await import(
        "@/lib/league-import/sleeper/SleeperHistoricalBackfillService"
      )

      let leaguesRefreshed = 0
      let leaguesFailed = 0
      let skippedForTime = 0
      const errors: string[] = []

      for (const league of ordered) {
        if (budget.exhausted()) {
          skippedForTime += 1
          continue
        }
        try {
          await syncSleeperHistoricalBackfillAfterImport({
            leagueId: league.id,
            isDynasty: Boolean(league.isDynasty),
            /*
             * NEVER force from a timer. `force` here means "refetch seasons we already hold",
             * and on a schedule that is precisely the vendor load the completion gates exist to
             * avoid. A human repairing one league passes it from the retry route.
             */
          })
          leaguesRefreshed += 1
        } catch (e) {
          // Per-league isolation: one bad league must not end the rotation for the rest.
          leaguesFailed += 1
          if (errors.length < 5) {
            errors.push(`${league.id}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      }

      return {
        status: leaguesFailed > 0 ? ("partial" as const) : ("success" as const),
        rowsRead: ordered.length,
        rowsWritten: leaguesRefreshed,
        leaguesConsidered: ordered.length,
        leaguesRefreshed,
        leaguesFailed,
        skippedForTime,
        errors,
        oldestRefreshedAt: stale[0]?.updatedAt?.toISOString() ?? null,
        elapsedMs: budget.elapsedMs(),
        metadata: {
          leagueCap: LEAGUE_CAP,
          budgetMs: REFRESH_BUDGET_MS,
          remainingMs: budget.remainingMs(),
        },
      }
    },
    (result) => ({
      status: result.status,
      rowsRead: result.rowsRead,
      rowsWritten: result.rowsWritten,
      rowsSkipped: result.skippedForTime,
      errors: "errors" in result ? result.errors : undefined,
      metadata: result.metadata,
    }),
  )

  return NextResponse.json({ ok: true, ...summary })
}
