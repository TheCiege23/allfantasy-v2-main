/**
 * Admin AI analytics — aggregates `ai_platform_events`, `ai_recommendation_outcomes`,
 * `ai_recommendation_logs`, `ai_user_tendencies`, `ai_player_market_metrics`.
 *
 * Note: `AiPlatformEvent` maps to DB `ai_platform_events` (canonical "ai events" stream).
 */

import { Prisma } from '@prisma/client'
import { AI_EVENT_TYPES } from '@/lib/ai/events/aiEventTypes'
import { prisma } from '@/lib/prisma'

export type AIFeatureCategory = 'draft' | 'trade' | 'waiver' | 'coaching' | 'other'

export type AIDashboardFilters = {
  dateFrom: Date
  dateTo: Date
  sport?: string | null
  leagueType?: string | null
  /** Narrow recommendation rows by feature family */
  feature?: AIFeatureCategory | 'all'
  /** Filter users by tendency bucket */
  userSegment?: 'all' | 'high' | 'medium' | 'low'
}

export function categorizeAiFeature(feature: string | null, recommendationType: string | null): AIFeatureCategory {
  const s = `${feature ?? ''} ${recommendationType ?? ''}`.toLowerCase()
  if (/(draft|war_room|war room|adp|pick|snake|auction)/.test(s)) return 'draft'
  if (/(waiver|faab|claim|add|drop)/.test(s)) return 'waiver'
  if (/(trade|swap)/.test(s)) return 'trade'
  if (/(coach|ltc|long.term|chimmy|strategic|learning)/.test(s)) return 'coaching'
  return 'other'
}

export function categorizeOutcomeType(type: string | null): AIFeatureCategory {
  return categorizeAiFeature(type, type)
}

function outcomeTypeMatchesFeature(type: string | null, feature: AIFeatureCategory | 'all'): boolean {
  if (feature === 'all') return true
  return categorizeOutcomeType(type) === feature
}

function logMatchesFeature(
  feature: string | null,
  recType: string | null,
  filter: AIFeatureCategory | 'all',
): boolean {
  if (filter === 'all') return true
  return categorizeAiFeature(feature, recType) === filter
}

/**
 * Follow / ignore counts with EACH RECOMMENDATION COUNTED ONCE.
 *
 * 🛑 THE SAME DECISION WAS COUNTED TWICE. A recommendation's log row and its outcome row share an
 * id (`outcome.recommendationId === log.id`), and a verdict can land in BOTH: war-room telemetry
 * sets `log.accepted`, the draft resolver sets `outcome.followed`, and `war-room-persist` copies a
 * known `accepted` into both at write time. Adding `followed` outcomes to `accepted` logs doubled
 * every such follow. So the outcome's verdict wins, and a log's `accepted` counts only for a
 * recommendation with no outcome verdict. Several outcome rows for one id count once.
 */
export function countFollowSignals(
  outcomes: ReadonlyArray<{ recommendationId: string; followed: boolean | null }>,
  logs: ReadonlyArray<{ id: string; accepted: boolean | null }>,
): { followed: number; ignored: number } {
  const verdict = new Map<string, boolean>()
  for (const o of outcomes) {
    if (o.followed === null || verdict.has(o.recommendationId)) continue
    verdict.set(o.recommendationId, o.followed)
  }
  for (const l of logs) {
    if (l.accepted === null || verdict.has(l.id)) continue
    verdict.set(l.id, l.accepted)
  }
  let followed = 0
  let ignored = 0
  for (const v of verdict.values()) {
    if (v) followed += 1
    else ignored += 1
  }
  return { followed, ignored }
}

/**
 * The fewest scored outcomes on EACH side before follow-vs-ignore says anything.
 *
 * ⚠ The check used to be "at least one on each side", so a single followed pick and a single
 * ignored one produced a headline claim about users who follow AI. Thirty per side is the smallest
 * sample this repo already trusts for a comparison (`MIN_RECALIBRATION_SAMPLE` in the trade engine).
 */
export const MIN_SCORED_OUTCOMES_PER_SIDE = 30

