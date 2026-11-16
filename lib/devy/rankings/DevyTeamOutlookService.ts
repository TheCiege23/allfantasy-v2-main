/**
 * PROMPT 4: Rankings / future capital / portfolio for Devy Dynasty.
 * Future capital score, devy inventory score, class depth by year, promotion probability,
 * contender vs rebuilder weighting, year1/3/5 portfolio projection, team outlook (pro + devy rights + future picks).
 */

import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { getDevyConfig } from '../DevyLeagueConfig'
import { DEVY_LIFECYCLE_STATE } from '../types'

export interface DevyTeamOutlook {
  rosterId: string
  leagueId: string
  futureCapitalScore: number
  devyInventoryScore: number
  classDepthByYear: Record<number, { qb: number; rb: number; wr: number; te: number }>
  promotionProbabilityWeighted: number
  contenderScore: number
  rebuilderScore: number
  portfolioProjection: { year1: number; year3: number; year5: number; volatilityBand: number }
  outlook: {
    proAssetCount: number
    devyRightsCount: number
    futurePicksCount: number
    promotedThisYear: number
  }
}

function devyGraduationProbability(projectedRound: number | undefined): number {
  if (projectedRound == null) return 0.3
  if (projectedRound === 1) return 0.9
  if (projectedRound === 2) return 0.75
  if (projectedRound === 3) return 0.6
  return 0.4
}

/**
 * Compute future capital score from roster: picks + devy value (projected).
 */
export function computeFutureCapitalScore(args: {
  proPlayerCount: number
  devyRightsWithProjection: Array<{ draftProjectionScore?: number | null; projectedDraftRound?: number | null }>
  futurePickValue?: number
}): number {
  let total = 0
  for (const d of args.devyRightsWithProjection) {
    const proj = d.draftProjectionScore ?? 50
    const prob = devyGraduationProbability(d.projectedDraftRound ?? undefined)
    total += proj * 0.6 * prob
  }
  if (args.futurePickValue != null) total += args.futurePickValue * 0.5
  return Math.min(100, Math.round(total / 5))
}

/**
 * Devy inventory score: quality and quantity of devy rights.
 */
export function computeDevyInventoryScore(
  devyRightsWithProjection: Array<{ draftProjectionScore?: number | null; projectedDraftRound?: number | null; state: string }>
): number {
  let score = 0
  const active = devyRightsWithProjection.filter(
    (r) =>
      r.state === DEVY_LIFECYCLE_STATE.NCAA_DEVY_ACTIVE ||
      r.state === DEVY_LIFECYCLE_STATE.NCAA_DEVY_TAXI ||
      r.state === DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE ||
      r.state === DEVY_LIFECYCLE_STATE.DRAFTED_RIGHTS_HELD
  )
  for (const r of active) {
    const proj = r.draftProjectionScore ?? 50
    const prob = devyGraduationProbability(r.projectedDraftRound ?? undefined)
    score += proj * prob
  }
  return Math.min(100, Math.round(score / 3))
}

/**
 * Class depth by draft-eligible year (from devy players).
 */
export function computeClassDepthByYear(
  devyPlayers: Array<{ draftEligibleYear?: number | null; position: string }>
): Record<number, { qb: number; rb: number; wr: number; te: number }> {
  const byYear: Record<number, { qb: number; rb: number; wr: number; te: number }> = {}
  for (const p of devyPlayers) {
    const year = p.draftEligibleYear ?? new Date().getFullYear()
    if (!byYear[year]) byYear[year] = { qb: 0, rb: 0, wr: 0, te: 0 }
    const pos = (p.position || '').toUpperCase()
    if (pos === 'QB') byYear[year].qb++
    else if (pos === 'RB') byYear[year].rb++
    else if (pos === 'WR') byYear[year].wr++
    else if (pos === 'TE') byYear[year].te++
  }
  return byYear
}

/**
 * Full team outlook for a roster in a devy league.
 */
export async function getDevyTeamOutlook(args: {
  leagueId: string
  rosterId: string
}): Promise<DevyTeamOutlook | null> {
  const config = await getDevyConfig(args.leagueId)
  if (!config) return null

  const [rights, roster] = await Promise.all([
    prisma.devyRights.findMany({
      where: { leagueId: args.leagueId, rosterId: args.rosterId },
      select: { id: true, state: true, devyPlayerId: true },
    }),
    prisma.roster.findUnique({
      where: { id: args.rosterId },
      select: { playerData: true },
    }),
    prisma.league.findUnique({
      where: { id: args.leagueId },
      select: { rosterSize: true },
    }),
  ])

  const devyPlayerIds = rights.map((r) => r.devyPlayerId)
  const devyPlayers = await prisma.devyPlayer.findMany({
    where: { id: { in: devyPlayerIds } },
    select: { id: true, draftProjectionScore: true, projectedDraftRound: true, draftEligibleYear: true, position: true },
  })
  const devyMap = new Map(devyPlayers.map((p) => [p.id, p]))

  const rightsWithProj = rights.map((r) => {
    const p = devyMap.get(r.devyPlayerId)
    return {
      draftProjectionScore: p?.draftProjectionScore,
      projectedDraftRound: p?.projectedDraftRound,
      state: r.state,
    }
  })

  const proPlayerIds = getRosterPlayerIds(roster?.playerData ?? null)
  const proCount = proPlayerIds.length

  const futureCapitalScore = computeFutureCapitalScore({
    proPlayerCount: proCount,
    devyRightsWithProjection: rightsWithProj,
  })
  const devyInventoryScore = computeDevyInventoryScore(rightsWithProj)
  const classDepthByYear = computeClassDepthByYear(
    rights.map((r) => {
      const p = devyMap.get(r.devyPlayerId)
      return { draftEligibleYear: p?.draftEligibleYear, position: p?.position ?? '' }
    })
  )

  const promotionProb = rightsWithProj.length
    ? rightsWithProj.reduce((s, r) => s + devyGraduationProbability(r.projectedDraftRound ?? undefined), 0) / rightsWithProj.length
    : 0
  const promotedThisYear = rights.filter((r) => r.state === DEVY_LIFECYCLE_STATE.PROMOTED_TO_PRO).length

  const portfolioYear1 = 50 + (futureCapitalScore / 100) * 25
  const portfolioYear3 = 45 + (devyInventoryScore / 100) * 35
  const portfolioYear5 = 40 + (promotionProb * 30)

  return {
    rosterId: args.rosterId,
    leagueId: args.leagueId,
    futureCapitalScore,
    devyInventoryScore,
    classDepthByYear,
    promotionProbabilityWeighted: Math.round(promotionProb * 100),
    contenderScore: 50,
    rebuilderScore: 50,
    portfolioProjection: {
      year1: Math.round(portfolioYear1),
      year3: Math.round(portfolioYear3),
      year5: Math.round(portfolioYear5),
      volatilityBand: 15,
    },
    outlook: {
      proAssetCount: proCount,
      devyRightsCount: rights.length,
      futurePicksCount: 0,
      promotedThisYear,
    },
  }
}
