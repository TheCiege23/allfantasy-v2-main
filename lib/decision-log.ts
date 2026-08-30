import { prisma } from '@/lib/prisma'
import { pricePlayer, ValuationContext } from '@/lib/hybrid-valuation'
import { getLeagueRosters, getAllPlayers, getLeagueInfo } from '@/lib/sleeper-client'
import { resolveLeagueValuePatch } from '@/lib/values/leagueValuePatch'
import type { ConfidenceRiskOutput, RiskTag } from '@/lib/analytics/confidence-risk-engine'

export type DecisionType = 'trade' | 'waiver' | 'sit_start' | 'trade_proposal' | 'trade_finder'
export type RiskProfile = 'low' | 'moderate' | 'high' | 'extreme'

export interface LogDecisionInput {
  userId: string
  leagueId: string
  decisionType: DecisionType
  aiRecommendation: Record<string, unknown>
  confidenceScore: number
  riskProfile: RiskProfile
  contextSnapshot?: Record<string, unknown>
  expiresAt?: Date
  confidenceRisk?: ConfidenceRiskOutput
}

export interface ResolveDecisionInput {
  decisionLogId: string
  userFollowed: boolean
  userAction?: Record<string, unknown>
}

export interface EvaluateOutcomeInput {
  decisionLogId: string
  evaluationWeeks?: number
}

export interface DecisionSummary {
  total: number
  followed: number
  ignored: number
  pending: number
  followedWinRate: number
  ignoredWinRate: number
  avgConfidence: number
  byType: Record<string, { total: number; followed: number; avgOutcome: number | null }>
}

export async function logDecision(input: LogDecisionInput) {
  const cr = input.confidenceRisk

  return prisma.decisionLog.create({
    data: {
      userId: input.userId,
      leagueId: input.leagueId,
      decisionType: input.decisionType,
      aiRecommendation: input.aiRecommendation as any,
      confidenceScore: cr ? cr.confidenceScore01 : Math.max(0, Math.min(1, input.confidenceScore)),
      numericConfidence: cr ? cr.numericConfidence : (input.confidenceScore ? Math.round(input.confidenceScore * 100) : null),
      riskProfile: cr ? cr.riskProfile : input.riskProfile,
      volatilityLabel: cr?.volatilityLevel ?? null,
      volatilityScore: cr?.volatilityScore ?? null,
      riskTags: cr ? (cr.riskTags as any) : null,
      confidenceExplanation: cr?.explanation ?? null,
      contextSnapshot: (input.contextSnapshot as any) ?? undefined,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
    },
  })
}

export async function resolveDecision(input: ResolveDecisionInput) {
  return prisma.decisionLog.update({
    where: { id: input.decisionLogId },
    data: {
      userFollowed: input.userFollowed,
      userAction: (input.userAction as any) ?? undefined,
      resolvedAt: new Date(),
    },
  })
}

export async function computeRosterValue(
  leagueId: string,
  rosterId: number,
  isSF: boolean
): Promise<{ totalValue: number; playerValues: Array<{ name: string; value: number }> }> {
  try {
    /*
     * League info joins the existing parallel fetch rather than being added after it: the
     * value patch below needs this league's starting slots and its format, and fetching them
     * in sequence would put a second Sleeper round trip on the critical path for a number
     * that is only used to decide how defenders are priced.
     */
    const [rosters, allPlayers, league] = await Promise.all([
      getLeagueRosters(leagueId),
      getAllPlayers(),
      getLeagueInfo(leagueId).catch(() => null),
    ])

    const roster = rosters.find(r => r.roster_id === rosterId)
    if (!roster || !roster.players?.length) {
      return { totalValue: 0, playerValues: [] }
    }

    const playerValues: Array<{ name: string; value: number }> = []
    let totalValue = 0

    const playerIds = roster.players.slice(0, 30)

    /*
     * ⚠ HOISTED OUT OF THE LOOP, WHICH IT WAS NOT BEFORE. A fresh context per player was
     * merely wasteful while it held two literals; rebuilding one that carries this league's
     * value board would re-run the board load up to thirty times per roster.
     *
     * The board itself is why this matters at all: without it every defender on the roster
     * priced at a flat per-position constant, so a decision's recorded roster value moved
     * with the offence and was blind to the defensive half of an IDP team. See
     * lib/values/leagueValuePatch.ts.
     */
    const ctx: ValuationContext = {
      asOfDate: new Date().toISOString().slice(0, 10),
      isSuperFlex: isSF,
      ...(await resolveLeagueValuePatch({
        platformLeagueId: leagueId,
        sleeperLeague: league,
        prefetched: { rosters },
      })),
    }

    for (const pid of playerIds) {
      const p = allPlayers[pid]
      if (!p) continue
      const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim()
      try {
        const priced = await pricePlayer(name, ctx)
        if (priced && priced.value > 0) {
          playerValues.push({ name, value: priced.value })
          totalValue += priced.value
        }
      } catch {
        // skip unpriced players
      }
    }

    return { totalValue, playerValues }
  } catch {
    return { totalValue: 0, playerValues: [] }
  }
}