async function resolveSegmentUserIds(segment: 'high' | 'medium' | 'low', sport: string | null | undefined): Promise<string[] | null> {
  const where: Prisma.AiUserTendencyWhereInput = {}
  if (sport && sport !== 'all') where.sport = sport

  const rows = await prisma.aiUserTendency.findMany({
    where,
    select: { userId: true, aiFollowRate: true },
  })

  const pick = (rate: number | null | undefined) => {
    const r = rate ?? 0
    if (segment === 'high') return r >= 0.6
    if (segment === 'medium') return r >= 0.3 && r < 0.6
    return r < 0.3
  }

  return rows.filter((x) => pick(x.aiFollowRate)).map((x) => x.userId)
}

export type GlobalAIMetrics = {
  totalRecommendationsServed: number
  totalRecommendationsFollowed: number
  followRatePct: number | null
  avgOutcomeScore: number | null
  accuracyScorePct: number | null
  trend7dVs30d: {
    followRateDeltaPct: number | null
    avgOutcomeDelta: number | null
    window7d: { followRatePct: number | null; avgOutcome: number | null }
    window30d: { followRatePct: number | null; avgOutcome: number | null }
  }
}

export async function getGlobalMetrics(filters: AIDashboardFilters): Promise<GlobalAIMetrics> {
  const { dateFrom, dateTo, feature = 'all', userSegment, sport } = filters

  const segmentIds =
    userSegment && userSegment !== 'all' ? await resolveSegmentUserIds(userSegment, sport) : null
  if (segmentIds && segmentIds.length === 0) {
    return emptyGlobal()
  }

  const userWhere =
    segmentIds && segmentIds.length > 0 ? ({ userId: { in: segmentIds } } as const) : undefined

  const [servedEvents, outcomeRows, logRows] = await Promise.all([
    prisma.aiPlatformEvent.count({
      where: {
        createdAt: { gte: dateFrom, lte: dateTo },
        eventType: AI_EVENT_TYPES.AI_RECOMMENDATION_SERVED,
        ...(sport && sport !== 'all' ? { sport } : {}),
        ...(filters.leagueType && filters.leagueType !== 'all' ? { leagueType: filters.leagueType } : {}),
      },
    }),
    prisma.aiRecommendationOutcome.findMany({
      where: {
        createdAt: { gte: dateFrom, lte: dateTo },
        ...(userWhere ?? {}),
      },
      select: {
        recommendationId: true,
        followed: true,
        outcomeScore: true,
        type: true,
      },
    }),
    prisma.aiRecommendationLog.findMany({
      where: {
        createdAt: { gte: dateFrom, lte: dateTo },
        ...(userWhere ?? {}),
      },
      select: { id: true, accepted: true, feature: true, recommendationType: true },
    }),
  ])

  const outcomesFiltered = outcomeRows.filter((o) => outcomeTypeMatchesFeature(o.type, feature))
  const logsFiltered = logRows.filter((l) => logMatchesFeature(l.feature, l.recommendationType, feature))

  const totalServed = Math.max(servedEvents, logsFiltered.length)
  const signals = countFollowSignals(outcomesFiltered, logsFiltered)
  const totalFollowSignals = signals.followed
  const totalIgnoreSignals = signals.ignored
  const denom = totalFollowSignals + totalIgnoreSignals
  const followRatePct = denom > 0 ? (100 * totalFollowSignals) / denom : null

  const scores = outcomesFiltered.map((o) => o.outcomeScore).filter((s): s is number => typeof s === 'number' && !Number.isNaN(s))
  const avgOutcomeScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
  const accuracyScorePct =
    scores.length > 0 ? (100 * scores.filter((s) => s >= 0.5).length) / scores.length : null

  const now = dateTo.getTime()
  const d7 = new Date(now - 7 * 86400000)
  const d30 = new Date(now - 30 * 86400000)
  const from7 = d7 < dateFrom ? dateFrom : d7
  const from30 = d30 < dateFrom ? dateFrom : d30

  const [w7, w30] = await Promise.all([
    windowMetrics({ ...filters, dateFrom: from7, dateTo: dateTo }),
    windowMetrics({ ...filters, dateFrom: from30, dateTo: dateTo }),
  ])

  return {
    totalRecommendationsServed: totalServed,
    totalRecommendationsFollowed: totalFollowSignals,
    followRatePct,
    avgOutcomeScore,
    accuracyScorePct,
    trend7dVs30d: {
      followRateDeltaPct:
        w7.followRatePct != null && w30.followRatePct != null ? w7.followRatePct - w30.followRatePct : null,
      avgOutcomeDelta:
        w7.avgOutcome != null && w30.avgOutcome != null ? w7.avgOutcome - w30.avgOutcome : null,
      window7d: { followRatePct: w7.followRatePct, avgOutcome: w7.avgOutcome },
      window30d: { followRatePct: w30.followRatePct, avgOutcome: w30.avgOutcome },
    },
  }
}

