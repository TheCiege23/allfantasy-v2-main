/**
 * Devy Dynasty background job handlers. PROMPT 5.
 * NCAA sync, declare status, auto-graduation, pool generation, promotion window,
 * rookie exclusion list, best ball snapshots, rankings refresh.
 */

import { prisma } from '@/lib/prisma'
import { isDevyLeague, getDevyConfig } from '../DevyLeagueConfig'
import {
  getDevyHeldPromotedDevyPlayerIds,
  getPromotedProPlayerIdsExcludedFromRookiePool,
} from '../pool/DevyPoolSeparation'
import { getDevyTeamOutlook } from '../rankings/DevyTeamOutlookService'
import type { DevyJobPayload } from '@/lib/jobs/types'
import { isC2CLeague } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import {
  syncDeclaredStatus,
  runAutoPromotionByTiming,
} from '../lifecycle/DevyLifecycleAutomation'
import { getC2CHybridStandings } from '@/lib/merged-devy-c2c/standings/C2CStandingsService'
import {
  importCollegePlayers,
  calculateC2CPointsForLeague,
  promoteEligiblePlayers,
  refreshDraftProjections,
  refreshTransferPortal,
} from '@/lib/workers/devy-data-worker'

export type DevyJobResult = {
  ok: boolean
  type: string
  processedAt: string
  message?: string
  error?: string
}

/** NCAA player sync backed by CFBD + provider chain ingestion. */
async function runNcaaPlayerSync(payload: DevyJobPayload): Promise<DevyJobResult> {
  const sport = payload.sport ?? 'NFL'
  const processedAt = new Date().toISOString()
  try {
    const [seeded, projections, portal] = await Promise.all([
      importCollegePlayers(sport),
      refreshDraftProjections(sport),
      refreshTransferPortal(sport),
    ])
    return {
      ok: seeded.ok && projections.ok && portal.ok,
      type: 'ncaa_player_sync',
      processedAt,
      message: `Imported ${seeded.created ?? 0}, refreshed ${projections.updated ?? 0} projections, ${portal.updated ?? 0} portal statuses`,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'ncaa_player_sync', processedAt, error }
  }
}

/** Declare / draft / return-to-school status refresh: placeholder for status pipeline. */
async function runDeclareStatusRefresh(payload: DevyJobPayload): Promise<DevyJobResult> {
  const processedAt = new Date().toISOString()
  try {
    const leagueId = payload.leagueId
    const seasonYear = payload.seasonYear ?? new Date().getFullYear()
    if (!leagueId) {
      return { ok: false, type: 'declare_status_refresh', processedAt, error: 'leagueId required' }
    }
    const result = await syncDeclaredStatus(leagueId, seasonYear)
    return {
      ok: true,
      type: 'declare_status_refresh',
      processedAt,
      message: `Synced declare status. ${result.count} rights transitioned.${result.errors.length > 0 ? ` ${result.errors.length} errored.` : ''}`,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'declare_status_refresh', processedAt, error }
  }
}

/** Auto-graduation after NFL/NBA draft: mark devy players as graduated when draft data exists. */
async function runAutoGraduationAfterDraft(payload: DevyJobPayload): Promise<DevyJobResult> {
  const leagueId = payload.leagueId
  const seasonYear = payload.seasonYear ?? new Date().getFullYear()
  const processedAt = new Date().toISOString()
  try {
    if (!leagueId) {
      return { ok: false, type: 'auto_graduation_after_draft', processedAt, error: 'leagueId required' }
    }
    const isDevy = await isDevyLeague(leagueId)
    if (!isDevy) {
      return { ok: true, type: 'auto_graduation_after_draft', processedAt, message: 'Not a devy league' }
    }
    // Graduation is applied per-player when draft results are known; lifecycle engine handles rights.
    // This job can trigger a bulk check: find DevyPlayer where draftYear = seasonYear and not yet graduated, then mark.
    const updated = await prisma.devyPlayer.updateMany({
      where: {
        draftYear: seasonYear,
        graduatedToNFL: false,
        league: 'NCAA',
      },
      data: { graduatedToNFL: true },
    })
    return {
      ok: true,
      type: 'auto_graduation_after_draft',
      processedAt,
      message: `Marked ${updated.count} players graduated for ${seasonYear}`,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'auto_graduation_after_draft', processedAt, error }
  }
}

