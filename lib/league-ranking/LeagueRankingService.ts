/**
 * League Ranking System (PROMPT 220).
 * Ranks leagues by activity and quality; outputs a league popularity score.
 * Metrics: league activity, chat activity, trade frequency, draft participation, manager retention.
 */

import type { LeagueSport } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import type {
  LeagueRankingMetrics,
  LeaguePopularityScore,
  RankedLeague,
} from "./types"

/** Weights for composite popularity score (sum = 1). */
const WEIGHTS = {
  leagueActivity: 0.3,
  chatActivity: 0.2,
  tradeFrequency: 0.2,
  draftParticipation: 0.15,
  managerRetention: 0.15,
} as const

const DEFAULT_RECENT_DAYS = 30
const DEFAULT_RETENTION_DAYS = 45
const ACTIVE_DRAFT_STATUSES = new Set(["pre_draft", "in_progress", "paused"])

/** Normalize a value to 0-1 with cap. */
function normalize(value: number, cap: number): number {
  if (cap <= 0) return 0
  if (value <= 0) return 0
  return Math.min(1, value / cap)
}

function clamp(value: number, min: number = 0, max: number = 1): number {
  return Math.max(min, Math.min(max, value))
}

/** Recency score: 1 at now, exponential decay over days. */
function recencyScore(lastAt: Date | null, halfLifeDays: number = 21): number {
  if (!lastAt) return 0
  const now = Date.now()
  const elapsed = (now - lastAt.getTime()) / (1000 * 60 * 60 * 24)
  return clamp(Math.exp(-(elapsed * Math.LN2) / halfLifeDays))
}

function normalizeRecentDays(recentDays?: number): number {
  if (!recentDays || Number.isNaN(recentDays)) return DEFAULT_RECENT_DAYS
  return Math.max(7, Math.min(180, Math.floor(recentDays)))
}

function toMaxDate(values: Array<Date | null | undefined>): Date | null {
  const valid = values.filter((value): value is Date => value instanceof Date)
  if (valid.length === 0) return null
  return new Date(Math.max(...valid.map((value) => value.getTime())))
}

async function safeGroupByModel(modelName: string, args: Record<string, unknown>): Promise<Array<Record<string, any>>> {
  const model = (prisma as any)[modelName]
  if (!model || typeof model.groupBy !== "function") return []
  try {
    return await model.groupBy(args)
  } catch {
    return []
  }
}

type DraftAggregate = {
  hasCompletedDraft: boolean
  pickCount: number
  sessionCount: number
  activeSessionCount: number
  recentActivitySignal: number
  lastAt: Date | null
}

function getLeagueActivitySignal(input: {
  chatMessageCount: number
  transactionCount: number
  tradeFrequencyCount: number
  draftRecentSignal: number
}): number {
  return (
    input.chatMessageCount +
    input.transactionCount +
    input.tradeFrequencyCount +
    input.draftRecentSignal
  )
}

/**
 * Load raw metrics for a set of leagues (or all leagues).
 * Uses Prisma aggregates and optional date window for "recent" activity.
 */