function emptyGlobal(): GlobalAIMetrics {
  return {
    totalRecommendationsServed: 0,
    totalRecommendationsFollowed: 0,
    followRatePct: null,
    avgOutcomeScore: null,
    accuracyScorePct: null,
    trend7dVs30d: {
      followRateDeltaPct: null,
      avgOutcomeDelta: null,
      window7d: { followRatePct: null, avgOutcome: null },
      window30d: { followRatePct: null, avgOutcome: null },
    },
  }
}

async function windowMetrics(filters: AIDashboardFilters): Promise<{
  followRatePct: number | null
  avgOutcome: number | null
}> {
  const segmentIds =
    filters.userSegment && filters.userSegment !== 'all'
      ? await resolveSegmentUserIds(filters.userSegment, filters.sport)
      : null
  if (segmentIds && segmentIds.length === 0) {
    return { followRatePct: null, avgOutcome: null }
  }
  const userWhere =
    segmentIds && segmentIds.length > 0 ? ({ userId: { in: segmentIds } } as const) : undefined
  const feature = filters.feature ?? 'all'

  const outcomes = await prisma.aiRecommendationOutcome.findMany({
    where: {
      createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
      ...(userWhere ?? {}),
    },
    select: { recommendationId: true, followed: true, outcomeScore: true, type: true },
  })
  const logs = await prisma.aiRecommendationLog.findMany({
    where: {
      createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
      ...(userWhere ?? {}),
    },
    select: { id: true, accepted: true, feature: true, recommendationType: true },
  })

  const oF = outcomes.filter((o) => outcomeTypeMatchesFeature(o.type, feature))
  const lF = logs.filter((l) => logMatchesFeature(l.feature, l.recommendationType, feature))
  const { followed, ignored } = countFollowSignals(oF, lF)
  const denom = followed + ignored
  const followRatePct = denom > 0 ? (100 * followed) / denom : null
  const scores = oF.map((o) => o.outcomeScore).filter((s): s is number => typeof s === 'number' && !Number.isNaN(s))
  const avgOutcome = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
  return { followRatePct, avgOutcome }
}

export type FeatureBreakdownRow = {
  feature: AIFeatureCategory
  label: string
  usageCount: number
  followRatePct: number | null
  avgOutcomeScore: number | null
}

export async function getFeatureBreakdown(filters: AIDashboardFilters): Promise<FeatureBreakdownRow[]> {
  const cats: AIFeatureCategory[] = ['draft', 'trade', 'waiver', 'coaching']
  const out: FeatureBreakdownRow[] = []

  const segmentIds =
    filters.userSegment && filters.userSegment !== 'all'
      ? await resolveSegmentUserIds(filters.userSegment, filters.sport)
      : null
  if (segmentIds && segmentIds.length === 0) {
    return cats.map((c) => ({ feature: c, label: labelFor(c), usageCount: 0, followRatePct: null, avgOutcomeScore: null }))
  }
  const userWhere =
    segmentIds && segmentIds.length > 0 ? ({ userId: { in: segmentIds } } as const) : undefined

  const [logs, outcomes] = await Promise.all([
    prisma.aiRecommendationLog.findMany({
      where: {
        createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
        ...(userWhere ?? {}),
      },
      select: { id: true, feature: true, recommendationType: true, accepted: true },
    }),
    prisma.aiRecommendationOutcome.findMany({
      where: {
        createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
        ...(userWhere ?? {}),
      },
      select: { recommendationId: true, type: true, followed: true, outcomeScore: true },
    }),
  ])

  for (const c of cats) {
    const lF = logs.filter((l) => categorizeAiFeature(l.feature, l.recommendationType) === c)
    const oF = outcomes.filter((o) => categorizeOutcomeType(o.type) === c)
    const usageCount = lF.length + oF.length
    const { followed, ignored } = countFollowSignals(oF, lF)
    const denom = followed + ignored
    const followRatePct = denom > 0 ? (100 * followed) / denom : null
    const scores = oF.map((o) => o.outcomeScore).filter((s): s is number => typeof s === 'number' && !Number.isNaN(s))
    const avgOutcomeScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    out.push({ feature: c, label: labelFor(c), usageCount, followRatePct, avgOutcomeScore })
  }

  return out
}