/** Rookie pool generation: ensure exclusion list is available; no-op that validates pool separation. */
async function runRookiePoolGeneration(payload: DevyJobPayload): Promise<DevyJobResult> {
  const leagueId = payload.leagueId
  const processedAt = new Date().toISOString()
  try {
    if (!leagueId) {
      return { ok: false, type: 'rookie_pool_generation', processedAt, error: 'leagueId required' }
    }
    const excludedDevy = await getDevyHeldPromotedDevyPlayerIds(leagueId)
    const excludedPro = await getPromotedProPlayerIdsExcludedFromRookiePool(leagueId)
    console.log('[devy-jobs] rookie_pool_generation', leagueId, excludedDevy.size, excludedPro.size)
    return {
      ok: true,
      type: 'rookie_pool_generation',
      processedAt,
      message: `Exclusions: ${excludedDevy.size} devy, ${excludedPro.size} pro`,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'rookie_pool_generation', processedAt, error }
  }
}

/** Devy pool generation: placeholder for building devy-eligible pool for a league. */
async function runDevyPoolGeneration(payload: DevyJobPayload): Promise<DevyJobResult> {
  const leagueId = payload.leagueId
  const processedAt = new Date().toISOString()
  try {
    if (!leagueId) {
      return { ok: false, type: 'devy_pool_generation', processedAt, error: 'leagueId required' }
    }
    const config = await getDevyConfig(leagueId)
    if (!config) {
      return { ok: true, type: 'devy_pool_generation', processedAt, message: 'Not a devy league' }
    }
    // Pool is derived from DevyPlayer + eligibility at draft time; no persistent "pool" table.
    console.log('[devy-jobs] devy_pool_generation', leagueId, config.sport)
    return { ok: true, type: 'devy_pool_generation', processedAt, message: 'OK' }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'devy_pool_generation', processedAt, error }
  }
}

/** Promotion window sync: config-driven; job can emit notifications when window opens/closes. */
async function runPromotionWindowSync(payload: DevyJobPayload): Promise<DevyJobResult> {
  const leagueId = payload.leagueId
  const processedAt = new Date().toISOString()
  try {
    if (!leagueId) {
      return { ok: false, type: 'promotion_window_sync', processedAt, error: 'leagueId required' }
    }
    const config = await getDevyConfig(leagueId)
    if (!config) {
      return { ok: true, type: 'promotion_window_sync', processedAt, message: 'Not a devy league' }
    }
      const seasonYear = payload.seasonYear ?? new Date().getFullYear()
      const result = await runAutoPromotionByTiming(leagueId, seasonYear)
      return {
        ok: true,
        type: 'promotion_window_sync',
        processedAt,
        message: `Auto-promotion sync: ${result.promoted} promoted.${result.errors.length > 0 ? ` ${result.errors.length} errored.` : ''}`,
      }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'promotion_window_sync', processedAt, error }
  }
}

/** Rookie draft exclusion list: materialize and optionally cache exclusion sets for draft UI. */
async function runRookieDraftExclusionList(payload: DevyJobPayload): Promise<DevyJobResult> {
  const leagueId = payload.leagueId
  const processedAt = new Date().toISOString()
  try {
    if (!leagueId) {
      return { ok: false, type: 'rookie_draft_exclusion_list', processedAt, error: 'leagueId required' }
    }
    const devyIds = await getDevyHeldPromotedDevyPlayerIds(leagueId)
    const proIds = await getPromotedProPlayerIdsExcludedFromRookiePool(leagueId)
    // Exclusion list is computed on demand in pool separation; job can prewarm or log.
    console.log('[devy-jobs] rookie_draft_exclusion_list', leagueId, devyIds.size, proIds.size)
    return {
      ok: true,
      type: 'rookie_draft_exclusion_list',
      processedAt,
      message: `Excluded ${devyIds.size} devy, ${proIds.size} pro`,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'rookie_draft_exclusion_list', processedAt, error }
  }
}

