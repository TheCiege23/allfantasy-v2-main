/**
 * PROMPT 5: Deterministic context for C2C AI features. AI never decides outcomes.
 * Pipeline Advisor, College vs Rookie Decision, Startup Draft Assistant, Promotion Advisor,
 * Hybrid Strategy, C2C Trade Context. All use deterministic data only.
 */

import { prisma } from '@/lib/prisma'
import { getC2CConfig } from '../C2CLeagueConfig'
import { getC2CStandings, getC2CHybridStandings, computeHybridScore } from '../standings/C2CStandingsService'
import { checkC2CPromotionEligibility } from '../promotion/C2CPromotionService'
import { getDevyTeamOutlook } from '@/lib/devy/rankings/DevyTeamOutlookService'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { isDevyLeague } from '@/lib/devy'
import { DEVY_LIFECYCLE_STATE } from '@/lib/devy/types'
import { C2C_LIFECYCLE_STATE } from '../types'

const PROMOTION_ELIGIBLE_STATES = [DEVY_LIFECYCLE_STATE.PROMOTION_ELIGIBLE, C2C_LIFECYCLE_STATE.PROMOTION_ELIGIBLE] as const
const isPromotionEligibleState = (s: string) => (PROMOTION_ELIGIBLE_STATES as readonly string[]).includes(s)

interface C2CAIContextBase {
  leagueId: string
  sport: string
  userId?: string
  rosterId?: string
  config: {
    startupFormat: 'merged' | 'separate'
    standingsModel: 'unified' | 'separate' | 'hybrid'
    hybridProWeight: number
    hybridCollegeWeight: number
    promotionTiming: string
    maxPromotionsPerYear: number | null
    collegeRosterSize: number
    rookieDraftRounds: number
    collegeDraftRounds: number
    bestBallPro: boolean
    bestBallCollege: boolean
  }
}

/** Pipeline Advisor: health of college-to-pro pipeline, asset flow, bottlenecks, concentration. */
export interface C2CPipelineAdvisorContext extends C2CAIContextBase {
  type: 'pipeline_advisor'
  rosterId: string
  portfolio: {
    proAssetCount: number
    collegeRightsCount: number
    promotionEligibleCount: number
    futureCapitalScore: number
    devyInventoryScore: number
    classDepthByYear: Record<number, { qb?: number; rb?: number; wr?: number; te?: number; [k: string]: number | undefined }>
  }
  concentration: {
    maxPositionShare: number
    maxYearShare: number
    positionsByYear: Record<number, Record<string, number>>
  }
}

/** College vs Rookie Decision Assistant: compare college assets, rookie picks, timeline, risk. */
export interface C2CCollegeVsRookieContext extends C2CAIContextBase {
  type: 'college_vs_rookie_decision'
  rosterId: string
  collegeRightsCount: number
  promotionEligibleCount: number
  futurePicksRookie: number
  futurePicksCollege: number
  outlook: { futureCapitalScore: number; devyInventoryScore: number; proAssetCount: number; promotedThisYear: number } | null
  classDepthByYear: Record<number, Record<string, number>>
}

/** C2C Startup Draft Assistant: merged/split, pro vs college upside, contender/rebuilder. */
export interface C2CStartupDraftAssistantContext extends C2CAIContextBase {
  type: 'startup_draft_assistant'
  rosterId: string
  phase: 'startup_merged' | 'startup_pro' | 'startup_college' | 'rookie' | 'college'
  round: number
  pick: number
  direction: 'contender' | 'rebuilder' | 'balanced'
  myProCount: number
  myCollegeCount: number
  classDepthByYear: Record<number, Record<string, number>>
}

/** Promotion Advisor: promote now vs later, standings impact, opportunity cost. */
export interface C2CPromotionAdvisorContext extends C2CAIContextBase {
  type: 'promotion_advisor'
  rosterId: string
  promotionEligible: Array<{
    rightsId: string
    devyPlayerName: string
    position: string
    school: string
    rosterLegal: boolean
    underPromotionCap: boolean
  }>
  rosterSpotsAvailable: number
  standingsImpact: { proRank?: number; collegeRank?: number; hybridRank?: number; proPoints: number; collegePoints: number } | null
}