function labelFor(c: AIFeatureCategory): string {
  switch (c) {
    case 'draft':
      return 'Draft AI'
    case 'trade':
      return 'Trade AI'
    case 'waiver':
      return 'Waiver AI'
    case 'coaching':
      return 'Coaching AI'
    default:
      return 'Other'
  }
}

export type FollowVsIgnore = {
  pctUsersFollowing: number | null
  pctUsersIgnoring: number | null
  avgOutcomeWhenFollowed: number | null
  avgOutcomeWhenIgnored: number | null
  insight: string
}

export async function getFollowVsIgnore(filters: AIDashboardFilters): Promise<FollowVsIgnore> {
  const segmentIds =
    filters.userSegment && filters.userSegment !== 'all'
      ? await resolveSegmentUserIds(filters.userSegment, filters.sport)
      : null
  if (segmentIds && segmentIds.length === 0) {
    return {
      pctUsersFollowing: null,
      pctUsersIgnoring: null,
      avgOutcomeWhenFollowed: null,
      avgOutcomeWhenIgnored: null,
      insight: 'No users in this trust segment for the selected filters.',
    }
  }
  const userWhere =
    segmentIds && segmentIds.length > 0 ? ({ userId: { in: segmentIds } } as const) : undefined

  const rowsRaw = await prisma.aiRecommendationOutcome.findMany({
    where: {
      createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
      followed: { not: null },
      ...(userWhere ?? {}),
    },
    select: { followed: true, outcomeScore: true, userId: true, type: true },
  })
  const feature = filters.feature ?? 'all'
  const rows = rowsRaw.filter((r) => outcomeTypeMatchesFeature(r.type, feature))

  const users = new Map<string, { f: number; i: number }>()
  for (const r of rows) {
    if (!r.userId) continue
    const u = users.get(r.userId) ?? { f: 0, i: 0 }
    if (r.followed === true) u.f += 1
    if (r.followed === false) u.i += 1
    users.set(r.userId, u)
  }

  let followingUsers = 0
  let ignoringUsers = 0
  for (const [, v] of users) {
    if (v.f >= v.i && v.f > 0) followingUsers += 1
    if (v.i > v.f) ignoringUsers += 1
  }
  const uDenom = followingUsers + ignoringUsers
  const pctUsersFollowing = uDenom > 0 ? (100 * followingUsers) / uDenom : null
  const pctUsersIgnoring = uDenom > 0 ? (100 * ignoringUsers) / uDenom : null

  const whenFollowed = rows.filter((r) => r.followed === true).map((r) => r.outcomeScore)
  const whenIgnored = rows.filter((r) => r.followed === false).map((r) => r.outcomeScore)
  const avg = (arr: (number | null)[]) => {
    const n = arr.filter((x): x is number => typeof x === 'number' && !Number.isNaN(x))
    return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null
  }
  const avgOutcomeWhenFollowed = avg(whenFollowed)
  const avgOutcomeWhenIgnored = avg(whenIgnored)

  const scoredCount = (arr: (number | null)[]) => arr.filter((x) => typeof x === 'number' && !Number.isNaN(x)).length
  const scoredFollowed = scoredCount(whenFollowed)
  const scoredIgnored = scoredCount(whenIgnored)
  const enough = scoredFollowed >= MIN_SCORED_OUTCOMES_PER_SIDE && scoredIgnored >= MIN_SCORED_OUTCOMES_PER_SIDE
  let insight =
    `Not enough resolved outcomes to compare follow vs ignore yet ` +
    `(${scoredFollowed} followed and ${scoredIgnored} ignored with a score; ${MIN_SCORED_OUTCOMES_PER_SIDE} each needed).`
  if (enough && avgOutcomeWhenFollowed != null && avgOutcomeWhenIgnored != null) {
    const diff = (avgOutcomeWhenFollowed - avgOutcomeWhenIgnored) * 100
    insight =
      diff >= 0
        ? `Users who followed AI show ~${diff.toFixed(1)} points higher average outcome score vs ignored (normalized scale).`
        : `Ignored recommendations currently show higher average outcome — investigate miscalibration for this window.`
  }

  return {
    pctUsersFollowing,
    pctUsersIgnoring,
    // Below the sample floor an average is one or two results wearing a headline; say nothing.
    avgOutcomeWhenFollowed: enough ? avgOutcomeWhenFollowed : null,
    avgOutcomeWhenIgnored: enough ? avgOutcomeWhenIgnored : null,
    insight,
  }
}

