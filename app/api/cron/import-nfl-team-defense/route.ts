import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import {
  syncNflTeamDefenseBoxScores,
  resolveRosteredDefenseTeams,
} from '@/lib/redraft/teamDefenseProvider'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JOB = 'cron-nfl-team-defense-import'

/**
 * GET /api/cron/import-nfl-team-defense — scheduled NFL team-defense box-score feed.
 *
 * Fetches real weekly DST stats from Sleeper for every rostered team defense
 * across active NFL redraft seasons and ingests them into the `nfl:def:<ABBR>`
 * cache the score-sync reads. Idempotent + stat-correction safe. Per-season
 * failures are isolated. Points-allowed still derives from `SportsGame` when the
 * provider omits it. NCAAF/non-NFL seasons are ignored (NFL-only feed).
 */
export async function GET(request: Request) {
  if (!requireCronAuth(request as unknown as NextRequest, 'CRON_SECRET')) {
    const gate = await requireAdminOrBearer(request)
    if (!gate.ok) return gate.res
  }

  const startedAt = Date.now()
  try {
    const report = await withSyncJobRun(
      { jobName: JOB, trigger: 'cron' },
      async () => {
        const seasons = await prisma.redraftSeason.findMany({
          where: { status: 'active', sport: { in: ['NFL', 'nfl'] } },
          select: { id: true, season: true, currentWeek: true },
          take: 200,
        })
        const buckets = await resolveRosteredDefenseTeams(prisma, seasons)

        const results: Array<{ season: number; week: number; teamsRequested: number; teamsFetched: number; upserted: number; skippedNoStats: number }> = []
        let totalUpserted = 0
        const warnings: string[] = []
        for (const { season, week, teams } of buckets.values()) {
          if (teams.size === 0) continue
          const r = await syncNflTeamDefenseBoxScores(prisma, { season, week, teams: [...teams] })
          totalUpserted += r.ingest.upserted
          warnings.push(...r.warnings.slice(0, 5))
          results.push({
            season,
            week,
            teamsRequested: r.teamsRequested,
            teamsFetched: r.teamsFetched,
            upserted: r.ingest.upserted,
            skippedNoStats: r.ingest.skippedNoStats,
          })
        }
        return { totalUpserted, results, warnings }
      },
      (r) => ({
        rowsWritten: r.totalUpserted,
        warnings: r.warnings,
        status: 'success',
        metadata: { buckets: r.results.length },
      }),
    )

    return NextResponse.json({ ok: true, ...report, durationMs: Date.now() - startedAt, ranAt: new Date().toISOString() })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'NFL team-defense import failed' },
      { status: 500 },
    )
  }
}

// Manual/admin trigger.
export async function POST(request: Request) {
  return GET(request)
}