/** Best ball lineup snapshot: compute optimal lineup and persist to DevyBestBallLineupSnapshot. */
async function runBestBallLineupSnapshot(payload: DevyJobPayload): Promise<DevyJobResult> {
  const { leagueId, rosterId, periodKey } = payload
  const processedAt = new Date().toISOString()
  try {
    if (!leagueId || !rosterId || !periodKey) {
      return {
        ok: false,
        type: 'best_ball_lineup_snapshot',
        processedAt,
        error: 'leagueId, rosterId, periodKey required',
      }
    }
    const config = await getDevyConfig(leagueId)
    if (!config?.bestBallEnabled) {
      return { ok: true, type: 'best_ball_lineup_snapshot', processedAt, message: 'Best ball not enabled' }
    }
    // Snapshot requires roster players + points for period; if no scoring data, upsert with empty starters.
    await prisma.devyBestBallLineupSnapshot.upsert({
      where: {
        leagueId_rosterId_periodKey: { leagueId, rosterId, periodKey },
      },
      create: {
        leagueId,
        rosterId,
        periodKey,
        totalPoints: null,
        starterIds: [],
      },
      update: {},
    })
    return {
      ok: true,
      type: 'best_ball_lineup_snapshot',
      processedAt,
      message: `Snapshot upserted for ${rosterId} ${periodKey}`,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'best_ball_lineup_snapshot', processedAt, error }
  }
}

/** Class strength snapshot: aggregate devy players by year/position for AI storytelling. */
async function runClassStrengthSnapshot(payload: DevyJobPayload): Promise<DevyJobResult> {
  const sport = payload.sport ?? 'NFL'
  const seasonYear = payload.seasonYear ?? new Date().getFullYear()
  const processedAt = new Date().toISOString()
  try {
    const players = await prisma.devyPlayer.findMany({
      where: {
        league: 'NCAA',
        devyEligible: true,
        draftEligibleYear: { not: null },
      },
      select: { position: true, draftEligibleYear: true },
    })
    const byYear: Record<number, Record<string, number>> = {}
    for (const p of players) {
      const year = p.draftEligibleYear ?? seasonYear
      if (!byYear[year]) byYear[year] = {}
      const pos = p.position || 'UNK'
      byYear[year][pos] = (byYear[year][pos] ?? 0) + 1
    }
    await prisma.devyClassStrengthSnapshot.upsert({
      where: { sport_seasonYear: { sport, seasonYear } },
      create: { sport, seasonYear, payload: byYear as object },
      update: { payload: byYear as object },
    })
    return {
      ok: true,
      type: 'class_strength_snapshot',
      processedAt,
      message: `Upserted ${sport} ${seasonYear}`,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'class_strength_snapshot', processedAt, error }
  }
}

/** Rankings refresh after promotions/drafts: recompute outlook for affected rosters. */
async function runRankingsRefreshAfterPromotions(payload: DevyJobPayload): Promise<DevyJobResult> {
  const leagueId = payload.leagueId
  const rosterId = payload.rosterId
  const processedAt = new Date().toISOString()
  try {
    if (!leagueId) {
      return { ok: false, type: 'rankings_refresh_after_promotions', processedAt, error: 'leagueId required' }
    }
    if (rosterId) {
      await getDevyTeamOutlook({ leagueId, rosterId })
      return {
        ok: true,
        type: 'rankings_refresh_after_promotions',
        processedAt,
        message: `Refreshed outlook for roster ${rosterId}`,
      }
    }
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { rosters: { select: { id: true } } },
    })
    if (!league) {
      return { ok: false, type: 'rankings_refresh_after_promotions', processedAt, error: 'League not found' }
    }
    for (const r of league.rosters) {
      await getDevyTeamOutlook({ leagueId, rosterId: r.id })
    }
    return {
      ok: true,
      type: 'rankings_refresh_after_promotions',
      processedAt,
      message: `Refreshed ${league.rosters.length} rosters`,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'rankings_refresh_after_promotions', processedAt, error }
  }
}