export type OutcomeDistributionBucket = {
  bucket: 'strong_success' | 'success' | 'neutral' | 'fail' | 'strong_fail' | 'unknown'
  label: string
  count: number
}

export async function getOutcomeDistribution(filters: AIDashboardFilters): Promise<OutcomeDistributionBucket[]> {
  const raw = await prisma.aiRecommendationOutcome.findMany({
    where: {
      createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
    },
    select: { outcomeScore: true, type: true },
  })
  const feature = filters.feature ?? 'all'
  const rows = raw.filter((r) => outcomeTypeMatchesFeature(r.type, feature))

  const buckets: Record<OutcomeDistributionBucket['bucket'], number> = {
    strong_success: 0,
    success: 0,
    neutral: 0,
    fail: 0,
    strong_fail: 0,
    unknown: 0,
  }

  for (const r of rows) {
    const s = r.outcomeScore
    if (s == null || Number.isNaN(s)) {
      buckets.unknown += 1
      continue
    }
    if (s >= 0.75) buckets.strong_success += 1
    else if (s >= 0.5) buckets.success += 1
    else if (s >= 0.25) buckets.neutral += 1
    else if (s >= 0) buckets.fail += 1
    else buckets.strong_fail += 1
  }

  return [
    { bucket: 'strong_success', label: 'Strong success', count: buckets.strong_success },
    { bucket: 'success', label: 'Success', count: buckets.success },
    { bucket: 'neutral', label: 'Neutral', count: buckets.neutral },
    { bucket: 'fail', label: 'Fail', count: buckets.fail },
    { bucket: 'strong_fail', label: 'Strong fail', count: buckets.strong_fail },
    { bucket: 'unknown', label: 'Unknown', count: buckets.unknown },
  ]
}

export type PlayerPerformanceRow = {
  playerId: string
  playerName: string | null
  recommendationCount: number
  followRatePct: number | null
  avgOutcomeScore: number | null
  trend: 'up' | 'down' | 'flat'
}

export async function getPlayerPerformance(filters: AIDashboardFilters, limit = 40): Promise<PlayerPerformanceRow[]> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        player_id: string | null
        rec_count: bigint
        follow_rate: number | null
        avg_score: number | null
      }>
    >(Prisma.sql`
      SELECT
        COALESCE(recommendation_payload->>'playerId', recommendation_payload->>'player_id', '') AS player_id,
        COUNT(*)::int AS rec_count,
        AVG(CASE WHEN followed IS TRUE THEN 1.0 WHEN followed IS FALSE THEN 0.0 ELSE NULL END) AS follow_rate,
        AVG(outcome_score) AS avg_score
      FROM ai_recommendation_outcomes
      WHERE created_at >= ${filters.dateFrom}
        AND created_at <= ${filters.dateTo}
        AND COALESCE(recommendation_payload->>'playerId', recommendation_payload->>'player_id', '') <> ''
      GROUP BY 1
      ORDER BY rec_count DESC
      LIMIT ${limit}
    `)

    const ids = rows.map((r) => r.player_id).filter(Boolean) as string[]
        const names =
      ids.length > 0
        ? await prisma.player.findMany({
            where: { id: { in: ids.slice(0, 200) } },
            select: { id: true, name: true },
          })
        : []
    const nameById = new Map(names.map((p) => [p.id, p.name]))

    return rows.map((r) => ({
      playerId: r.player_id || 'unknown',
      playerName: r.player_id ? nameById.get(r.player_id) ?? r.player_id : null,
      recommendationCount: Number(r.rec_count),
      followRatePct: r.follow_rate != null ? r.follow_rate * 100 : null,
      avgOutcomeScore: r.avg_score,
      trend: 'flat' as const,
    }))
  } catch {
    return []
  }
}

export type UserSegmentRow = {
  segment: 'high' | 'medium' | 'low'
  label: string
  userCount: number
  avgFollowRatePct: number | null
  avgOutcomeScore: number | null
}