export function estimateWinProbability(
  pointsFor: number,
  pointsAgainst: number,
  wins: number,
  losses: number,
  rosterValue: number
): number {
  const totalGames = wins + losses
  if (totalGames === 0) return 0.5

  const winPct = wins / totalGames
  const pointsDiff = pointsFor - pointsAgainst
  const avgPointsDiff = pointsDiff / totalGames

  const baseProb = winPct * 0.5
  const pointsSignal = Math.max(-0.3, Math.min(0.3, avgPointsDiff / 50))
  const rosterSignal = Math.max(-0.2, Math.min(0.2, (rosterValue - 5000) / 25000))

  return Math.max(0.05, Math.min(0.95, baseProb + pointsSignal + rosterSignal))
}

function gradeOutcome(delta: number | null): string {
  if (delta == null) return 'N/A'
  if (delta > 500) return 'A+'
  if (delta > 200) return 'A'
  if (delta > 50) return 'B+'
  if (delta > 0) return 'B'
  if (delta > -50) return 'C'
  if (delta > -200) return 'D'
  return 'F'
}

export async function evaluateOutcome(input: EvaluateOutcomeInput) {
  const log = await prisma.decisionLog.findUnique({
    where: { id: input.decisionLogId },
    include: { outcome: true },
  })

  if (!log) throw new Error('Decision log not found')
  if (log.outcome) return log.outcome

  const weeks = input.evaluationWeeks ?? 3
  const contextSnap = (log.contextSnapshot as Record<string, unknown>) ?? {}
  const rosterId = (contextSnap.rosterId as number) ?? 0
  const isSF = (contextSnap.isSF as boolean) ?? false
  const prevRosterValue = (contextSnap.rosterValueAtDecision as number) ?? null
  const prevWinProb = (contextSnap.winProbAtDecision as number) ?? null

  let rosterValueAfter: number | null = null
  let winProbAfter: number | null = null
  let rosterValueDelta: number | null = null
  let winProbDelta: number | null = null

  try {
    const currentRoster = await computeRosterValue(log.leagueId, rosterId, isSF)
    rosterValueAfter = currentRoster.totalValue

    if (prevRosterValue != null) {
      rosterValueDelta = rosterValueAfter - prevRosterValue
    }

    const rosters = await getLeagueRosters(log.leagueId)
    const rosterObj = rosters.find(r => r.roster_id === rosterId)
    if (rosterObj) {
      const wins = (rosterObj.settings as any)?.wins ?? 0
      const losses = (rosterObj.settings as any)?.losses ?? 0
      const pf = (rosterObj.settings as any)?.fpts ?? 0
      const pa = (rosterObj.settings as any)?.fpts_against ?? 0
      winProbAfter = estimateWinProbability(pf, pa, wins, losses, rosterValueAfter)

      if (prevWinProb != null) {
        winProbDelta = winProbAfter - prevWinProb
      }
    }
  } catch {
    // if we can't compute current values, store what we have
  }

  let actualResult: string = 'unknown'
  if (rosterValueDelta != null) {
    if (rosterValueDelta > 100) actualResult = 'positive'
    else if (rosterValueDelta < -100) actualResult = 'negative'
    else actualResult = 'neutral'
  }

  const outcomeGrade = gradeOutcome(rosterValueDelta)

  const outcome = await prisma.decisionOutcome.create({
    data: {
      decisionLogId: log.id,
      rosterValueBefore: prevRosterValue,
      rosterValueAfter,
      rosterValueDelta,
      winProbBefore: prevWinProb,
      winProbAfter,
      winProbDelta,
      evaluationWeeks: weeks,
      actualResult,
      outcomeGrade,
      detailJson: {
        decisionType: log.decisionType,
        userFollowed: log.userFollowed,
        confidenceScore: log.confidenceScore,
        riskProfile: log.riskProfile,
      } as any,
    },
  })

  return outcome
}