async function getLeagueMetrics(
  options: { leagueIds?: string[]; recentDays?: number } = {}
): Promise<Map<string, LeagueRankingMetrics>> {
  const { leagueIds, recentDays } = options
  const resolvedRecentDays = normalizeRecentDays(recentDays)
  const whereLeague = leagueIds && leagueIds.length > 0 ? { id: { in: leagueIds } } : {}

  const leagues = await prisma.league.findMany({
    where: whereLeague,
    select: {
      id: true,
      name: true,
      sport: true,
      leagueSize: true,
      createdAt: true,
      updatedAt: true,
      lastSyncedAt: true,
      _count: {
        select: {
          chatMessages: true,
          waiverTransactions: true,
          rosters: true,
        },
      },
    },
  })

  const leagueIdList = leagues.map((l) => l.id)
  if (leagueIdList.length === 0) return new Map()

  const since = new Date(Date.now() - resolvedRecentDays * 24 * 60 * 60 * 1000)
  const retentionCutoff = new Date(Date.now() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000)

  const [
    chatCounts,
    chatActiveManagers,
    transactionCounts,
    retainedManagerRows,
    draftData,
    tradeOfferCounts,
    tradeOutcomeCounts,
    tradeOfferParticipantsSender,
    tradeOfferParticipantsOpponent,
  ] = await Promise.all([
    prisma.leagueChatMessage.groupBy({
      by: ["leagueId"],
      where: {
        leagueId: { in: leagueIdList },
        createdAt: { gte: since },
      },
      _count: { id: true },
    }),
    prisma.leagueChatMessage.groupBy({
      by: ["leagueId", "userId"],
      where: {
        leagueId: { in: leagueIdList },
        createdAt: { gte: since },
      },
      _count: { id: true },
    }),
    prisma.waiverTransaction.groupBy({
      by: ["leagueId"],
      where: {
        leagueId: { in: leagueIdList },
        processedAt: { gte: since },
      },
      _count: { id: true },
    }),
    prisma.roster.groupBy({
      by: ["leagueId"],
      where: {
        leagueId: { in: leagueIdList },
        createdAt: { lte: retentionCutoff },
      },
      _count: { id: true },
    }),
    prisma.draftSession.findMany({
      where: { leagueId: { in: leagueIdList } },
      select: {
        leagueId: true,
        status: true,
        updatedAt: true,
        _count: { select: { picks: true } },
      },
    }),
    safeGroupByModel("tradeOfferEvent", {
      by: ["leagueId"],
      where: {
        leagueId: { in: leagueIdList },
        createdAt: { gte: since },
      },
      _count: { id: true },
    }),
    safeGroupByModel("tradeOutcomeEvent", {
      by: ["leagueId"],
      where: {
        leagueId: { in: leagueIdList },
        createdAt: { gte: since },
        outcome: { in: ["ACCEPTED", "COUNTERED"] },
      },
      _count: { id: true },
    }),
    safeGroupByModel("tradeOfferEvent", {
      by: ["leagueId", "senderUserId"],
      where: {
        leagueId: { in: leagueIdList },
        createdAt: { gte: since },
        senderUserId: { not: null },
      },
      _count: { id: true },
    }),
    safeGroupByModel("tradeOfferEvent", {
      by: ["leagueId", "opponentUserId"],
      where: {
        leagueId: { in: leagueIdList },
        createdAt: { gte: since },
        opponentUserId: { not: null },
      },
      _count: { id: true },
    }),
  ])

  const chatByLeague = new Map(chatCounts.map((row) => [String(row.leagueId), Number(row._count.id)]))
  const txByLeague = new Map(transactionCounts.map((row) => [String(row.leagueId), Number(row._count.id)]))
  const retainedByLeague = new Map(retainedManagerRows.map((row) => [String(row.leagueId), Number(row._count.id)]))
  const tradeOfferByLeague = new Map(
    tradeOfferCounts
      .filter((row) => row.leagueId != null)
      .map((row) => [String(row.leagueId), Number((row._count as any).id ?? 0)])
  )
  const tradeOutcomeByLeague = new Map(
    tradeOutcomeCounts
      .filter((row) => row.leagueId != null)
      .map((row) => [String(row.leagueId), Number((row._count as any).id ?? 0)])
  )

  const activeManagersByLeague = new Map<string, Set<string>>()
  for (const row of chatActiveManagers) {
    const leagueId = String(row.leagueId)
    const userId = String(row.userId)
    if (!activeManagersByLeague.has(leagueId)) activeManagersByLeague.set(leagueId, new Set<string>())
    activeManagersByLeague.get(leagueId)!.add(userId)
  }
  for (const row of tradeOfferParticipantsSender) {
    if (row.leagueId == null || row.senderUserId == null) continue
    const leagueId = String(row.leagueId)
    const userId = String(row.senderUserId)
    if (!activeManagersByLeague.has(leagueId)) activeManagersByLeague.set(leagueId, new Set<string>())
    activeManagersByLeague.get(leagueId)!.add(userId)
  }
  for (const row of tradeOfferParticipantsOpponent) {
    if (row.leagueId == null || row.opponentUserId == null) continue
    const leagueId = String(row.leagueId)
    const userId = String(row.opponentUserId)
    if (!activeManagersByLeague.has(leagueId)) activeManagersByLeague.set(leagueId, new Set<string>())
    activeManagersByLeague.get(leagueId)!.add(userId)
  }

  const draftByLeague = new Map<string, DraftAggregate>()
  for (const d of draftData) {
    const existing = draftByLeague.get(d.leagueId) ?? {
      hasCompletedDraft: false,
      pickCount: 0,
      sessionCount: 0,
      activeSessionCount: 0,
      recentActivitySignal: 0,
      lastAt: null,
    }
    const hasCompleted = d.status === "completed" || (existing?.hasCompletedDraft ?? false)
    const pickCount = (existing?.pickCount ?? 0) + Number(d._count.picks)
    const sessionCount = existing.sessionCount + 1
    const activeSessionCount =
      existing.activeSessionCount + (ACTIVE_DRAFT_STATUSES.has(String(d.status ?? "").toLowerCase()) ? 1 : 0)
    const recentActivitySignal =
      existing.recentActivitySignal +
      (d.updatedAt >= since
        ? Math.max(1, Math.min(20, Math.ceil(Number(d._count.picks) / 4)))
        : 0)
    const lastAt =
      d.updatedAt && (!existing?.lastAt || d.updatedAt > existing.lastAt)
        ? d.updatedAt
        : existing?.lastAt ?? null
    draftByLeague.set(d.leagueId, {
      hasCompletedDraft: hasCompleted,
      pickCount,
      sessionCount,
      activeSessionCount,
      recentActivitySignal,
      lastAt,
    })
  }

  const [lastChatByLeague, lastTxByLeague, lastTradeOfferByLeague, lastTradeOutcomeByLeague] = await Promise.all([
    prisma.leagueChatMessage.groupBy({
      by: ["leagueId"],
      where: { leagueId: { in: leagueIdList } },
      _max: { createdAt: true },
    }),
    prisma.waiverTransaction.groupBy({
      by: ["leagueId"],
      where: { leagueId: { in: leagueIdList } },
      _max: { processedAt: true },
    }),
    safeGroupByModel("tradeOfferEvent", {
      by: ["leagueId"],
      where: { leagueId: { in: leagueIdList } },
      _max: { createdAt: true },
    }),
    safeGroupByModel("tradeOutcomeEvent", {
      by: ["leagueId"],
      where: { leagueId: { in: leagueIdList } },
      _max: { createdAt: true },
    }),
  ])
  const lastChatMap = new Map(lastChatByLeague.map((x) => [x.leagueId, x._max.createdAt]))
  const lastTxMap = new Map(lastTxByLeague.map((x) => [x.leagueId, x._max.processedAt]))
  const lastTradeOfferMap = new Map(
    lastTradeOfferByLeague
      .filter((row) => row.leagueId != null)
      .map((row) => [String(row.leagueId), (row._max as any).createdAt as Date | null])
  )
  const lastTradeOutcomeMap = new Map(
    lastTradeOutcomeByLeague
      .filter((row) => row.leagueId != null)
      .map((row) => [String(row.leagueId), (row._max as any).createdAt as Date | null])
  )

  const result = new Map<string, LeagueRankingMetrics>()
  for (const l of leagues) {
    const draft = draftByLeague.get(l.id)
    const managerCount = Number(l._count.rosters ?? 0)
    const leagueSize = l.leagueSize
    const retainedManagerCount = retainedByLeague.get(l.id) ?? 0
    const tradeOfferCount = tradeOfferByLeague.get(l.id) ?? 0
    const tradeOutcomeCount = tradeOutcomeByLeague.get(l.id) ?? 0
    const tradeFrequencyCount = tradeOfferCount + tradeOutcomeCount * 2
    const chatMessageCount = chatByLeague.get(l.id) ?? 0
    const transactionCount = txByLeague.get(l.id) ?? 0
    const activityManagers = activeManagersByLeague.get(l.id)
    const activeManagerCount = activityManagers ? activityManagers.size : 0

    const sizeForRetention = leagueSize && leagueSize > 0 ? leagueSize : managerCount
    const occupancyRatio = sizeForRetention > 0 ? managerCount / sizeForRetention : 0
    const leagueAgeDays = Math.max(1, (Date.now() - l.createdAt.getTime()) / (24 * 60 * 60 * 1000))
    const stableRatioRaw =
      managerCount > 0
        ? retainedManagerCount / managerCount
        : 0
    const stableRatio =
      retainedManagerCount > 0
        ? stableRatioRaw
        : leagueAgeDays < DEFAULT_RETENTION_DAYS
          ? occupancyRatio
          : 0
    const managerRetentionRate = clamp(occupancyRatio * 0.6 + stableRatio * 0.4)

    const leagueActivityCount = getLeagueActivitySignal({
      chatMessageCount,
      transactionCount,
      tradeFrequencyCount,
      draftRecentSignal: draft?.recentActivitySignal ?? 0,
    })

    const lastActivityCandidates = [
      l.lastSyncedAt,
      l.updatedAt,
      lastChatMap.get(l.id) ?? null,
      lastTxMap.get(l.id) ?? null,
      lastTradeOfferMap.get(l.id) ?? null,
      lastTradeOutcomeMap.get(l.id) ?? null,
      draft?.lastAt ?? null,
    ]
    const lastActivityAt = toMaxDate(lastActivityCandidates)

    result.set(l.id, {
      leagueActivityCount,
      chatMessageCount,
      tradeFrequencyCount,
      transactionCount,
      draftParticipation: {
        hasCompletedDraft: draft?.hasCompletedDraft ?? false,
        pickCount: draft?.pickCount ?? 0,
        sessionCount: draft?.sessionCount ?? 0,
        activeSessionCount: draft?.activeSessionCount ?? 0,
      },
      managerCount,
      leagueSize,
      retainedManagerCount,
      managerRetentionRate,
      activeManagerCount,
      lastActivityAt,
    })
  }
  return result
}