export async function getUserSegments(filters: AIDashboardFilters): Promise<UserSegmentRow[]> {
  const tendencies = await prisma.aiUserTendency.findMany({
    where: filters.sport && filters.sport !== 'all' ? { sport: filters.sport } : {},
    select: { userId: true, aiFollowRate: true },
  })

  const bucket = (rate: number | null | undefined): 'high' | 'medium' | 'low' => {
    const r = rate ?? 0
    if (r >= 0.6) return 'high'
    if (r >= 0.3) return 'medium'
    return 'low'
  }

  const groups: Record<'high' | 'medium' | 'low', string[]> = { high: [], medium: [], low: [] }
  for (const t of tendencies) {
    groups[bucket(t.aiFollowRate)].push(t.userId)
  }

  const out: UserSegmentRow[] = []
  for (const seg of ['high', 'medium', 'low'] as const) {
    const ids = groups[seg]
    const outcomes = await prisma.aiRecommendationOutcome.findMany({
      where: {
        userId: { in: ids },
        createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
      },
      select: { outcomeScore: true },
    })
    const scores = outcomes.map((o) => o.outcomeScore).filter((s): s is number => typeof s === 'number' && !Number.isNaN(s))
    const avgOutcomeScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    const rates = ids
      .map((id) => tendencies.find((t) => t.userId === id)?.aiFollowRate)
      .filter((x): x is number => typeof x === 'number')
    const avgFollowRatePct = rates.length ? (rates.reduce((a, b) => a + b, 0) / rates.length) * 100 : null

    out.push({
      segment: seg,
      label: seg === 'high' ? 'High trust' : seg === 'medium' ? 'Medium trust' : 'Low trust',
      userCount: ids.length,
      avgFollowRatePct,
      avgOutcomeScore,
    })
  }
  return out
}

export type LeagueSegmentRow = {
  leagueType: string
  scoringFormat: string
  aiUsage: number
  followRatePct: number | null
  avgOutcomeScore: number | null
}

export async function getLeagueSegments(filters: AIDashboardFilters): Promise<LeagueSegmentRow[]> {
  const logs = await prisma.aiRecommendationLog.findMany({
    where: {
      createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
      leagueId: { not: null },
    },
    select: {
      accepted: true,
      league: { select: { leagueType: true, scoring: true, sport: true } },
    },
  })

  const filtered = logs.filter((l) => {
    if (filters.sport && filters.sport !== 'all' && l.league?.sport && l.league.sport !== filters.sport) return false
    return true
  })

  const map = new Map<
    string,
    { usage: number; accepted: number; decided: number; scores: number[] }
  >()

  for (const l of filtered) {
    const lt = l.league?.leagueType ?? 'unknown'
    const sc = l.league?.scoring ?? 'unknown'
    const key = `${lt}||${sc}`
    const cur = map.get(key) ?? { usage: 0, accepted: 0, decided: 0, scores: [] }
    cur.usage += 1
    if (l.accepted === true) {
      cur.accepted += 1
      cur.decided += 1
    } else if (l.accepted === false) {
      cur.decided += 1
    }
    map.set(key, cur)
  }

  const outcomeByLeague = await prisma.aiRecommendationOutcome.findMany({
    where: {
      createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
      leagueId: { not: null },
    },
    select: { leagueId: true, outcomeScore: true },
  })
  const leagueIds = [...new Set(outcomeByLeague.map((o) => o.leagueId).filter(Boolean))] as string[]
  const leagues =
    leagueIds.length > 0
      ? await prisma.league.findMany({
          where: { id: { in: leagueIds } },
          select: { id: true, leagueType: true, scoring: true },
        })
      : []
  const leagueMeta = new Map(leagues.map((x) => [x.id, x]))

  const scoreMap = new Map<string, number[]>()
  for (const o of outcomeByLeague) {
    if (!o.leagueId || o.outcomeScore == null) continue
    const m = leagueMeta.get(o.leagueId)
    const key = `${m?.leagueType ?? 'unknown'}||${m?.scoring ?? 'unknown'}`
    const arr = scoreMap.get(key) ?? []
    arr.push(o.outcomeScore)
    scoreMap.set(key, arr)
  }

  const rows: LeagueSegmentRow[] = []
  for (const [key, v] of map) {
    const [leagueType, scoringFormat] = key.split('||')
    const followRatePct = v.decided > 0 ? (100 * v.accepted) / v.decided : null
    const sc = scoreMap.get(key) ?? []
    const avgOutcomeScore = sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null
    rows.push({
      leagueType: leagueType ?? 'unknown',
      scoringFormat: scoringFormat ?? 'unknown',
      aiUsage: v.usage,
      followRatePct,
      avgOutcomeScore,
    })
  }

  return rows.sort((a, b) => b.aiUsage - a.aiUsage).slice(0, 30)
}

