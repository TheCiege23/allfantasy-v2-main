import { prisma } from '@/lib/prisma'
import { scoreLeagueWeek } from '@/lib/scoring/scoring-engine'
import { createEngineTimer, logLeagueEngineEvent } from '@/lib/league-engine-performance/observability'

export function resolveSeasonWeek(input?: {
  season?: number | null
  weekOrRound?: number | null
}): { season: number; weekOrRound: number } {
  const now = new Date()
  return {
    season: input?.season ?? now.getUTCFullYear(),
    weekOrRound: input?.weekOrRound ?? 1,
  }
}

export async function runScoringWorker(options?: {
  leagueIds?: string[]
  season?: number | null
  weekOrRound?: number | null
  lockScores?: boolean
}) {
  const timer = createEngineTimer()
  const period = resolveSeasonWeek(options)
  const leagues = await prisma.league.findMany({
    where: options?.leagueIds?.length ? { id: { in: options.leagueIds } } : undefined,
    select: { id: true },
  })

  const results = []
  for (const league of leagues) {
    results.push(
      await scoreLeagueWeek({
        leagueId: league.id,
        season: period.season,
        weekOrRound: period.weekOrRound,
        lockScores: options?.lockScores,
      })
    )
  }

  logLeagueEngineEvent({
    subsystem: 'scoring',
    action: 'run_scoring_worker',
    durationMs: timer.elapsedMs(),
    ok: true,
    extra: {
      processedLeagues: results.length,
      // Leagues where nothing was written because a team could not be scored (see scoreLeagueWeek).
      unavailableLeagues: results.filter((r) => r.status === 'unavailable').length,
      season: period.season,
      weekOrRound: period.weekOrRound,
    },
  })

  return {
    ...period,
    processedLeagues: results.length,
    results,
  }
}

