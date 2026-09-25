import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { updateC2CMatchupScores } from '@/lib/c2c/scoringEngine'
import { syncWeeklyScores } from '@/lib/survivor/gameStateMachine'
import { checkAllMatchupsComplete } from '@/lib/zombie/matchupCompletion'
import { runWeeklyResolution } from '@/lib/zombie/weeklyResolutionEngine'
import { getZombieLeagueConfig } from '@/lib/zombie/ZombieLeagueConfig'
import { runZombieHousekeeping } from '@/lib/zombie/zombieAutomation'
import { syncPlayerWeeklyScoresForRedraftSeason } from '@/lib/redraft/playerWeeklyScoreService'
import { recalculateMatchupsForSeasonWeek } from '@/lib/redraft/scoringEngine'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { engineSeasonScope } from '@/lib/redraft/seasonStatus'
import { resolveSeasonWeekForRedraftSeason } from '@/lib/season-week'
import { finalizeCompletedWeeksForSeason } from '@/lib/redraft/weekFinalizer'
import { rotatingBatch, SCORE_SYNC_BATCH } from '@/lib/redraft/scoreSyncBatch'
import { runNativeGuillotineWeek } from '@/lib/guillotine/nativeGuillotineWeek'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Heartbeat job name, probed by scripts/cron-freshness-check.mjs.
 *
 * This job is CONDITIONAL: in preseason there are no games to score, and redraft_matchups has
 * no timestamp column to probe in any case. Only the SCHEDULED GET records a run — the admin
 * POST below is a manual invocation, and letting it refresh the heartbeat would mask a dead
 * scheduler.
 */
const JOB = 'cron-redraft-score-sync'

type ScoreSyncBody = {
  leagueId?: string
  seasonId?: string
  week?: number
}

async function readBody(request: Request): Promise<ScoreSyncBody> {
  try {
    return ((await request.json()) ?? {}) as ScoreSyncBody
  } catch {
    return {}
  }
}

async function runLegacyAutomationBridge() {
  const survivorBridge = { synced: 0, failed: 0 }

  const survivorLeagues = await prisma.league.findMany({
    where: {
      survivorMode: true,
      survivorPhase: { in: ['pre_merge', 'post_swap', 'merge', 'post_merge', 'jury'] },
    },
    select: { id: true },
  })

  const results = await Promise.allSettled(
    survivorLeagues.map(async ({ id: leagueId }) => {
      const season = await prisma.redraftSeason.findFirst({
        where: { leagueId },
        orderBy: { createdAt: 'desc' },
      })
      const week = Math.max(1, season?.currentWeek ?? 1)
      await syncWeeklyScores(leagueId, week)
    }),
  )

  for (const r of results) {
    if (r.status === 'fulfilled') survivorBridge.synced++
    else survivorBridge.failed++
  }

  const zombieLeagues = await prisma.zombieLeague.findMany({
    where: { status: 'active' },
    select: { id: true, leagueId: true, currentWeek: true, season: true },
  })

  const zombieRes = await Promise.allSettled(
    zombieLeagues.map(async ({ id, leagueId, currentWeek, season }) => {
      const week = Math.max(1, currentWeek || 1)
      const allComplete = await checkAllMatchupsComplete(leagueId, week, season)
      if (!allComplete) return

      const cfg = await getZombieLeagueConfig(leagueId)
      const replayOnStatCorrection = Boolean(cfg?.statCorrectionReversal)

      await runWeeklyResolution(id, week, {
        force: replayOnStatCorrection,
        reason: replayOnStatCorrection ? 'stat_correction' : undefined,
      })
    }),
  )

  // Bashing expiry, the announcement queue, scheduled weekly updates, animation delivery. Their own
  // route is on no schedule and the cron list is full, so they ride this tick. See zombieAutomation.ts.
  const zombieHousekeeping = await runZombieHousekeeping().catch((e: unknown) => ({
    leaguesChecked: 0,
    announcementsPosted: 0,
    errors: [e instanceof Error ? e.message : String(e)],
  }))

  const c2cLeagues = await prisma.c2CLeague.findMany({ select: { leagueId: true } })
  let c2cMatchupsRecalculated = 0
  for (const { leagueId } of c2cLeagues) {
    const matchups = await prisma.redraftMatchup.findMany({
      where: {
        leagueId,
        status: { in: ['scheduled', 'active'] },
      },
      take: 120,
      select: { id: true },
    })
    for (const m of matchups) {
      try {
        await updateC2CMatchupScores(m.id)
        c2cMatchupsRecalculated++
      } catch {
        /* missing away roster / config */
      }
    }
  }

  return {
    updated: 0,
    matchupsRecalculated: c2cMatchupsRecalculated,
    message: 'Survivor/zombie/C2C automation bridge ran. The scheduled GET also runs the redraft reconciliation sweep; POST with a leagueId or seasonId to reconcile one league on demand.',
    survivorBridge,
    zombieResolutionAttempts: zombieRes.length,
    zombieResolutionFailed: zombieRes.filter((r) => r.status === 'rejected').length,
    zombieHousekeepingLeagues: zombieHousekeeping.leaguesChecked,
    zombieHousekeepingErrors: zombieHousekeeping.errors,
    c2cLeaguesSynced: c2cLeagues.length,
  }
}

