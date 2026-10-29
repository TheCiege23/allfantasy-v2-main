/**
 * GET/POST /api/cron/sports-alerts
 *
 * Real-world sports alerts (2026-10-15), every two minutes on the fast tier (an operational overlay
 * in scripts/cron-fast-tier-loop.mjs — cron-schedule.json is at its ceiling). Two phases, each
 * isolated so one failing cannot stop the other:
 *
 *   1. LIVE GAME MOMENTS (lib/live/gameMomentAlerts.ts) — close finishes, overtime, halftime, the
 *      7th inning, end of a hockey period, finals, across all seven sports. First, because a live
 *      moment is worthless a few minutes late and a news story is not.
 *   2. BREAKING NEWS (lib/news/breakingNewsAlerts.ts) — trades, signings, firings, suspensions and
 *      season-ending injuries from trusted outlets. ESPN headlines are refreshed into `sports_news`
 *      on every other tick (a 4-minute news cadence), then alerts are sent from the database.
 *
 * Provider calls happen only in the ingestion steps (the ESPN scoreboard read-through and the ESPN
 * news refresh) — the DB-first rule's sanctioned place for them.
 *
 * ⚠ NOT A PHASE OF /api/cron/import-news. That job carries the NewsAPI pass and the player-news
 * normaliser, and has run long enough to be stale for days (see scripts/cron-fast-tier-loop.mjs). A
 * trade reported at 4:02 must not wait behind it.
 *
 * Query params:
 *   only=news|moments  — run one phase.
 *   dryRun=1           — list the breaking stories that WOULD be sent; no ESPN calls, no alerts,
 *                        no heartbeat. (Live moments have no dry run: detection needs a live feed.)
 *   refresh=0|1        — force the ESPN news refresh off or on for this run.
 */
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { createRunBudget } from "@/lib/cron/runBudget"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

export const dynamic = "force-dynamic"
export const maxDuration = 120

/** Heartbeat identity in `sync_job_runs`. Must stay in step with PROBES in scripts/cron-freshness-check.mjs. */
const JOB = "cron-sports-alerts"

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const only = url.searchParams.get("only")
  const dryRun = url.searchParams.get("dryRun") === "1"
  const refreshParam = url.searchParams.get("refresh")
  const startedAt = Date.now()
  // Inside the 120s maxDuration, with room for the response.
  const budget = createRunBudget(95_000)

  try {
    if (dryRun) {
      const { findBreakingCandidates } = await import("@/lib/news/breakingNewsAlerts")
      const candidates = await findBreakingCandidates()
      return NextResponse.json({
        ok: true,
        dryRun: true,
        candidates: candidates.map((c) => ({
          sport: c.row.sport,
          title: c.row.title,
          source: c.outlet.name,
          ...c.classification,
          teams: c.teams,
          storyKey: c.storyKey,
        })),
        durationMs: Date.now() - startedAt,
      })
    }

    /*
     * ⚠ LIVE MOMENTS ARE OFF BY DEFAULT SINCE 2026-10-22. Halftime, period ends, close games,
     * overtime and finals are sent by lib/engagement-alerts (the minute-by-minute game engine), which
     * already sent most of them — so people got two pushes per moment. Run it explicitly with
     * `only=moments`, or set AF_LEGACY_GAME_ALERTS=1 to restore it on every tick.
     */
    const runMoments = only === "moments" || (only !== "news" && process.env.AF_LEGACY_GAME_ALERTS === "1")
    const runNews = only !== "moments"
    // Every other two-minute tick, unless forced either way.
    const refreshNews =
      refreshParam === "1" ? true : refreshParam === "0" ? false : Math.floor(Date.now() / 120_000) % 2 === 0

    const result = await withSyncJobRun(
      { jobName: JOB, trigger: "cron" },
      async () => {
        const errors: string[] = []
        let moments: unknown = null
        if (runMoments) {
          try {
            const { dispatchGameMomentAlerts } = await import("@/lib/live/gameMomentAlerts")
            moments = await dispatchGameMomentAlerts({ budget })
          } catch (err) {
            errors.push(`moments: ${err instanceof Error ? err.message : String(err)}`)
          }
        }

        let news: { fetched: number | null; sent: number; candidates: number; alreadySent: number } & Record<string, unknown> = {
          fetched: null,
          sent: 0,
          candidates: 0,
          alreadySent: 0,
        }
        if (runNews && !budget.exhausted()) {
          if (refreshNews) {
            try {
              const { syncEspnNewsOnly } = await import("@/app/api/sports/news/sync-helper")
              news.fetched = (await syncEspnNewsOnly()).total
            } catch (err) {
              // A failed refresh still dispatches what is stored.
              errors.push(`news refresh: ${err instanceof Error ? err.message : String(err)}`)
            }
          }
          try {
            const { dispatchBreakingNewsAlerts } = await import("@/lib/news/breakingNewsAlerts")
            news = { ...news, ...(await dispatchBreakingNewsAlerts({ budget })) }
          } catch (err) {
            errors.push(`news: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        return { moments, news, errors }
      },
      (r) => ({
        rowsRead: r.news.candidates,
        rowsWritten: r.news.sent,
        rowsSkipped: r.news.alreadySent,
        status: r.errors.length > 0 ? ("partial" as const) : ("success" as const),
      }),
    )

    return NextResponse.json({
      ok: result.errors.length === 0,
      ...result,
      budget: { exhausted: budget.exhausted(), elapsedMs: budget.elapsedMs() },
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/sports-alerts] failed:", message)
    return NextResponse.json({ ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return handle(req)
}
