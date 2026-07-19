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

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

/**
 * Vercel cron invokes the `*/5 * * * *` schedule with GET and an
 * `Authorization: Bearer $CRON_SECRET` header. This route was POST-only and gated
 * by requireAdminOrBearer, which compares the bearer against ADMIN_PASSWORD rather
 * than CRON_SECRET — so the schedule 405'd, and would have 401'd even as a POST.
 *
 * A cron call carries no body, which is exactly the no-leagueId/no-seasonId branch
 * POST already takes: the legacy automation bridge (survivor/zombie/c2c). Note this
 * route is the reconciliation fallback — the primary NFL scoring driver is
 * /api/cron/live-score-tick.
 */
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await runLegacyAutomationBridge())
}

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