/** Hybrid Championship Strategy: underbuilt college vs pro, deterministic weighting. */
export interface C2CHybridStrategyContext extends C2CAIContextBase {
  type: 'hybrid_strategy'
  rosterId: string
  proPoints: number
  collegePoints: number
  hybridScore: number
  proWeight: number
  collegeWeight: number
  leagueRanks: Array<{ rosterId: string; hybridScore: number; rank: number }>
  underbuiltSide: 'pro' | 'college' | 'balanced'
}

/** C2C Trade Context: long-horizon trades, college vs pro upside, class-strength, pipeline timing. */
export interface C2CTradeContext extends C2CAIContextBase {
  type: 'trade_context'
  side: 'giving' | 'receiving'
  assets: Array<{ kind: string; label: string }>
  partnerRosterId?: string
  partnerOutlook: { collegeRightsCount: number; futureCapitalScore: number } | null
}

export type C2CAIContext =
  | C2CPipelineAdvisorContext
  | C2CCollegeVsRookieContext
  | C2CStartupDraftAssistantContext
  | C2CPromotionAdvisorContext
  | C2CHybridStrategyContext
  | C2CTradeContext

function configBase(c: NonNullable<Awaited<ReturnType<typeof getC2CConfig>>>): C2CAIContextBase['config'] {
  const proWeight = (c as any).hybridProWeight ?? 60
  const collegeWeight = 100 - proWeight
  return {
    startupFormat: c.startupFormat ?? 'merged',
    standingsModel: c.standingsModel ?? 'unified',
    hybridProWeight: proWeight,
    hybridCollegeWeight: collegeWeight,
    promotionTiming: c.promotionTiming ?? 'manager_choice_before_rookie_draft',
    maxPromotionsPerYear: c.maxPromotionsPerYear ?? null,
    collegeRosterSize: c.collegeRosterSize ?? 10,
    rookieDraftRounds: c.rookieDraftRounds ?? 5,
    collegeDraftRounds: c.collegeDraftRounds ?? 5,
    bestBallPro: c.bestBallPro ?? true,
    bestBallCollege: c.bestBallCollege ?? false,
  }
}

export async function buildC2CPipelineAdvisorContext(args: {
  leagueId: string
  rosterId: string
  userId?: string
}): Promise<C2CPipelineAdvisorContext | null> {
  const config = await getC2CConfig(args.leagueId)
  if (!config) return null

  const [rights, roster, outlook] = await Promise.all([
    prisma.devyRights.findMany({
      where: { leagueId: args.leagueId, rosterId: args.rosterId },
      select: { id: true, state: true, devyPlayerId: true },
    }),
    prisma.roster.findUnique({
      where: { id: args.rosterId },
      select: { playerData: true },
    }),
    isDevyLeague(args.leagueId).then((ok) => (ok ? getDevyTeamOutlook({ leagueId: args.leagueId, rosterId: args.rosterId }) : null)),
  ])

  const proCount = roster ? getRosterPlayerIds(roster.playerData).length : 0
  const promotionEligibleCount = rights.filter((r) => isPromotionEligibleState(r.state)).length
  const devyPlayerIds = rights.map((r) => r.devyPlayerId)
  const devyPlayers = await prisma.devyPlayer.findMany({
    where: { id: { in: devyPlayerIds } },
    select: { id: true, position: true, draftEligibleYear: true },
  })
  const devyMap = new Map(devyPlayers.map((p) => [p.id, p]))

  const classDepthByYear: Record<number, Record<string, number>> = {}
  for (const r of rights) {
    const p = devyMap.get(r.devyPlayerId)
    const year = p?.draftEligibleYear ?? new Date().getFullYear()
    const pos = (p?.position ?? 'UNK').toLowerCase()
    if (!classDepthByYear[year]) classDepthByYear[year] = {}
    classDepthByYear[year][pos] = (classDepthByYear[year][pos] ?? 0) + 1
  }

  const totalRights = rights.length
  let maxPositionShare = 0
  let maxYearShare = 0
  const positionsByYear: Record<number, Record<string, number>> = {}
  for (const [year, posCounts] of Object.entries(classDepthByYear)) {
    const y = Number(year)
    positionsByYear[y] = posCounts
    const yearTotal = Object.values(posCounts).reduce((s, n) => s + n, 0)
    if (totalRights > 0) maxYearShare = Math.max(maxYearShare, yearTotal / totalRights)
    for (const count of Object.values(posCounts)) {
      if (totalRights > 0) maxPositionShare = Math.max(maxPositionShare, count / totalRights)
    }
  }

  return {
    leagueId: args.leagueId,
    sport: config.sport,
    userId: args.userId,
    rosterId: args.rosterId,
    config: configBase(config),
    type: 'pipeline_advisor',
    portfolio: {
      proAssetCount: proCount,
      collegeRightsCount: rights.length,
      promotionEligibleCount,
      futureCapitalScore: outlook?.futureCapitalScore ?? 0,
      devyInventoryScore: outlook?.devyInventoryScore ?? 0,
      classDepthByYear,
    },
    concentration: {
      maxPositionShare,
      maxYearShare,
      positionsByYear,
    },
  }
}