/**
 * Compute popularity score from metrics.
 * Components are normalized 0–1; composite is 0–100.
 */
function computePopularityScore(metrics: LeagueRankingMetrics): LeaguePopularityScore {
  const size = Math.max(8, metrics.leagueSize ?? metrics.managerCount ?? 12)
  const chatCap = Math.max(30, size * 15)
  const tradeCap = Math.max(8, Math.round(size * 1.5))
  const draftCap = Math.max(80, size * 8)
  const activityCap = Math.max(60, size * 20)

  const chatActivity = normalize(metrics.chatMessageCount, chatCap)
  const tradeFrequency = normalize(metrics.tradeFrequencyCount, tradeCap)
  const draftBase = normalize(metrics.draftParticipation.pickCount, draftCap)
  const draftSessionBoost = normalize(metrics.draftParticipation.activeSessionCount, 1) * 0.2
  const draftCompletionBoost = metrics.draftParticipation.hasCompletedDraft ? 0.35 : 0
  const draftParticipation = clamp(draftBase * 0.45 + draftSessionBoost + draftCompletionBoost)
  const managerRetention = clamp(metrics.managerRetentionRate)
  const recency = recencyScore(metrics.lastActivityAt)
  const activeManagerCoverage =
    metrics.managerCount > 0 ? clamp(metrics.activeManagerCount / metrics.managerCount) : 0
  const leagueActivityBase = normalize(metrics.leagueActivityCount, activityCap)
  const leagueActivity = clamp(leagueActivityBase * 0.55 + recency * 0.3 + activeManagerCoverage * 0.15)

  const components = {
    leagueActivity,
    chatActivity,
    tradeFrequency,
    draftParticipation,
    managerRetention,
    transactionActivity: tradeFrequency,
    recency: recency,
  }

  const raw =
    WEIGHTS.leagueActivity * components.leagueActivity +
    WEIGHTS.chatActivity * components.chatActivity +
    WEIGHTS.tradeFrequency * components.tradeFrequency +
    WEIGHTS.draftParticipation * components.draftParticipation +
    WEIGHTS.managerRetention * components.managerRetention
  const score = Math.round(clamp(raw, 0, 1) * 100)

  return { score, components }
}