export type TimeSeriesPoint = {
  date: string
  followRatePct: number | null
  avgOutcomeScore: number | null
  usageCount: number
}

export async function getTimeSeries(filters: AIDashboardFilters, range: '7d' | '30d' | 'all'): Promise<TimeSeriesPoint[]> {
  const from =
    range === '7d'
      ? new Date(Math.max(filters.dateFrom.getTime(), filters.dateTo.getTime() - 7 * 86400000))
      : range === '30d'
        ? new Date(Math.max(filters.dateFrom.getTime(), filters.dateTo.getTime() - 30 * 86400000))
        : filters.dateFrom

  const [events, outcomes] = await Promise.all([
    prisma.aiPlatformEvent.findMany({
      where: {
        createdAt: { gte: from, lte: filters.dateTo },
        eventType: {
          in: [
            AI_EVENT_TYPES.AI_RECOMMENDATION_SERVED,
            AI_EVENT_TYPES.AI_RECOMMENDATION_FOLLOWED,
            AI_EVENT_TYPES.AI_RECOMMENDATION_IGNORED,
          ],
        },
        ...(filters.sport && filters.sport !== 'all' ? { sport: filters.sport } : {}),
      },
      select: { createdAt: true, eventType: true },
    }),
    prisma.aiRecommendationOutcome.findMany({
      where: {
        createdAt: { gte: from, lte: filters.dateTo },
      },
      select: { createdAt: true, followed: true, outcomeScore: true, type: true },
    }),
  ])

  const feature = filters.feature ?? 'all'
  const outcomesFiltered = outcomes.filter((o) => outcomeTypeMatchesFeature(o.type, feature))

  const dayKey = (d: Date) => d.toISOString().slice(0, 10)
  const days = new Map<
    string,
    { served: number; followed: number; ignored: number; scores: number[]; oFollow: number; oIgnore: number }
  >()

  for (const e of events) {
    const k = dayKey(e.createdAt)
    const cur = days.get(k) ?? { served: 0, followed: 0, ignored: 0, scores: [], oFollow: 0, oIgnore: 0 }
    if (e.eventType === AI_EVENT_TYPES.AI_RECOMMENDATION_SERVED) cur.served += 1
    if (e.eventType === AI_EVENT_TYPES.AI_RECOMMENDATION_FOLLOWED) cur.followed += 1
    if (e.eventType === AI_EVENT_TYPES.AI_RECOMMENDATION_IGNORED) cur.ignored += 1
    days.set(k, cur)
  }

  for (const o of outcomesFiltered) {
    const k = dayKey(o.createdAt)
    const cur = days.get(k) ?? { served: 0, followed: 0, ignored: 0, scores: [], oFollow: 0, oIgnore: 0 }
    if (o.outcomeScore != null) cur.scores.push(o.outcomeScore)
    if (o.followed === true) cur.oFollow += 1
    if (o.followed === false) cur.oIgnore += 1
    days.set(k, cur)
  }

  const sortedKeys = [...days.keys()].sort()
  return sortedKeys.map((k) => {
    const v = days.get(k)!
    const denom = v.oFollow + v.oIgnore
    const followRatePct = denom > 0 ? (100 * v.oFollow) / denom : null
    const avgOutcomeScore = v.scores.length ? v.scores.reduce((a, b) => a + b, 0) / v.scores.length : null
    const usageCount = v.served + v.followed + v.ignored
    return { date: k, followRatePct, avgOutcomeScore, usageCount }
  })
}

export type RecommendationLogRow = {
  id: string
  type: string
  feature: string
  userId: string
  userEmail: string | null
  leagueId: string | null
  leagueName: string | null
  summary: string
  followed: boolean | null
  outcomeScore: number | null
  confidencePct: number | null
  createdAt: string
}

export type RecommendationLogsResult = {
  rows: RecommendationLogRow[]
  nextCursor: string | null
}