export async function processDevyJob(payload: DevyJobPayload): Promise<DevyJobResult> {
  const type = payload?.type ?? 'unknown'
  switch (type) {
    case 'ncaa_player_sync':
      return runNcaaPlayerSync(payload)
    case 'declare_status_refresh':
      return runDeclareStatusRefresh(payload)
    case 'auto_graduation_after_draft':
      return runAutoGraduationAfterDraft(payload)
    case 'rookie_pool_generation':
      return runRookiePoolGeneration(payload)
    case 'devy_pool_generation':
      return runDevyPoolGeneration(payload)
    case 'promotion_window_sync':
      return runPromotionWindowSync(payload)
    case 'rookie_draft_exclusion_list':
      return runRookieDraftExclusionList(payload)
    case 'best_ball_lineup_snapshot':
      return runBestBallLineupSnapshot(payload)
    case 'rankings_refresh_after_promotions':
      return runRankingsRefreshAfterPromotions(payload)
    case 'class_strength_snapshot':
      return runClassStrengthSnapshot(payload)
    case 'hybrid_standings_recompute':
      return runHybridStandingsRecompute(payload)
    case 'c2c_pipeline_recalculation':
      return runC2CPipelineRecalculation(payload)
    default:
      return {
        ok: false,
        type,
        processedAt: new Date().toISOString(),
        error: `Unknown devy job type: ${type}`,
      }
  }
}

/** C2C hybrid standings: recompute hybrid standings (read-only; warms any cache). */
async function runHybridStandingsRecompute(payload: DevyJobPayload): Promise<DevyJobResult> {
  const leagueId = payload.leagueId
  const processedAt = new Date().toISOString()
  try {
    if (!leagueId) {
      return { ok: false, type: 'hybrid_standings_recompute', processedAt, error: 'leagueId required' }
    }
    const isC2C = await isC2CLeague(leagueId)
    if (!isC2C) {
      return { ok: true, type: 'hybrid_standings_recompute', processedAt, message: 'Not a C2C league' }
    }
    const result = await getC2CHybridStandings(leagueId)
    return {
      ok: true,
      type: 'hybrid_standings_recompute',
      processedAt,
      message: `Recomputed hybrid standings for ${result.rows.length} rosters`,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'hybrid_standings_recompute', processedAt, error }
  }
}

/** C2C pipeline: recompute college-to-pro outlook for all rosters in a C2C league. */
async function runC2CPipelineRecalculation(payload: DevyJobPayload): Promise<DevyJobResult> {
  const leagueId = payload.leagueId
  const rosterId = payload.rosterId
  const processedAt = new Date().toISOString()
  try {
    if (!leagueId) {
      return { ok: false, type: 'c2c_pipeline_recalculation', processedAt, error: 'leagueId required' }
    }
    const isC2C = await isC2CLeague(leagueId)
    if (!isC2C) {
      return { ok: true, type: 'c2c_pipeline_recalculation', processedAt, message: 'Not a C2C league' }
    }
    const scoringResult = await calculateC2CPointsForLeague({
      leagueId,
      week: typeof payload.week === 'number' ? payload.week : undefined,
      season: payload.seasonYear,
    })
    const promotionResult = await promoteEligiblePlayers({
      leagueId,
      season: payload.seasonYear,
    })
    const isDevy = await isDevyLeague(leagueId)
    if (!isDevy) {
      return {
        ok: scoringResult.ok && promotionResult.ok,
        type: 'c2c_pipeline_recalculation',
        processedAt,
        message: `Recalculated college scoring (${scoringResult.logsWritten ?? 0} logs)`,
      }
    }
    if (rosterId) {
      await getDevyTeamOutlook({ leagueId, rosterId })
      return {
        ok: scoringResult.ok && promotionResult.ok,
        type: 'c2c_pipeline_recalculation',
        processedAt,
        message: `Recalculated pipeline for roster ${rosterId} and wrote ${scoringResult.logsWritten ?? 0} scoring logs`,
      }
    }
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { rosters: { select: { id: true } } },
    })
    if (!league) {
      return { ok: false, type: 'c2c_pipeline_recalculation', processedAt, error: 'League not found' }
    }
    for (const r of league.rosters) {
      await getDevyTeamOutlook({ leagueId, rosterId: r.id })
    }
    return {
      ok: scoringResult.ok && promotionResult.ok,
      type: 'c2c_pipeline_recalculation',
      processedAt,
      message: `Recalculated pipeline for ${league.rosters.length} rosters and wrote ${scoringResult.logsWritten ?? 0} scoring logs`,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, type: 'c2c_pipeline_recalculation', processedAt, error }
  }
}