/**
 * The redraft half of this job, which the scheduled path never had.
 *
 * 🛑 THE GET RAN ONLY `runLegacyAutomationBridge` AND RETURNED `updated: 0` BY
 * DESIGN. Its own message said so — "pass leagueId or seasonId to sync NFL
 * PlayerWeeklyScore cache" — so every five minutes this job reported success
 * having reconciled no redraft league at all. The work existed the whole time,
 * in POST, behind a required `leagueId`.
 *
 * The reason it was POST-only is worth naming: a sweep needs to know WHICH WEEK
 * to reconcile, and until now nothing could answer that per league. It fell back
 * to `season.currentWeek`, which no code path increments. `resolveSeasonWeekForRedraftSeason`
 * answers it from the schedule, and declines rather than guessing — a season it
 * cannot place is skipped and counted, never reconciled against week 1.
 *
 * ⚠ THIS IS A RECONCILIATION PASS, NOT A SECOND LIVE SCORER. `live-score-tick`
 * writes what CHANGED according to the live provider; this recomputes from the
 * cached stat rows, which is what repairs a league that missed a tick.
 */
async function runRedraftReconciliation() {
  const eligible = await prisma.redraftSeason.findMany({
    where: engineSeasonScope(),
    select: { id: true, leagueId: true, sport: true },
    orderBy: { id: 'asc' },
  })
  const seasons = rotatingBatch(eligible, SCORE_SYNC_BATCH, Date.now())

  let reconciled = 0
  let skippedUnresolvedWeek = 0
  let failed = 0
  let matchupsRecalculated = 0
  let weeksFinalized = 0
  let finalizeFailed = 0
  const finalizeRefusals: Record<string, number> = {}
  let guillotineChops = 0
  let guillotineFailed = 0
  const guillotineOutcomes: Record<string, number> = {}

  for (const season of seasons) {
    const resolved = await resolveSeasonWeekForRedraftSeason(season.id)
    if (!resolved.ok || resolved.phase === 'preseason') {
      skippedUnresolvedWeek += 1
      continue
    }
    try {
      const summary = await syncPlayerWeeklyScoresForRedraftSeason({
        seasonId: season.id,
        week: resolved.fantasyWeek,
        actorId: 'system:score-sync',
      })
      const matchups = await recalculateMatchupsForSeasonWeek(summary.seasonId, summary.week)
      await updateStandings(summary.seasonId, summary.week)
      matchupsRecalculated += matchups.updated
      reconciled += 1
    } catch {
      // A single league's provider gap must not end the sweep for the rest.
      failed += 1
    }

    /*
     * Close any week whose games are over.
     *
     * 🛑 THIS RUNS EVEN WHEN THE RECONCILIATION ABOVE THREW, AND THAT IS THE POINT. The
     * sync fails for a league whose provider had a gap this tick; the weeks BEFORE that one
     * are still finished and still blocking `advance_week`. Tying the two together would
     * mean one bad tick keeps a season stuck for the rest of the year.
     *
     * It refuses far more often than it acts — unfinished slate, inside the grace period,
     * stat coverage below the floor — and each refusal is counted into the job's telemetry
     * so a season that never closes says why.
     */
    try {
      const sweep = await finalizeCompletedWeeksForSeason(
        {
          seasonId: season.id,
          throughWeek: resolved.fantasyWeek,
        },
        {
          /*
           * The sweep looks BACK, and the reconciliation above only ever ran for the CURRENT
           * week — so an older week was judged on stats nobody had refreshed since it was
           * current. This is the same sync, aimed at the week actually being closed, and the
           * sweep calls it only when a week refuses for coverage.
           */
          syncWeekStats: async ({ seasonId, week }) => {
            /*
             * ⚠ ASKED BEFORE THE SYNC, BECAUSE AFTERWARDS IT IS UNANSWERABLE. The provider
             * returns an empty map when it is refused and an empty map when the week genuinely
             * has nothing, and neither the sync nor the finalizer can tell those apart from the
             * rows that result. The same `canCall` the provider consults is the authority; it
             * is a cheap read, and asking it here is what lets the refusal name a true cause.
             */
            const { rateLimitManager } = await import('@/lib/workers/rate-limit-manager')
            const canCall = await rateLimitManager
              .canCall('sleeper', 'stats/nfl/week')
              .catch(() => true)

            await syncPlayerWeeklyScoresForRedraftSeason({
              seasonId,
              week,
              actorId: 'system:score-sync-backfill',
            })
            await recalculateMatchupsForSeasonWeek(seasonId, week)
            return { rateLimited: !canCall }
          },
        },
      )
      weeksFinalized += sweep.finalized
      for (const [reason, count] of Object.entries(sweep.refusals)) {
        finalizeRefusals[reason] = (finalizeRefusals[reason] ?? 0) + count
      }
      // A newly closed week changes records, so standings are rebuilt from the sealed results.
      if (sweep.finalized > 0) await updateStandings(season.id, resolved.fantasyWeek)
    } catch {
      finalizeFailed += 1
    }

    /*
     * A native guillotine league chops its lowest team once each finished week. It runs after the
     * sweep for the same reason the sweep runs after the sync: an older week is still owed its chop
     * even when this tick's sync failed. One chop per week, guarded inside.
     */
    try {
      const guillotine = await runNativeGuillotineWeek(
        { seasonId: season.id, currentFantasyWeek: resolved.fantasyWeek },
        {
          syncWeekStats: async ({ seasonId, week }) => {
            await syncPlayerWeeklyScoresForRedraftSeason({ seasonId, week, actorId: 'system:score-sync-backfill' })
          },
        },
      )
      if (guillotine.outcome !== 'not_guillotine') {
        guillotineOutcomes[guillotine.outcome] = (guillotineOutcomes[guillotine.outcome] ?? 0) + 1
      }
      if (guillotine.outcome === 'chopped') guillotineChops += 1
    } catch {
      guillotineFailed += 1
    }
  }

  return {
    seasonsConsidered: seasons.length,
    reconciled,
    skippedUnresolvedWeek,
    failed,
    matchupsRecalculated,
    weeksFinalized,
    finalizeFailed,
    finalizeRefusals,
    guillotineChops,
    guillotineFailed,
    guillotineOutcomes,
  }
}