function recommendationLogFeatureWhere(
  cat: AIFeatureCategory | 'all',
): Prisma.AiRecommendationLogWhereInput | undefined {
  if (cat === 'all') return undefined
  const p =
    cat === 'draft'
      ? ['draft', 'war', 'adp', 'pick', 'snake', 'auction']
      : cat === 'trade'
        ? ['trade']
        : cat === 'waiver'
          ? ['waiver', 'faab', 'claim']
          : ['coach', 'ltc', 'chimmy', 'strategic', 'learning']
  return {
    OR: p.flatMap((x) => [
      { feature: { contains: x, mode: 'insensitive' } },
      { recommendationType: { contains: x, mode: 'insensitive' } },
    ]),
  }
}

export async function getRecommendationLogs(
  filters: AIDashboardFilters,
  opts: { take: number; cursor?: string | null; search?: string | null },
): Promise<RecommendationLogsResult> {
  const search = opts.search?.trim() || ''

  const feature = filters.feature ?? 'all'
  const featureClause = recommendationLogFeatureWhere(feature)

  const searchClause: Prisma.AiRecommendationLogWhereInput | undefined = search
    ? {
        OR: [
          { providerSummary: { contains: search, mode: 'insensitive' } },
          { feature: { contains: search, mode: 'insensitive' } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
          { league: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }
    : undefined

  const where: Prisma.AiRecommendationLogWhereInput = {
    AND: [
      { createdAt: { gte: filters.dateFrom, lte: filters.dateTo } },
      ...(featureClause ? [featureClause] : []),
      ...(searchClause ? [searchClause] : []),
    ],
  }

  const rows = await prisma.aiRecommendationLog.findMany({
    where,
    take: opts.take + 1,
    orderBy: { createdAt: 'desc' },
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: {
      user: { select: { email: true } },
      league: { select: { name: true } },
    },
  })

  let nextCursor: string | null = null
  let page = rows
  if (rows.length > opts.take) {
    nextCursor = rows[opts.take]!.id
    page = rows.slice(0, opts.take)
  }

  const mapped: RecommendationLogRow[] = page.map((r) => ({
    id: r.id,
    type: r.recommendationType ?? r.feature,
    feature: r.feature,
    userId: r.userId,
    userEmail: r.user.email,
    leagueId: r.leagueId,
    leagueName: r.league?.name ?? null,
    summary: (r.providerSummary ?? '').slice(0, 280) || '—',
    followed: r.accepted ?? null,
    outcomeScore: null,
    confidencePct: r.confidencePct ?? null,
    createdAt: r.createdAt.toISOString(),
  }))

  return { rows: mapped, nextCursor }
}

/** Merge outcomes into logs for display — optional enrichment */
export async function getOutcomeByRecommendationIdMap(ids: string[]): Promise<Map<string, { followed: boolean | null; outcomeScore: number | null }>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.aiRecommendationOutcome.findMany({
    where: { recommendationId: { in: ids } },
    select: { recommendationId: true, followed: true, outcomeScore: true },
  })
  return new Map(rows.map((r) => [r.recommendationId, { followed: r.followed, outcomeScore: r.outcomeScore }]))
}

export async function getAdminAIMetricsBundle(filters: AIDashboardFilters, timeRange: '7d' | '30d' | 'all') {
  const [
    global,
    featureBreakdown,
    followVsIgnore,
    outcomeDistribution,
    playerPerformance,
    userSegments,
    leagueSegments,
    timeSeries,
  ] = await Promise.all([
    getGlobalMetrics(filters),
    getFeatureBreakdown(filters),
    getFollowVsIgnore(filters),
    getOutcomeDistribution(filters),
    getPlayerPerformance(filters, 50),
    getUserSegments(filters),
    getLeagueSegments(filters),
    getTimeSeries(filters, timeRange),
  ])

  return {
    filters: {
      dateFrom: filters.dateFrom.toISOString(),
      dateTo: filters.dateTo.toISOString(),
      sport: filters.sport ?? null,
      leagueType: filters.leagueType ?? null,
      feature: filters.feature ?? 'all',
      userSegment: filters.userSegment ?? 'all',
    },
    global,
    featureBreakdown,
    followVsIgnore,
    outcomeDistribution,
    playerPerformance,
    userSegments,
    leagueSegments,
    timeSeries,
    generatedAt: new Date().toISOString(),
  }
}

export type AdminAIMetricsBundle = Awaited<ReturnType<typeof getAdminAIMetricsBundle>>