export async function buildC2CCollegeVsRookieContext(args: {
  leagueId: string
  rosterId: string
  userId?: string
}): Promise<C2CCollegeVsRookieContext | null> {
  const config = await getC2CConfig(args.leagueId)
  if (!config) return null

  const outlook = await isDevyLeague(args.leagueId).then((ok) =>
    ok ? getDevyTeamOutlook({ leagueId: args.leagueId, rosterId: args.rosterId }) : null
  )
  const rights = await prisma.devyRights.findMany({
    where: { leagueId: args.leagueId, rosterId: args.rosterId },
    select: { state: true, devyPlayerId: true },
  })
  const promotionEligibleCount = rights.filter((r) => isPromotionEligibleState(r.state)).length
  const devyPlayerIds = rights.map((r) => r.devyPlayerId)
  const devyPlayers = await prisma.devyPlayer.findMany({
    where: { id: { in: devyPlayerIds } },
    select: { position: true, draftEligibleYear: true },
  })
  const classDepthByYear: Record<number, Record<string, number>> = {}
  for (const p of devyPlayers) {
    const year = p.draftEligibleYear ?? new Date().getFullYear()
    const pos = (p.position ?? 'UNK').toLowerCase()
    if (!classDepthByYear[year]) classDepthByYear[year] = {}
    classDepthByYear[year][pos] = (classDepthByYear[year][pos] ?? 0) + 1
  }

  return {
    leagueId: args.leagueId,
    sport: config.sport,
    userId: args.userId,
    rosterId: args.rosterId,
    config: configBase(config),
    type: 'college_vs_rookie_decision',
    collegeRightsCount: rights.length,
    promotionEligibleCount,
    futurePicksRookie: 0,
    futurePicksCollege: 0,
    outlook: outlook
      ? {
          futureCapitalScore: outlook.futureCapitalScore,
          devyInventoryScore: outlook.devyInventoryScore,
          proAssetCount: outlook.outlook.proAssetCount,
          promotedThisYear: outlook.outlook.promotedThisYear,
        }
      : null,
    classDepthByYear,
  }
}