/**
 * Get ranked leagues with popularity score.
 * Optionally filter by sport or limit; results sorted by score descending.
 */
export async function getRankedLeagues(options: {
  leagueIds?: string[]
  sport?: string | null
  limit?: number
  recentDays?: number
} = {}): Promise<RankedLeague[]> {
  const { leagueIds, sport, limit = 50, recentDays } = options

  const whereLeague: { id?: { in: string[] }; sport?: LeagueSport } = {}
  if (leagueIds && leagueIds.length > 0) whereLeague.id = { in: leagueIds }
  if (sport && sport.trim()) whereLeague.sport = sport.trim().toUpperCase() as LeagueSport

  const leagues = await prisma.league.findMany({
    where: whereLeague,
    select: { id: true, name: true, sport: true },
  })
  const ids = leagues.map((l) => l.id)
  if (ids.length === 0) return []

  const metricsMap = await getLeagueMetrics({ leagueIds: ids, recentDays })
  const ranked: RankedLeague[] = []

  for (const l of leagues) {
    const metrics = metricsMap.get(l.id)
    if (!metrics) continue
    const popularityScore = computePopularityScore(metrics)
    ranked.push({
      leagueId: l.id,
      leagueName: l.name,
      sport: l.sport,
      popularityScore,
      metrics,
    })
  }

  ranked.sort((a, b) => b.popularityScore.score - a.popularityScore.score)
  return limit > 0 ? ranked.slice(0, limit) : ranked
}
