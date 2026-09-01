import { NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { createRunBudget } from "@/lib/cron/runBudget"
import { mergeRotation } from "@/lib/league-import/rotationPolicy"
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
 * ── ⚠ COVERAGE, WITH THE ARITHMETIC RATHER THAN A CLAIM ─────────────────────────────────────
 *
 * Every 4 hours: 6 fires x <=25 leagues = 150 a day. Measured on production, the rotation holds
 * 199 Sleeper leagues, so it laps in roughly 1.3 days.
 *
 * 🛑 AN EARLIER VERSION OF THIS HEADER SAID "a 543-league account laps in roughly eleven days".
 * That was wrong in a way worth keeping: 543 is one owner's Sleeper import HISTORY count from the
 * grounding packet, not the rotation. The rotation is leagues carrying a DynastyBackfillStatus
 * row — 199. Two plausible numbers for "how many leagues", and only one of them governs this job.
 *
 * ⚠ AND THE LAP GROWS LINEARLY WITH SIGNUPS, WHICH IS THE PART FREQUENCY CANNOT FIX.
 * lap = leagues / (LEAGUE_CAP * fires per day). The denominator is fixed; the numerator is the
 * user base. At 150/day: 1.3 days at 199 leagues, 3.3 at 500, 6.7 at 1000. Hourly is the
 * practical ceiling (300s per fire) at 600/day and holds ~3 days out to about 2000. So frequency
 * buys one order of magnitude and then stops — which is why the ordering below exists, and why
 * making each league cheaper matters more than firing more often.
 *
 * Bounds: two-bucket ordering (see `mergeRotation`), <=25 leagues a fire, 240s budget checked
 * BETWEEN leagues, per-league failure isolation, `SyncJobRun` telemetry.
 *
 * ⚠ ONE NUMBER HERE IS ARITHMETIC, NOT MEASUREMENT. LEAGUE_CAP assumes ~9.6s per league against
 * the budget. If a league takes 20s, twelve complete per fire and every figure above doubles.
 * `leaguesRefreshed`, `skippedForTime` and `elapsedMs` are returned so the cap can be tuned from
 * a real run instead of from this paragraph.
 */

/** Leagues per fire. Ordering is decided by `mergeRotation`, not by this constant. */
const LEAGUE_CAP = 25

/**
 * 240s against the 300s platform ceiling, matching `CRON_RUN_BUDGET_MS`.
 *
 * ⚠ Checked BETWEEN leagues, never during one. A league started at 239s runs to completion past
 * the check — which is the point of the 60s of headroom, not padding.
 */
const REFRESH_BUDGET_MS = 240_000

/**
 * A league not refreshed within this window is STARVED and gets a reserved slot regardless of
 * whether anyone has opened it.
 *
 * Seven days is deliberately generous against a ~1.3-day lap: it should catch leagues the demand
 * ordering is genuinely neglecting, not fire for every league on a normal rotation. If the tail
 * routinely trips it, the cap or the frequency is wrong — not this number.
 */
const STARVATION_FLOOR_MS = 7 * 24 * 60 * 60_000

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
       * No stored cursor is needed in either bucket. `runDynastyBackfill` upserts the status row
       * at the START of every run, so refreshing a league is what makes it least stale, and the
       * ordering maintains itself.
       *
       * ── TWO BUCKETS: THE TAIL, AND THE LEAGUES PEOPLE ARE ACTUALLY LOOKING AT ─────────────
       *
       * Pure staleness ordering is fair in the only unit it can measure and wrong in the one
       * that matters — a league nobody has opened since June outranks the one its owner has
       * open right now. Pure demand ordering is worse: it would refresh the same few active
       * leagues forever and never reach the tail, and a drifting tail is invisible precisely
       * because nobody is looking at it.
       *
       * `mergeRotation` reserves a floor of slots for the starved bucket, gives the rest to
       * demand, and lets either donate unused slots to the other. See lib/league-import/
       * rotationPolicy.ts.
       */
      const starvedBefore = new Date(Date.now() - STARVATION_FLOOR_MS)
      const [starvedRows, demandRows] = await Promise.all([
        prisma.dynastyBackfillStatus.findMany({
          where: { provider: "sleeper", updatedAt: { lt: starvedBefore } },
          orderBy: { updatedAt: "asc" },
          take: LEAGUE_CAP,
          select: { leagueId: true, updatedAt: true },
        }),
        /*
         * ⚠ `lastViewedAt: { not: null }` IS LOAD-BEARING, NOT TIDINESS. Postgres sorts NULLs
         * FIRST on DESC by default, so without it every never-viewed league would rank ahead of
         * every viewed one — the exact inversion of what this bucket is for, and it would look
         * like the ordering was simply not working rather than working backwards.
         */
        prisma.league.findMany({
          where: { platform: "sleeper", platformLeagueId: { not: "" }, lastViewedAt: { not: null } },
          orderBy: { lastViewedAt: "desc" },
          take: LEAGUE_CAP,
          select: { id: true },
        }),
      ])

      const rotation = mergeRotation({
        starvedLeagueIds: starvedRows.map((r) => r.leagueId),
        demandLeagueIds: demandRows.map((r) => r.id),
        cap: LEAGUE_CAP,
      })

      /*
       * If NOTHING is starved and nothing has been viewed, fall back to the plain staleness
       * walk — otherwise a healthy, quiet system would do no work at all and the rotation would
       * silently stop rather than idle.
       */
      const stale =
        rotation.leagueIds.length > 0
          ? rotation.leagueIds.map((id) => ({ leagueId: id, updatedAt: null as Date | null }))
          : await prisma.dynastyBackfillStatus.findMany({
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
