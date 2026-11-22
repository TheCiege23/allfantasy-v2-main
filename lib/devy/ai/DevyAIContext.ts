/**
 * PROMPT 5: Deterministic context for Devy AI features. AI never decides outcomes.
 * Used by: scout, promotion advisor, draft assistant, rookie-vs-devy, class storytelling, trade context.
 */

import { prisma } from '@/lib/prisma'
import { getDevyConfig } from '../DevyLeagueConfig'
import { getDevyTeamOutlook } from '../rankings/DevyTeamOutlookService'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { DEVY_LIFECYCLE_STATE } from '../types'

interface DevyAIContextBase {
  leagueId: string
  sport: string
  userId?: string
  rosterId?: string
  config: {
    bestBallEnabled: boolean
    promotionTiming: string
    maxYearlyDevyPromotions: number | null
    devySlotCount: number
    taxiSize: number
    rookieDraftRounds: number
    devyDraftRounds: number
  }
}

export interface DevyScoutContext extends DevyAIContextBase {
  type: 'scout'
  prospect: {
    id: string
    name: string
    position: string
    school: string
    draftEligibleYear: number | null
    draftProjectionScore: number | null
    projectedDraftRound: number | null
    trend: string
    statusConfidence: number
    breakoutAge: number | null
    productionIndex: number | null
    nilImpactScore: number | null
    transferStatus: boolean
  }
}

export interface DevyPromotionAdvisorContext extends DevyAIContextBase {
  type: 'promotion_advisor'
  promotionEligible: Array<{
    rightsId: string
    devyPlayerName: string
    position: string
    school: string
    rosterLegal: boolean
    underPromotionCap: boolean
  }>
  rosterSpotsAvailable: number
  outlook: Awaited<ReturnType<typeof getDevyTeamOutlook>> | null
}

export interface DevyDraftAssistantContext extends DevyAIContextBase {
  type: 'draft_assistant'
  phase: 'startup_vet' | 'rookie' | 'devy'
  round: number
  pick: number
  myRosterCount: number
  devySlotsUsed: number
  devySlotCount: number
  classDepthByYear: Record<number, { qb: number; rb: number; wr: number; te: number }>
  topAvailable?: Array<{ name: string; position: string; school?: string; draftProjectionScore?: number }>
}

export interface DevyClassStorytellingContext extends DevyAIContextBase {
  type: 'class_storytelling'
  classDepthByYear: Record<number, { qb: number; rb: number; wr: number; te: number }>
  sport: string
}

export interface DevyTradeContext extends DevyAIContextBase {
  type: 'trade_context'
  side: 'giving' | 'receiving'
  assets: Array<{ kind: 'devy_player' | 'devy_pick' | 'rookie_pick' | 'pro_player'; label: string }>
  partnerOutlook: { devyRightsCount: number; futureCapitalScore: number } | null
}

/** Rookie-vs-Devy Decision Assistant: compare future devy capital, immediate rookie capital, vet trade options. */
export interface DevyRookieVsDevyContext extends DevyAIContextBase {
  type: 'rookie_vs_devy_decision'
  outlook: Awaited<ReturnType<typeof getDevyTeamOutlook>> | null
  classDepthByYear: Record<number, { qb: number; rb: number; wr: number; te: number }>
  promotionEligibleCount: number
  devyRightsCount: number
}

export type DevyAIContext =
  | DevyScoutContext
  | DevyPromotionAdvisorContext
  | DevyDraftAssistantContext
  | DevyClassStorytellingContext
  | DevyTradeContext
  | DevyRookieVsDevyContext

export async function buildDevyScoutContext(args: {
  leagueId: string
  devyPlayerId: string
  userId?: string
}): Promise<DevyScoutContext | null> {
  const config = await getDevyConfig(args.leagueId)
  if (!config) return null
  const player = await prisma.devyPlayer.findUnique({
    where: { id: args.devyPlayerId },
    select: {
      id: true,
      name: true,
      position: true,
      school: true,
      draftEligibleYear: true,
      draftProjectionScore: true,
      projectedDraftRound: true,
      trend: true,
      statusConfidence: true,
      breakoutAge: true,
      productionIndex: true,
      nilImpactScore: true,
      transferStatus: true,
    },
  })
  if (!player) return null
  return {
    leagueId: args.leagueId,
    sport: config.sport,
    userId: args.userId,
    config: {
      bestBallEnabled: config.bestBallEnabled,
      promotionTiming: config.promotionTiming,
      maxYearlyDevyPromotions: config.maxYearlyDevyPromotions,
      devySlotCount: config.devySlotCount,
      taxiSize: config.taxiSize,
      rookieDraftRounds: config.rookieDraftRounds,
      devyDraftRounds: config.devyDraftRounds,
    },
    type: 'scout',
    prospect: {
      id: player.id,
      name: player.name,
      position: player.position,
      school: player.school,
      draftEligibleYear: player.draftEligibleYear,
      draftProjectionScore: player.draftProjectionScore,
      projectedDraftRound: player.projectedDraftRound,
      trend: player.trend ?? 'stable',
      statusConfidence: player.statusConfidence ?? 0,
      breakoutAge: player.breakoutAge,
      productionIndex: player.productionIndex,
      nilImpactScore: player.nilImpactScore,
      transferStatus: player.transferStatus ?? false,
    },
  }
}

