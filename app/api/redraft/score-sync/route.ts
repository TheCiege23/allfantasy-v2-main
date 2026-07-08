import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
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

type SeasonScoreResult =
  | { seasonId: string; ok: true; week: number; scoresUpserted: number }
  | { seasonId: string; ok: true; skipped: true; reason: string }
  | { seasonId: string; ok: false; error: string }

/**
 * GET /api/redraft/score-sync — the scheduled automated weekly scoring tick.
 *
 * Vercel crons issue GET (see `vercel.json` `/api/redraft/score-sync`), so this is
 * what actually runs on schedule. It enumerates every ACTIVE redraft season and
 * runs the native scoring pipeline for each —
 *   syncPlayerWeeklyScoresForRedraftSeason -> recalculateMatchupsForSeasonWeek -> updateStandings
 * — isolating per-season failures so one broken league never blocks the rest.
 * Non-NFL sports are skipped honestly (weekly stat sync is wired for NFL only) —
 * never marked as a false success. The survivor/zombie/c2c automation bridge still
 * runs (best-effort) so those formats keep their tick. Returns HTTP 200 with a
 * per-season breakdown even on partial failure; a real 500 only when the run cannot
 * start at all (e.g. the active-season enumeration query fails).
 */
export async function GET(request: Request) {
  // Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`; accept the cron secret
  // first, then fall back to admin/bearer for manual triggers.
  if (!requireCronAuth(request as unknown as NextRequest)) {
    const gate = await requireAdminOrBearer(request)
    if (!gate.ok) return gate.res
  }

  const startedAt = Date.now()

  let seasons: { id: string; leagueId: string; sport: string; currentWeek: number | null }[]
  try {
    seasons = await prisma.redraftSeason.findMany({
      where: { status: 'active' },
      select: { id: true, leagueId: true, sport: true, currentWeek: true },
      take: 200,
    })
  } catch (error) {
    // Route-level fatal: could not even enumerate active seasons.
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to load active redraft seasons' },
      { status: 500 },
    )
  }

  const results: SeasonScoreResult[] = []
  let succeeded = 0
  let failed = 0
  let skipped = 0

  for (const season of seasons) {
    // Weekly PlayerWeeklyScore sync is wired for NFL only; skip other sports without
    // pretending they synced.
    if (String(season.sport).toUpperCase() !== 'NFL') {
      results.push({ seasonId: season.id, ok: true, skipped: true, reason: 'non_nfl_sport' })
      skipped += 1
      continue
    }
    try {
      const summary = await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: season.id, actorId: 'cron' })
      await recalculateMatchupsForSeasonWeek(summary.seasonId, summary.week)
      await updateStandings(summary.seasonId, summary.week)
      results.push({ seasonId: season.id, ok: true, week: summary.week, scoresUpserted: summary.scoresUpserted })
      succeeded += 1
    } catch (error) {
      console.error('[redraft-score-sync cron] season scoring failed', {
        seasonId: season.id,
        message: error instanceof Error ? error.message : String(error),
      })
      results.push({
        seasonId: season.id,
        ok: false,
        error: error instanceof Error ? error.message : 'season scoring failed',
      })
      failed += 1
    }
  }

  // Keep the survivor/zombie/c2c automation tick alive (best-effort; never fails the redraft run).
  const legacy = await runLegacyAutomationBridge().catch((e) => ({
    error: e instanceof Error ? e.message : 'automation bridge failed',
  }))

  return NextResponse.json({
    ok: true,
    attempted: seasons.length,
    succeeded,
    failed,
    skipped,
    seasons: results,
    legacy,
    durationMs: Date.now() - startedAt,
    ranAt: new Date().toISOString(),
  })
}
