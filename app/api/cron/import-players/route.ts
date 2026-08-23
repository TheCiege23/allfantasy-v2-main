/**
 * GET/POST /api/cron/import-players
 *
 * Vercel Cron schedule: every 6 hours (see vercel.json).
 * Calls runSportsDataImporter to build/refresh SportsPlayerRecord rows with
 * enriched stats, projections, ADP, injury status, and news for all supported sports.
 *
 * Optional query params:
 *   sport  — comma-separated sport codes to limit scope (e.g. "NFL,NBA")
 *   dryRun — "true" to skip DB writes (returns projected row count only)
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { refreshStaleLeagueProfiles } from '@/lib/psychological-profiles/ProfileRefreshService'
import { prisma } from "@/lib/prisma"
import { toPrismaJsonInput } from "@/lib/prisma-json"
import { runSportsDataImporter } from "@/lib/workers/sports-data-importer"
import { createRunBudget } from "@/lib/cron/runBudget"

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 300

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sportParam = url.searchParams.get("sport")
  const dryRun = url.searchParams.get("dryRun") === "true"
  const seedPageSizeParam = Number(url.searchParams.get("seedPageSize"))

  const sports = sportParam
    ? sportParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : undefined

  const startedAt = Date.now()
  /*
   * ⚠ THE IMPORTER ALREADY SELF-BUDGETS AT 240s; THIS BUDGETS EVERYTHING AFTER IT.
   *
   * Measured 2026-08-23: this route returned HTTP 502 at ~300,262ms. The platform edge cuts
   * the connection at 300s and answers 502 itself, so neither maxDuration nor a client
   * timeout buys more room.
   *
   * `sports-data-importer` stops politely at IMPORT_BUDGET_MS (240s) — and then three more
   * phases run ON TOP of that: identity repair/backfill, devy enrichment, and psych profile
   * refresh. Each is capped by COUNT, not by time, so the handler routinely overshoots the
   * ceiling even though its biggest phase behaved. A budget bolted onto the sport loop would
   * have changed nothing; the budget has to span the whole handler.
   *
   * Deferring a maintenance phase is cheap: each drains oldest-first and resumes next run.
   * Losing the entire response to a 502 is not — that is when nothing gets recorded at all.
   */
  const budget = createRunBudget()
  const deferredPhases: string[] = []

  try {
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        sports: sports ?? "all",
        message: "Dry run — no DB writes performed (identity sync also skipped).",
        durationMs: Date.now() - startedAt,
      })
    }

    const result = await runSportsDataImporter({
      sports,
      ...(Number.isFinite(seedPageSizeParam) && seedPageSizeParam > 0 ? { seedPageSize: seedPageSizeParam } : {}),
    })

    // Durable run record: admin production-health (?view=warehouse) reads teamCodeCounts from
    // here to flag truncated_fallback growth, and the NEXT run reads seedCursors from here to
    // resume the paged college source read where this one stopped (no rescanning).
    await prisma.syncJobRun.create({
      data: {
        jobName: "import-players",
        jobScope: result.sports.join(","),
        trigger: "cron",
        status: "completed",
        rowsWritten: result.imported,
        rowsSkipped: result.rowsSkippedByGuard,
        completedAt: new Date(),
        durationMs: result.durationMs,
        metadata: toPrismaJsonInput({
          teamCodeCounts: result.teamCodeCounts,
          skippedSports: result.skippedSports,
          staleFallbackApplied: result.staleFallbackApplied,
          pagedSeeds: result.pagedSeeds,
          seedCursors: result.seedCursors,
        }),
      },
    }).catch((telemetryError) => {
      console.error("[cron/import-players] telemetry write failed:", telemetryError)
    })

    // --- identity maintenance -------------------------------------------------------
    // Folded in here rather than left as one-shot scripts, because both degrade silently.
    // New players entering the league arrive unmapped, and an unmapped player falls back to
    // a weaker projection basis with lower confidence. A wrong mapping is worse still: the
    // sleeperId is how weekly stats and projections are fetched, so a bad bind attaches one
    // player's entire production history to another. A one-off run measured 77 such binds
    // already in the data (Jahmyr Gibbs -> Bill Murray, Lamar Jackson -> Cre'Von LeBlanc).
    //
    // Both are NON-FATAL: player import is the job here, and identity upkeep must never fail
    // the run that populated the roster. Both are additionally sport-gated to NFL, which is
    // the only sport the identity map covers.
    let identity: Record<string, unknown> | null = null
    const wantsNfl = !sports || sports.includes('NFL')
    // Single evaluation, if/else. Two separate `budget.exhausted()` checks could disagree if the
    // clock crossed the threshold between them, and the phase would then appear in NEITHER the
    // result nor deferredPhases — silently vanishing, which is the failure mode this whole change
    // exists to stop.
    if (wantsNfl && budget.exhausted()) {
      deferredPhases.push('identity')
    } else if (wantsNfl) {
      try {
        const { backfillSleeperIds, repairSleeperIds } = await import('@/lib/player-match/sleeperIdentitySync')
        // Repair BEFORE backfill: repair only inspects rows that already carry an id, and
        // running it first means the backfill's uniqueness guard sees the corrected set.
        const repaired = await repairSleeperIds({ sport: 'NFL' })
        const filled = await backfillSleeperIds({ sport: 'NFL' })
        identity = {
          repairChecked: repaired.checked,
          repaired: repaired.repaired,
          leftForReview: repaired.leftForReview,
          newlyMapped: filled.written,
          coverage: filled.coverageAfter,
        }
      } catch (identityError) {
        const message = identityError instanceof Error ? identityError.message : String(identityError)
        console.error('[cron/import-players] identity sync failed:', message)
        identity = { error: message.slice(0, 200) }
      }
    }

    // Devy intel metrics ride along here because this is a built, scheduled
    // player-data cron. The natural home, /api/devy/automation, is excluded
    // from the production build by scripts/vercel-next-build.cjs (route budget)
    // and would 404 forever.
    //
    // Bounded and draining oldest-enriched-first: ~1,700 devy players take about
    // 50s for a full pass, and this route shares a 300s budget with the import
    // above. 500 per run across four daily runs refreshes the whole board daily.
    //
    // Safe only because the intel model returns null for unevidenced fields —
    // before that it wrote a manufactured recruitingComposite to 991 players.
    let devyIntel: Record<string, number> | { error: string } = { enriched: 0, errors: 0 }
    // Guarded OUTSIDE the try on purpose: routing a deferral through the catch would report it as
    // `{ error: ... }`, turning "we ran out of time" into "enrichment failed" — the opposite of
    // what happened, and the kind of misreported state that sends someone debugging a healthy path.
    if (budget.exhausted()) {
      deferredPhases.push('devyIntel')
    } else try {
      const { enrichDevyIntelMetrics } = await import('@/lib/devy-classification')
      const intel = await enrichDevyIntelMetrics({ limit: 500 })
      devyIntel = { enriched: intel.updated, errors: intel.errors.length }
    } catch (devyError) {
      // Maintenance must never fail the player import it rides along with.
      const message = devyError instanceof Error ? devyError.message : String(devyError)
      console.error('[cron/import-players] devy intel enrichment failed:', message)
      devyIntel = { error: message.slice(0, 200) }
    }

    // Psychological profiles ride along here because this cron actually runs.
    //
    // The semantically correct trigger is after a league sync, and that stays
    // wired in fantasy-os-exec-sync. But that cron is gated behind
    // FANTASY_OS_EXEC_SYNC_LIVE, which is unset, and league_sync_state holds 0
    // rows — the collector has never executed in production. A trigger attached
    // to something that never fires looks wired up in code and leaves the table
    // empty in prod, which is how manager_psych_profiles sat at 0 rows to begin
    // with.
    //
    // Bounded to a few of the stalest leagues per run and fully swallowed:
    // profiling is enrichment and must never fail the player import it rides on.
    let psychProfiles: unknown = { leaguesProfiled: 0, managersProfiled: 0 }
    // Last phase, so it is the first to be dropped — and the cheapest to drop, since
    // refreshStaleLeagueProfiles already drains stalest-first and simply resumes next run.
    if (!dryRun && budget.exhausted()) {
      deferredPhases.push('psychProfiles')
    } else if (!dryRun) {
      try {
        psychProfiles = await refreshStaleLeagueProfiles({ maxLeagues: 3 })
      } catch (psychErr) {
        psychProfiles = {
          error: psychErr instanceof Error ? psychErr.message.slice(0, 160) : 'profile refresh failed',
        }
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      imported: result.imported,
      // Named so a partial run is legible: a deferred phase is time, not failure.
      deferredPhases: deferredPhases.length ? deferredPhases : undefined,
      budgetExhausted: budget.exhausted(),
      budgetElapsedMs: budget.elapsedMs(),
      devyIntel,
      psychProfiles,
      sports: result.sports,
      identity,
      staleFallbackApplied: result.staleFallbackApplied,
      skippedSports: result.skippedSports,
      teamCodeCounts: result.teamCodeCounts,
      rowsSkippedByGuard: result.rowsSkippedByGuard,
      pagedSeeds: result.pagedSeeds,
      seedCursors: result.seedCursors,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-players] failed:", message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}