export async function buildDevyPromotionAdvisorContext(args: {
  leagueId: string
  rosterId: string
  userId?: string
}): Promise<DevyPromotionAdvisorContext | null> {
  const [config, rights, league, roster] = await Promise.all([
    getDevyConfig(args.leagueId),
    prisma.devyRights.findMany({
      where: { leagueId: args.leagueId, rosterId: args.rosterId, state: DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE },
      select: { id: true, devyPlayerId: true },
    }),
    prisma.league.findUnique({ where: { id: args.leagueId }, select: { rosterSize: true } }),
    prisma.roster.findUnique({ where: { id: args.rosterId }, select: { playerData: true } }),
  ])
  if (!config) return null
  const rosterSize = league?.rosterSize ?? 22
  const currentCount = roster ? getRosterPlayerIds(roster.playerData).length : 0
  const rosterSpotsAvailable = Math.max(0, rosterSize - currentCount)
  const devyPlayerIds = rights.map((r) => r.devyPlayerId)
  const devyPlayers = await prisma.devyPlayer.findMany({
    where: { id: { in: devyPlayerIds } },
    select: { id: true, name: true, position: true, school: true },
  })
  const devyMap = new Map(devyPlayers.map((p) => [p.id, p]))
  const promotionEligible = rights.map((r) => {
    const p = devyMap.get(r.devyPlayerId)
    return {
      rightsId: r.id,
      devyPlayerName: p?.name ?? r.devyPlayerId,
      position: p?.position ?? '',
      school: p?.school ?? '',
      rosterLegal: rosterSpotsAvailable > 0,
      underPromotionCap: true,
    }
  })
  const outlook = await getDevyTeamOutlook({ leagueId: args.leagueId, rosterId: args.rosterId })
  return {
    leagueId: args.leagueId,
    sport: config.sport,
    userId: args.userId,
    rosterId: args.rosterId,
    config: {
      bestBallEnabled: config.bestBallEnabled,
      promotionTiming: config.promotionTiming,
      maxYearlyDevyPromotions: config.maxYearlyDevyPromotions,
      devySlotCount: config.devySlotCount,
      taxiSize: config.taxiSize,
      rookieDraftRounds: config.rookieDraftRounds,
      devyDraftRounds: config.devyDraftRounds,
    },
    type: 'promotion_advisor',
    promotionEligible,
    rosterSpotsAvailable,
    outlook,
  }
}

export async function buildDevyDraftAssistantContext(args: {
  leagueId: string
  rosterId: string
  phase: 'startup_vet' | 'rookie' | 'devy'
  round: number
  pick: number
  userId?: string
}): Promise<DevyDraftAssistantContext | null> {
  const config = await getDevyConfig(args.leagueId)
  if (!config) return null
  const outlook = await getDevyTeamOutlook({ leagueId: args.leagueId, rosterId: args.rosterId })
  const rights = await prisma.devyRights.count({
    where: { leagueId: args.leagueId, rosterId: args.rosterId },
  })
  const roster = await prisma.roster.findUnique({
    where: { id: args.rosterId },
    select: { playerData: true },
  })
  const myRosterCount = roster ? getRosterPlayerIds(roster.playerData).length : 0
  return {
    leagueId: args.leagueId,
    sport: config.sport,
    userId: args.userId,
    rosterId: args.rosterId,
    config: {
      bestBallEnabled: config.bestBallEnabled,
      promotionTiming: config.promotionTiming,
      maxYearlyDevyPromotions: config.maxYearlyDevyPromotions,
      devySlotCount: config.devySlotCount,
      taxiSize: config.taxiSize,
      rookieDraftRounds: config.rookieDraftRounds,
      devyDraftRounds: config.devyDraftRounds,
    },
    type: 'draft_assistant',
    phase: args.phase,
    round: args.round,
    pick: args.pick,
    myRosterCount,
    devySlotsUsed: rights,
    devySlotCount: config.devySlotCount,
    classDepthByYear: outlook?.classDepthByYear ?? {},
    topAvailable: [],
  }
}