export async function getDecisionSummary(userId: string, leagueId?: string): Promise<DecisionSummary> {
  const where: any = { userId }
  if (leagueId) where.leagueId = leagueId

  const logs = await prisma.decisionLog.findMany({
    where,
    include: { outcome: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const total = logs.length
  const followed = logs.filter(l => l.userFollowed === true).length
  const ignored = logs.filter(l => l.userFollowed === false).length
  const pending = logs.filter(l => l.userFollowed === null).length

  const followedWithOutcome = logs.filter(l => l.userFollowed === true && l.outcome)
  const ignoredWithOutcome = logs.filter(l => l.userFollowed === false && l.outcome)

  const followedWins = followedWithOutcome.filter(l => (l.outcome!.rosterValueDelta ?? 0) > 0).length
  const ignoredWins = ignoredWithOutcome.filter(l => (l.outcome!.rosterValueDelta ?? 0) > 0).length

  const followedWinRate = followedWithOutcome.length > 0 ? followedWins / followedWithOutcome.length : 0
  const ignoredWinRate = ignoredWithOutcome.length > 0 ? ignoredWins / ignoredWithOutcome.length : 0

  const avgConfidence = total > 0
    ? logs.reduce((sum, l) => sum + l.confidenceScore, 0) / total
    : 0

  const byType: Record<string, { total: number; followed: number; avgOutcome: number | null }> = {}
  for (const log of logs) {
    if (!byType[log.decisionType]) {
      byType[log.decisionType] = { total: 0, followed: 0, avgOutcome: null }
    }
    byType[log.decisionType].total++
    if (log.userFollowed) byType[log.decisionType].followed++
    if (log.outcome?.rosterValueDelta != null) {
      const prev = byType[log.decisionType].avgOutcome ?? 0
      const count = byType[log.decisionType].total
      byType[log.decisionType].avgOutcome = prev + (log.outcome.rosterValueDelta - prev) / count
    }
  }

  return {
    total,
    followed,
    ignored,
    pending,
    followedWinRate,
    ignoredWinRate,
    avgConfidence,
    byType,
  }
}

export async function getDecisionLogsForCoach(
  userId: string,
  limit = 20
): Promise<Array<{
  decisionType: string
  recommendation: string
  confidence: number
  risk: string
  followed: boolean | null
  outcome: string | null
  grade: string | null
  delta: number | null
  createdAt: string
}>> {
  const logs = await prisma.decisionLog.findMany({
    where: { userId },
    include: { outcome: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return logs.map(log => {
    const rec = log.aiRecommendation as Record<string, unknown>
    const summary = (rec.summary as string) || (rec.action as string) || JSON.stringify(rec).slice(0, 120)

    return {
      decisionType: log.decisionType,
      recommendation: summary,
      confidence: log.confidenceScore,
      risk: log.riskProfile,
      followed: log.userFollowed,
      outcome: log.outcome?.actualResult ?? null,
      grade: log.outcome?.outcomeGrade ?? null,
      delta: log.outcome?.rosterValueDelta ?? null,
      createdAt: log.createdAt.toISOString(),
    }
  })
}

export async function getUnresolvedDecisions(userId: string, leagueId?: string) {
  const where: any = { userId, resolvedAt: null }
  if (leagueId) where.leagueId = leagueId

  return prisma.decisionLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

export async function getPendingEvaluations(minAgeWeeks = 3, limit = 50) {
  const cutoff = new Date(Date.now() - minAgeWeeks * 7 * 24 * 60 * 60 * 1000)

  return prisma.decisionLog.findMany({
    where: {
      resolvedAt: { not: null },
      outcome: null,
      createdAt: { lte: cutoff },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
}

export async function batchEvaluateOutcomes(minAgeWeeks = 3, limit = 20) {
  const pending = await getPendingEvaluations(minAgeWeeks, limit)
  const results: Array<{ id: string; grade: string | null; error?: string }> = []

  for (const log of pending) {
    try {
      const outcome = await evaluateOutcome({
        decisionLogId: log.id,
        evaluationWeeks: minAgeWeeks,
      })
      results.push({ id: log.id, grade: outcome.outcomeGrade })
    } catch (err: any) {
      results.push({ id: log.id, grade: null, error: err.message })
    }
  }

  return { evaluated: results.length, results }
}

export function autoLogDecision(input: LogDecisionInput): void {
  logDecision(input).catch(err => {
    console.error('[DECISION-LOG] Auto-log failed:', err?.message || err)
  })
}
