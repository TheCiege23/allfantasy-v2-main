import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { updateC2CMatchupScores } from '@/lib/c2c/scoringEngine'
import { syncWeeklyScores } from '@/lib/survivor/gameStateMachine'
import { checkAllMatchupsComplete } from '@/lib/zombie/matchupCompletion'
import { runWeeklyResolution } from '@/lib/zombie/weeklyResolutionEngine'
import { getZombieLeagueConfig } from '@/lib/zombie/ZombieLeagueConfig'
import { syncPlayerWeeklyScoresForRedraftSeason } from '@/lib/redraft/playerWeeklyScoreService'
import { recalculateMatchupsForSeasonWeek } from '@/lib/redraft/scoringEngine'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

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
    message: 'score-sync automation bridge ran; pass leagueId or seasonId to sync NFL PlayerWeeklyScore cache.',
    survivorBridge,
    zombieResolutionAttempts: zombieRes.length,
    zombieResolutionFailed: zombieRes.filter((r) => r.status === 'rejected').length,
    c2cLeaguesSynced: c2cLeagues.length,
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
    () => runLegacyAutomationBridge(),
    (r) => ({
      rowsWritten: r.matchupsRecalculated,
      // Survivor/zombie leagues each report their own failures without throwing; a partial
      // sweep is a degraded run, not a dead one.
      status:
        r.survivorBridge.failed > 0 || r.zombieResolutionFailed > 0 ? 'partial' : 'success',
      metadata: {
        matchupsRecalculated: r.matchupsRecalculated,
        survivorSynced: r.survivorBridge.synced,
        survivorFailed: r.survivorBridge.failed,
        zombieResolutionAttempts: r.zombieResolutionAttempts,
        zombieResolutionFailed: r.zombieResolutionFailed,
        c2cLeaguesSynced: r.c2cLeaguesSynced,
      },
    }),
  )
  return NextResponse.json(bridge)
}
