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
  /*
   * `?intel=1` — run ONLY the four CFBD intel feeds, with the whole budget.
   *
   * 🛑 WHY THIS MODE HAS TO EXIST. The intel phase sits behind
   * `runSportsDataImporter` plus the devy pool and stats phases, and it refuses
   * to start with less than MIN_RUNWAY_MS (150s) left of a 240s budget — a
   * deliberate guard, because its slowest feed measured 137s and a phase killed
   * mid-write is worse than one deferred. The arithmetic never worked: the
   * three phases ahead of it do not finish inside 90s, so it was skipped BEFORE
   * running, every single tick.
   *
   * Measured on production 2026-08-28: `devy_pool_refresh:2025`,
   * `devy_pool_refresh:2026` and `devy_stats_refresh:2025` markers all present
   * and fresh; `devy_intel_refresh:*` — NONE, EVER. Not a failure, a starvation.
   * The columns it owns were still empty across all 1,718 rows: usageOverall 0,
   * ppaTotal 0, teamSpRating 0, returningProdPct 0, portalStatus 0.
   *
   * ⚠ It is the SAME shape as `ingestCFBDStats` and `ingestRosters` before it —
   * correct code that nothing ever reached — and it is fixed the same way
   * `ingestRosters` was: a mode on an EXISTING cron route with its own schedule,
   * never a new route (the build excludes new cron routes at the route budget).
   *
   * A dedicated tick also means the phase gets the full 240s rather than the
   * remainder, so its own per-feed cadence gating is what limits work, which is
   * what that gating was written to do.
   */
  const intelOnly = url.searchParams.get("intel") === "1"

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

    if (intelOnly) {
      /*
       * Heartbeat, not a table probe — and the distinction is the whole point.
       *
       * This phase writes `DevyPlayer` columns, and the main import-players run
       * writes `DevyPlayer` too, far more often. A table probe here would be
       * satisfied by THAT job's run and report this one healthy while it did
       * nothing — the same false green `?rosters=1` and `?riProfiles=1` are
       * documented as waiting on in cron-freshness-check.mjs, and the shape that
       * hid a dead fast tier for six days.
       *
       * The heartbeat wraps the whole sweep, one row per fire, so a tick that
       * cadence-gates every phase still records that it RAN. That matters here:
       * "all four feeds were inside their cadence" and "the job never fired" are
       * the two states this job spends most of its life in, and only one is a
       * problem.
       */
      const { withSyncJobRun } = await import('@/lib/production-health/syncJobRunTelemetry')
      const { refreshDevyIntelSources } = await import('@/lib/devy/devyIntelRefresh')
      const devyIntelSources = await withSyncJobRun(
        { jobName: 'cron-devy-intel-sources', jobScope: 'NCAAF', trigger: 'cron' },
        async () => refreshDevyIntelSources(budget),
      )
      return NextResponse.json({
        ok: true,
        mode: 'intel',
        devyIntelSources,
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

    // Structural devy pool refresh (new rosters / classes) rides along here
    // because this is the only scheduled devy write path in production:
    // runFullDevySync has zero callers and seedCollegePlayers is reachable only
    // via excluded routes or the Redis worker. Bounded to a rotating slice of
    // TOP_CFB_TEAMS per run (~10-15s) and stops between teams once the handler
    // budget is spent. Runs BEFORE intel enrichment so rows seeded this run are
    // already in the pool that enrichment drains.
    let devyPool: unknown = { skipped: 'deferred: run budget exhausted before phase start' }
    if (budget.exhausted()) {
      deferredPhases.push('devyPool')
    } else try {
      const { refreshDevyPoolSlice } = await import('@/lib/devy-pool-refresh')
      devyPool = await refreshDevyPoolSlice(budget)
    } catch (poolError) {
      // Maintenance must never fail the player import it rides along with.
      const message = poolError instanceof Error ? poolError.message : String(poolError)
      console.error('[cron/import-players] devy pool refresh failed:', message)
      devyPool = { error: message.slice(0, 200) }
    }

    // Stat lines for the schools the phase above just refreshed, same rotating
    // slice, so a school is seeded and statted in one fire.
    //
    // This is the ONLY scheduled writer of DevyPlayer.passingYards and its
    // siblings. Before it existed those columns were written solely by
    // seedCollegePlayers — reachable only from excluded routes and the Redis
    // worker — so in production they simply went stale, which is why
    // /api/market-alerts fetched CFBD live on the request path instead of
    // reading them. That surface now reads the DB and depends on this phase.
    let devyStats: unknown = { skipped: 'deferred: run budget exhausted before phase start' }
    if (budget.exhausted()) {
      deferredPhases.push('devyStats')
    } else try {
      const { refreshDevyStatsSlice } = await import('@/lib/devy/devyStatsRefresh')
      devyStats = await refreshDevyStatsSlice(budget)
    } catch (statsError) {
      // Maintenance must never fail the player import it rides along with.
      const message = statsError instanceof Error ? statsError.message : String(statsError)
      console.error('[cron/import-players] devy stats refresh failed:', message)
      devyStats = { error: message.slice(0, 200) }
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
    /*
     * The four CFBD intel FEEDS, which fill the columns the enrichment below
     * then reasons over. Runs BEFORE it for that reason.
     *
     * ⚠ THESE HAD NEVER RUN. Reachable only via runFullDevySync (zero callers),
     * so in production every column they own was empty across all 1,718 rows:
     * usageOverall 0, ppaTotal 0, wepaTotal 0, returningProdPct 0,
     * teamSpRating 0, portalStatus 0. Same shape as ingestCFBDStats — correct
     * code, no scheduled caller — and the reason draftProjectionScore covered
     * only 812 of 1,718.
     *
     * Cheap on quota (8-11 season-wide provider calls, not per-team) but each
     * writes across TOP_CFB_TEAMS, so the module gates each feed on its own
     * cadence rather than redoing identical writes every six hours.
     */
    let devyIntelSources: unknown = { skipped: 'deferred: run budget exhausted before phase start' }
    if (budget.exhausted()) {
      deferredPhases.push('devyIntelSources')
    } else try {
      const { refreshDevyIntelSources } = await import('@/lib/devy/devyIntelRefresh')
      devyIntelSources = await refreshDevyIntelSources(budget)
    } catch (intelError) {
      // Maintenance must never fail the player import it rides along with.
      const message = intelError instanceof Error ? intelError.message : String(intelError)
      console.error('[cron/import-players] devy intel sources failed:', message)
      devyIntelSources = { error: message.slice(0, 200) }
    }

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
    /*
     * ── Sleeper player rows ───────────────────────────────────────────────
     *
     * ⚠ THE SEED SERVICE THAT WRITES THESE HAS NO CALLER. `SleeperPlayerSeedService`
     * is complete, correct and unreachable — no route, no cron, no script — so the
     * Sleeper-sourced `SportsPlayer` rows have never had a maintained refresh. That
     * is not an oversight to fix by calling it: its shape is `deleteMany` then
     * `createMany`, which on a live product means deleting every Sleeper player row
     * and rebuilding it, and there is no safe moment for that. `refreshSleeperPlayerRows`
     * upserts instead, and matches on `sleeperId` so it updates whichever externalId
     * format a row already carries rather than creating a second one.
     *
     * A phase, not the job: bounded per run, stalest first, and dropped whole when
     * the budget is gone.
     */
    let sleeperRows: unknown = { skipped: true }
    if (!dryRun && wantsNfl && budget.exhausted()) {
      deferredPhases.push('sleeperRows')
    } else if (!dryRun && wantsNfl) {
      try {
        const { refreshSleeperPlayerRows } = await import('@/lib/sleeper/refreshSleeperPlayerRows')
        sleeperRows = await refreshSleeperPlayerRows({
          sport: 'NFL',
          /*
           * Sized against how long a full pass takes, not picked round. Sleeper
           * lists roughly 11.4k NFL players and this cron fires every 6 hours,
           * so 1,500 a run is four passes a day and a complete sweep inside two
           * — where 400 would have taken a week. The writes are serial single
           * updates, so 1,500 is a few tens of seconds, and the budget check
           * between rows is what actually bounds it if the run is already late.
           */
          limit: 1500,
          isExhausted: () => budget.exhausted(),
        })
      } catch (sleeperErr) {
        /* Enrichment must never fail the import it rides on. */
        sleeperRows = {
          error: sleeperErr instanceof Error ? sleeperErr.message.slice(0, 160) : 'sleeper row refresh failed',
        }
      }
    }

    /*
     * ⚠ AN ESPN LEAGUE COULD IMPORT PERFECTLY AND NAME NOBODY. Measured on the
     * first one ever imported: 252 draft facts and zero rows in the identity table
     * with `provider = 'espn'`, so Draft HQ rendered fourteen picks as
     * "(not yet mapped)". The import path cannot supply the names — `mRoster`
     * returned bare ids for that league, leaving a directory of `Player <id>`
     * placeholders with nothing to harvest.
     *
     * ESPN's per-athlete endpoint needs no credential and its ids ARE the fantasy
     * ids, verified against that board (4430737 -> Kyren Williams).
     *
     * ⚠ DRIVEN BY THE IDS WE HOLD, NOT ESPN'S CATALOGUE. The list endpoint reports
     * `pageCount: 21` and then serves the same first rows for every page, ignores
     * `offset`, and caps `limit` at 1000 — a first version walked it and wrote 994
     * athletes while reporting 20,874 seen. Asking about our own unknown ids is
     * both correct and far smaller: 252 across every imported ESPN league.
     */
    /*
     * Birthdays BEFORE the ESPN matcher, deliberately, and in the same tick.
     *
     * `matchProviderAthlete` refuses to link on a name alone and treats an agreeing
     * birthday as near decisive. ESPN's athlete document supplies a birthday and
     * nothing else — no position, no team — so with `Player.birthDate` empty the
     * first production run refused all 157 candidates it looked at. Running this
     * first means the birthdays it writes are available to the matcher immediately
     * rather than a tick later.
     */
    let canonicalBirthdays: unknown = { skipped: true }
    if (!dryRun && wantsNfl && budget.exhausted()) {
      deferredPhases.push('canonicalBirthdays')
    } else if (!dryRun && wantsNfl) {
      try {
        const { backfillCanonicalBirthdays } = await import(
          '@/lib/player-identity/backfillCanonicalBirthdays'
        )
        canonicalBirthdays = await backfillCanonicalBirthdays({
          sport: 'NFL',
          isExhausted: () => budget.exhausted(),
        })
      } catch (dobErr) {
        /* Enrichment must never fail the import it rides on. */
        canonicalBirthdays = {
          error: dobErr instanceof Error ? dobErr.message.slice(0, 160) : 'birthday backfill failed',
        }
      }
    }

    let espnIdentities: unknown = { skipped: true }
    if (!dryRun && wantsNfl && budget.exhausted()) {
      deferredPhases.push('espnIdentities')
    } else if (!dryRun && wantsNfl) {
      try {
        const { ingestEspnAthleteIdentities } = await import('@/lib/espn/ingestEspnAthleteIdentities')
        espnIdentities = await ingestEspnAthleteIdentities({
          maxPlayers: 300,
          isExhausted: () => budget.exhausted(),
        })
      } catch (espnErr) {
        /* Enrichment must never fail the import it rides on. */
        espnIdentities = {
          error: espnErr instanceof Error ? espnErr.message.slice(0, 160) : 'espn identity ingest failed',
        }
      }
    }

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
      devyPool,
      devyStats,
      devyIntelSources,
      devyIntel,
      sleeperRows,
      canonicalBirthdays,
      espnIdentities,
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