export async function buildDevyTradeContextFromPayload(args: {
  leagueId: string
  side: 'giving' | 'receiving'
  assets: Array<{ kind: 'devy_player' | 'devy_pick' | 'rookie_pick' | 'pro_player'; label: string }>
  partnerRosterId?: string
  userId?: string
}): Promise<DevyTradeContext | null> {
  const config = await getDevyConfig(args.leagueId)
  if (!config) return null
  let partnerOutlook: { devyRightsCount: number; futureCapitalScore: number } | null = null
  if (args.partnerRosterId) {
    const outlook = await getDevyTeamOutlook({ leagueId: args.leagueId, rosterId: args.partnerRosterId })
    if (outlook) partnerOutlook = { devyRightsCount: outlook.outlook.devyRightsCount, futureCapitalScore: outlook.futureCapitalScore }
  }
  return {
    leagueId: args.leagueId,
    sport: config.sport,
    userId: args.userId,
    config: {
      bestBallEnabled: config.bestBallEnabled,
      promotionTiming: config.promotionTiming,
      maxYearlyDevyPromotions: config.maxYearlyDevyPromotions,
      devySlotCount: config.devySlotCount,
      taxiSize: config.taxiSize,
      rookieDraftRounds: config.rookieDraftRounds,
      devyDraftRounds: config.devyDraftRounds,
    },
    type: 'trade_context',
    side: args.side,
    assets: args.assets,
    partnerOutlook,
  }
}

export async function buildDevyRookieVsDevyContext(args: {
  leagueId: string
  rosterId: string
  userId?: string
}): Promise<DevyRookieVsDevyContext | null> {
  const config = await getDevyConfig(args.leagueId)
  if (!config) return null
  const outlook = await getDevyTeamOutlook({ leagueId: args.leagueId, rosterId: args.rosterId })
  const rights = await prisma.devyRights.findMany({
    where: { leagueId: args.leagueId, rosterId: args.rosterId },
    select: { state: true },
  })
  const promotionEligibleCount = rights.filter((r) => r.state === DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE).length
  const players = await prisma.devyPlayer.findMany({
    where: { devyEligible: true, graduatedToNFL: false },
    select: { draftEligibleYear: true, position: true },
    take: 500,
  })
  const byYear: Record<number, { qb: number; rb: number; wr: number; te: number }> = {}
  for (const p of players) {
    const year = p.draftEligibleYear ?? new Date().getFullYear()
    if (!byYear[year]) byYear[year] = { qb: 0, rb: 0, wr: 0, te: 0 }
    const pos = (p.position || '').toUpperCase()
    if (pos === 'QB') byYear[year].qb++
    else if (pos === 'RB') byYear[year].rb++
    else if (pos === 'WR') byYear[year].wr++
    else if (pos === 'TE') byYear[year].te++
  }
  return {
    leagueId: args.leagueId,
    sport: config.sport,
    userId: args.userId,
    rosterId: args.rosterId,
    config: {
      bestBallEnabled: config.bestBallEnabled,
      promotionTiming: config.promotionTiming,
      maxYearlyDevyPromotions: config.maxYearlyDevyPromotions,
      devySlotCount: config.devySlotCount,
      taxiSize: config.taxiSize,
      rookieDraftRounds: config.rookieDraftRounds,
      devyDraftRounds: config.devyDraftRounds,
    },
    type: 'rookie_vs_devy_decision',
    outlook,
    classDepthByYear: byYear,
    promotionEligibleCount,
    devyRightsCount: rights.length,
  }
}

export async function buildDevyClassStorytellingContext(args: {
  leagueId: string
  userId?: string
}): Promise<DevyClassStorytellingContext | null> {
  const config = await getDevyConfig(args.leagueId)
  if (!config) return null
  const players = await prisma.devyPlayer.findMany({
    where: { devyEligible: true, graduatedToNFL: false },
    select: { draftEligibleYear: true, position: true },
    take: 500,
  })
  const byYear: Record<number, { qb: number; rb: number; wr: number; te: number }> = {}
  for (const p of players) {
    const year = p.draftEligibleYear ?? new Date().getFullYear()
    if (!byYear[year]) byYear[year] = { qb: 0, rb: 0, wr: 0, te: 0 }
    const pos = (p.position || '').toUpperCase()
    if (pos === 'QB') byYear[year].qb++
    else if (pos === 'RB') byYear[year].rb++
    else if (pos === 'WR') byYear[year].wr++
    else if (pos === 'TE') byYear[year].te++
  }
  return {
    leagueId: args.leagueId,
    sport: config.sport,
    userId: args.userId,
    config: {
      bestBallEnabled: config.bestBallEnabled,
      promotionTiming: config.promotionTiming,
      maxYearlyDevyPromotions: config.maxYearlyDevyPromotions,
      devySlotCount: config.devySlotCount,
      taxiSize: config.taxiSize,
      rookieDraftRounds: config.rookieDraftRounds,
      devyDraftRounds: config.devyDraftRounds,
    },
    type: 'class_storytelling',
    classDepthByYear: byYear,
  }
}
