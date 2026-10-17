import { prisma } from '@/lib/prisma'
import { processWaiverClaimsForLeague } from '@/lib/waiver-wire/process-engine'
import { auditDynastyCutdowns, expireOverdueKeeperDeclarations } from '@/lib/league/keeper-engine'
import { scoreLeagueWeek } from '@/lib/scoring/scoring-engine'
import {
  generateDraftRecapArtifact,
  generateWeeklyLeagueArtifacts,
} from '@/lib/league/format-artifact-service'
import { buildWaiverCronIdempotencyKey } from '@/lib/league-engine-performance/idempotencyKeys'
import { createEngineTimer, logLeagueEngineBatchSummary, logLeagueEngineEvent } from '@/lib/league-engine-performance/observability'

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

export async function runWeeklyLeagueAutomation(options?: {
  season?: number | null
  weekOrRound?: number | null
}) {
  const scoring = await runScoringWorker({
    season: options?.season,
    weekOrRound: options?.weekOrRound,
  })
  await Promise.all(
    // A week that was not scored has nothing new to recap.
    scoring.results.filter((result) => result.status === 'scored').map(async (result) => {
      await generateWeeklyLeagueArtifacts({
        leagueId: result.leagueId,
        season: result.season,
        week: result.weekOrRound,
      }).catch(() => null)
      await generateDraftRecapArtifact(result.leagueId).catch(() => null)
    })
  )
  const keepersExpired = await expireOverdueKeeperDeclarations()
  const cutdownAudit = await auditDynastyCutdowns()

  return {
    ...scoring,
    keepersExpired,
    cutdownAuditCount: cutdownAudit.length,
  }
}

export async function runWaiverProcessingWorker(options?: { leagueIds?: string[] }) {
  const timer = createEngineTimer()
  const pending = await prisma.waiverClaim.findMany({
    where: {
      status: 'pending',
      ...(options?.leagueIds?.length ? { leagueId: { in: options.leagueIds } } : {}),
    },
    select: {
      leagueId: true,
    },
  })

  const leagueIds = Array.from(new Set(pending.map((claim) => claim.leagueId)))
  const results = []
  for (const leagueId of leagueIds) {
    const idempotencyKey = buildWaiverCronIdempotencyKey(leagueId)
    const leagueTimer = createEngineTimer()
    const claims = await processWaiverClaimsForLeague(leagueId, {
      idempotencyKey,
      runType: 'scheduled',
    })
    logLeagueEngineEvent({
      subsystem: 'waiver',
      action: 'process_league_waivers',
      leagueId,
      durationMs: leagueTimer.elapsedMs(),
      idempotencyKey,
      ok: true,
      extra: { resultCount: claims.length },
    })
    results.push({
      leagueId,
      claims,
    })
  }

  logLeagueEngineBatchSummary({
    subsystem: 'waiver',
    action: 'waiver_processing_worker',
    processed: leagueIds.length,
    durationMs: timer.elapsedMs(),
  })

  return {
    processedLeagues: leagueIds.length,
    results,
  }
}