export async function buildC2CStartupDraftAssistantContext(args: {
  leagueId: string
  rosterId: string
  phase: string
  round: number
  pick: number
  direction?: 'contender' | 'rebuilder' | 'balanced'
  userId?: string
}): Promise<C2CStartupDraftAssistantContext | null> {
  const config = await getC2CConfig(args.leagueId)
  if (!config) return null

  const [roster, rights] = await Promise.all([
    prisma.roster.findUnique({
      where: { id: args.rosterId },
      select: { playerData: true },
    }),
    prisma.devyRights.findMany({
      where: { leagueId: args.leagueId, rosterId: args.rosterId },
      select: { devyPlayerId: true },
    }),
  ])
  const devyPlayerIds = rights.map((r) => r.devyPlayerId)
  const devyPlayers = await prisma.devyPlayer.findMany({
    where: { id: { in: devyPlayerIds } },
    select: { position: true, draftEligibleYear: true },
  })
  const classDepthByYear: Record<number, Record<string, number>> = {}
  for (const p of devyPlayers) {
    const year = p.draftEligibleYear ?? new Date().getFullYear()
    const pos = (p.position ?? 'UNK').toLowerCase()
    if (!classDepthByYear[year]) classDepthByYear[year] = {}
    classDepthByYear[year][pos] = (classDepthByYear[year][pos] ?? 0) + 1
  }

  const myProCount = roster ? getRosterPlayerIds(roster.playerData).length : 0
  const myCollegeCount = rights.length

  return {
    leagueId: args.leagueId,
    sport: config.sport,
    userId: args.userId,
    rosterId: args.rosterId,
    config: configBase(config),
    type: 'startup_draft_assistant',
    phase: args.phase as C2CStartupDraftAssistantContext['phase'],
    round: args.round,
    pick: args.pick,
    direction: args.direction ?? 'balanced',
    myProCount,
    myCollegeCount,
    classDepthByYear,
  }
}

export async function buildC2CPromotionAdvisorContext(args: {
  leagueId: string
  rosterId: string
  userId?: string
}): Promise<C2CPromotionAdvisorContext | null> {
  const config = await getC2CConfig(args.leagueId)
  if (!config) return null

  const seasonYear = new Date().getFullYear()
  const [rights, league, roster, standings] = await Promise.all([
    prisma.devyRights.findMany({
      where: {
        leagueId: args.leagueId,
        rosterId: args.rosterId,
        state: { in: [...PROMOTION_ELIGIBLE_STATES] },
      },
      select: { id: true, devyPlayerId: true },
    }),
    prisma.league.findUnique({
      where: { id: args.leagueId },
      select: { settings: true },
    }),
    prisma.roster.findUnique({
      where: { id: args.rosterId },
      select: { playerData: true },
    }),
    config.standingsModel === 'hybrid'
      ? getC2CHybridStandings(args.leagueId)
      : getC2CStandings(args.leagueId),
  ])

  const settings = (league?.settings as Record<string, unknown>) ?? {}
  const rosterSize = typeof settings.rosterSize === 'number' ? settings.rosterSize : 22
  const currentCount = roster ? getRosterPlayerIds(roster.playerData).length : 0
  const rosterSpotsAvailable = Math.max(0, rosterSize - currentCount)

  const devyPlayerIds = rights.map((r) => r.devyPlayerId)
  const devyPlayers = await prisma.devyPlayer.findMany({
    where: { id: { in: devyPlayerIds } },
    select: { id: true, name: true, position: true, school: true },
  })
  const devyMap = new Map(devyPlayers.map((p) => [p.id, p]))

  const promotionEligible: C2CPromotionAdvisorContext['promotionEligible'] = []
  for (const r of rights) {
    const elig = await checkC2CPromotionEligibility({
      leagueId: args.leagueId,
      rosterId: args.rosterId,
      rightsId: r.id,
      seasonYear,
    })
    const p = devyMap.get(r.devyPlayerId)
    promotionEligible.push({
      rightsId: r.id,
      devyPlayerName: p?.name ?? r.devyPlayerId,
      position: p?.position ?? '',
      school: p?.school ?? '',
      rosterLegal: elig.rosterLegal,
      underPromotionCap: elig.underPromotionCap,
    })
  }

  let standingsImpact: C2CPromotionAdvisorContext['standingsImpact'] = null
  if (standings && 'rows' in standings) {
    const rows = standings.rows as Array<{ rosterId: string; proPoints?: number; collegePoints?: number }>
    const myRow = rows.find((row) => row.rosterId === args.rosterId)
    if (myRow) {
      const sep = standings as { pro?: Array<{ rosterId: string }>; college?: Array<{ rosterId: string }> }
      const proRank = sep.pro?.findIndex((r) => r.rosterId === args.rosterId)
      const collegeRank = sep.college?.findIndex((r) => r.rosterId === args.rosterId)
      const hybridRank = rows.findIndex((r) => r.rosterId === args.rosterId)
      standingsImpact = {
        proRank: proRank !== undefined && proRank >= 0 ? proRank + 1 : undefined,
        collegeRank: collegeRank !== undefined && collegeRank >= 0 ? collegeRank + 1 : undefined,
        hybridRank: hybridRank >= 0 ? hybridRank + 1 : undefined,
        proPoints: myRow.proPoints ?? 0,
        collegePoints: myRow.collegePoints ?? 0,
      }
    }
  }

  return {
    leagueId: args.leagueId,
    sport: config.sport,
    userId: args.userId,
    rosterId: args.rosterId,
    config: configBase(config),
    type: 'promotion_advisor',
    promotionEligible,
    rosterSpotsAvailable,
    standingsImpact,
  }
}