// This branch added its own cron GET here. #284 landed an equivalent one further down
// (kept), so both would have exported `GET` from the same module. Dropped this copy rather
// than main's: main's is the shipped, reviewed version, and it sidesteps the build bug
// entirely by writing "every 5 minutes" in prose instead of the literal `*/5 * * * *`,
// whose `*/` closes a block comment early.

export async function POST(request: Request) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  const body = await readBody(request)
  const leagueId = body.leagueId?.trim()
  const seasonId = body.seasonId?.trim()
  const week = body.week != null ? Number(body.week) : undefined
  const actorId = gate.user.id ?? gate.user.email ?? 'system'

  if (!leagueId && !seasonId) {
    return NextResponse.json(await runLegacyAutomationBridge())
  }

  try {
    const syncSummary = await syncPlayerWeeklyScoresForRedraftSeason({
      leagueId,
      seasonId,
      week,
      actorId,
    })
    const matchups = await recalculateMatchupsForSeasonWeek(syncSummary.seasonId, syncSummary.week)
    const standings = await updateStandings(syncSummary.seasonId, syncSummary.week)
    const status = syncSummary.scoresUpserted > 0 ? 'synced' : 'unavailable'

    return NextResponse.json({
      ok: true,
      status,
      updated: syncSummary.scoresUpserted,
      message:
        status === 'synced'
          ? 'NFL weekly cached stats synced into PlayerWeeklyScore.'
          : 'No cached NFL weekly stats were available to sync. Run the provider/cache job first.',
      sync: syncSummary,
      matchups,
      standings,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Score sync failed'
    const status = message.includes('not found') ? 404 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

/**
 * Vercel Cron issues a GET (scheduled every 5 minutes in vercel.json), but this route only
 * exported POST.
 * Measured in production 2026-07-19: 288 invocations in 24h, all 405 — no score sync ever ran
 * on schedule.
 *
 * POST keeps its existing `requireAdminOrBearer` gate untouched. GET is gated on
 * `requireCronAuth` (what Vercel's scheduler presents, and already a superset of the admin
 * secrets), and runs the no-body path POST takes when called without a leagueId/seasonId —
 * which is exactly what a scheduled invocation does.
 */
export async function GET(request: Request) {
  // Name CRON_SECRET explicitly, matching #289. `requireCronAuth` resolves
  // `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`, and LEAGUE_CRON_SECRET IS set
  // in prod — so a bare call compares Vercel's `Bearer $CRON_SECRET` against the wrong
  // variable and 401s. #289 fixed the 13 routes under app/api/cron/; this one lives under
  // app/api/redraft/ and was missed, so it would still have 401'd after this merge.
  if (!requireCronAuth(request as unknown as NextRequest, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  /*
   * `withSyncJobRun` writes its row before the bridge runs, so the heartbeat is recorded on
   * every scheduled fire — including the preseason ones that legitimately find nothing to
   * score, and including a run the platform kills at maxDuration (no user code runs after a
   * kill, so the row never closes; the started_at it already wrote is still the heartbeat).
   */
  const bridge = await withSyncJobRun(
    { jobName: JOB, trigger: 'cron', sport: 'NFL' },
    async () => {
      // Both halves, and the redraft half is the one this job advertised and
      // never ran. Legacy first so a redraft failure cannot cost the
      // survivor/zombie/C2C sweep that has been working all along.
      const legacy = await runLegacyAutomationBridge()
      const redraft = await runRedraftReconciliation()
      return { ...legacy, redraft, updated: redraft.reconciled }
    },
    (r) => ({
      rowsWritten: r.matchupsRecalculated + r.redraft.matchupsRecalculated,
      rowsRead: r.redraft.seasonsConsidered,
      // Survivor/zombie leagues each report their own failures without throwing; a partial
      // sweep is a degraded run, not a dead one.
      status:
        r.survivorBridge.failed > 0 ||
        r.zombieResolutionFailed > 0 ||
        r.zombieHousekeepingErrors.length > 0 ||
        r.redraft.failed > 0 ||
        r.redraft.finalizeFailed > 0 ||
        r.redraft.guillotineFailed > 0
          ? 'partial'
          : 'success',
      metadata: {
        matchupsRecalculated: r.matchupsRecalculated,
        survivorSynced: r.survivorBridge.synced,
        survivorFailed: r.survivorBridge.failed,
        zombieResolutionAttempts: r.zombieResolutionAttempts,
        zombieResolutionFailed: r.zombieResolutionFailed,
        zombieHousekeepingLeagues: r.zombieHousekeepingLeagues,
        zombieHousekeepingErrors: r.zombieHousekeepingErrors.slice(0, 10),
        c2cLeaguesSynced: r.c2cLeaguesSynced,
        redraft: r.redraft,
      },
    }),
  )
  return NextResponse.json(bridge)
}