export async function buildC2CHybridStrategyContext(args: {
  leagueId: string
  rosterId: string
  userId?: string
}): Promise<C2CHybridStrategyContext | null> {
  const config = await getC2CConfig(args.leagueId)
  if (!config || config.standingsModel !== 'hybrid') return null

  const hybrid = await getC2CHybridStandings(args.leagueId)

  const myRow = hybrid.rows.find((r) => r.rosterId === args.rosterId)
  if (!myRow) return null

  const hybridScore = computeHybridScore(
    myRow.proPoints,
    myRow.collegePoints,
    hybrid.proWeight,
    hybrid.collegeWeight
  )
  const leagueRanks = hybrid.rows
    .map((r) => ({
      rosterId: r.rosterId,
      hybridScore: computeHybridScore(r.proPoints, r.collegePoints, hybrid.proWeight, hybrid.collegeWeight),
      rank: 0,
    }))
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .map((r, i) => ({ ...r, rank: i + 1 }))

  const avgPro = hybrid.rows.reduce((s, r) => s + r.proPoints, 0) / Math.max(1, hybrid.rows.length)
  const avgCollege = hybrid.rows.reduce((s, r) => s + r.collegePoints, 0) / Math.max(1, hybrid.rows.length)
  let underbuiltSide: 'pro' | 'college' | 'balanced' = 'balanced'
  if (myRow.proPoints < avgPro * 0.8 && myRow.collegePoints >= avgCollege * 0.9) underbuiltSide = 'pro'
  else if (myRow.collegePoints < avgCollege * 0.8 && myRow.proPoints >= avgPro * 0.9) underbuiltSide = 'college'

  return {
    leagueId: args.leagueId,
    sport: config.sport,
    userId: args.userId,
    rosterId: args.rosterId,
    config: configBase(config),
    type: 'hybrid_strategy',
    proPoints: myRow.proPoints,
    collegePoints: myRow.collegePoints,
    hybridScore,
    proWeight: hybrid.proWeight,
    collegeWeight: hybrid.collegeWeight,
    leagueRanks,
    underbuiltSide,
  }
}

export async function buildC2CTradeContextFromPayload(args: {
  leagueId: string
  side: 'giving' | 'receiving'
  assets: Array<{ kind: string; label: string }>
  partnerRosterId?: string
  userId?: string
}): Promise<C2CTradeContext | null> {
  const config = await getC2CConfig(args.leagueId)
  if (!config) return null

  let partnerOutlook: C2CTradeContext['partnerOutlook'] = null
  if (args.partnerRosterId) {
    const outlook = await isDevyLeague(args.leagueId).then((ok) =>
      ok ? getDevyTeamOutlook({ leagueId: args.leagueId, rosterId: args.partnerRosterId! }) : null
    )
    const rightsCount = await prisma.devyRights.count({
      where: { leagueId: args.leagueId, rosterId: args.partnerRosterId },
    })
    partnerOutlook = {
      collegeRightsCount: rightsCount,
      futureCapitalScore: outlook?.futureCapitalScore ?? 0,
    }
  }

  return {
    leagueId: args.leagueId,
    sport: config.sport,
    userId: args.userId,
    config: configBase(config),
    type: 'trade_context',
    side: args.side,
    assets: args.assets.map((a) => ({ kind: a.kind, label: a.label })),
    partnerRosterId: args.partnerRosterId,
    partnerOutlook,
  }
}
