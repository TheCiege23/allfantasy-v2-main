import { prisma } from '@/lib/prisma'
import { getLeagueMatchups } from '@/lib/sleeper-client'
import { computeCompositeFromWeights, resolveWeightProfile, getCompositeWeightConfig, type CompositeWeightProfile } from './composite-weights'
import { type LearnedCompositeParams } from './composite-param-learning'

export type BacktestTargetType = 'win_pct_3w' | 'playoff_qual' | 'championship_finish'

export interface BacktestMetrics {
  brier: number
  ece: number
  ndcg: number
  spearman: number
}

export interface BacktestResult {
  leagueId: string
  season: string
  weekEvaluated: number
  targetType: BacktestTargetType
  horizonWeeks: number
  segmentKey: string
  nTeams: number
  metrics: BacktestMetrics
  teamDetails: TeamBacktestDetail[]
}

interface TeamBacktestDetail {
  rosterId: string
  predicted: number
  actual: number
  rank: number
}

interface SnapshotRow {
  rosterId: string
  rank: number
  composite: number
  expectedWins: number | null
  winScore: number | null
  powerScore: number | null
  luckScore: number | null
  marketValueScore: number | null
  managerSkillScore: number | null
  futureCapitalScore: number | null
  draftGainP: number | null
  starterPercentile: number | null
  benchPercentile: number | null
  injuryHealthRatio: number | null
  riskConcentration: number | null
}

function hasComponentScores(row: SnapshotRow): boolean {
  return row.winScore != null && row.powerScore != null && row.luckScore != null
    && row.marketValueScore != null && row.managerSkillScore != null
}

function recomputeComposite(
  row: SnapshotRow,
  profile: CompositeWeightProfile,
  params: LearnedCompositeParams | null,
  phase: string,
  isDynasty: boolean,
): number {
  if (!hasComponentScores(row)) {
    return Number(row.composite)
  }

  let adjustedProfile = profile
  if (params) {
    const luckScale = 2.0 / Math.max(1.0, params.luckDampening)
    const fcDelta = params.futureCapitalInfluence - 0.05
    const totalOther = profile.win + profile.power + profile.market + profile.skill + profile.draftGain
    const rebalanceFactor = totalOther > 0 ? (totalOther - fcDelta) / totalOther : 1
    adjustedProfile = {
      win: Math.max(0, profile.win * rebalanceFactor),
      power: Math.max(0, profile.power * rebalanceFactor),
      luck: Math.max(0, profile.luck * luckScale),
      market: Math.max(0, profile.market * rebalanceFactor),
      skill: Math.max(0, profile.skill * rebalanceFactor),
      draftGain: Math.max(0, profile.draftGain * rebalanceFactor),
      futureCapital: Math.max(0, profile.futureCapital + fcDelta),
    }
  }

  return computeCompositeFromWeights(
    row.winScore!,
    row.powerScore!,
    row.luckScore!,
    row.marketValueScore!,
    row.managerSkillScore!,
    row.draftGainP ?? 0,
    phase,
    isDynasty,
    row.futureCapitalScore ?? 0,
    adjustedProfile,
  )
}

function computeBrier(predictions: number[], outcomes: number[]): number {
  if (predictions.length === 0) return 1
  let sum = 0
  for (let i = 0; i < predictions.length; i++) {
    sum += (predictions[i] - outcomes[i]) ** 2
  }
  return sum / predictions.length
}

function computeECE(predictions: number[], outcomes: number[], nBuckets = 10): number {
  const buckets: { sumP: number; sumY: number; count: number }[] = Array.from(
    { length: nBuckets },
    () => ({ sumP: 0, sumY: 0, count: 0 }),
  )

  for (let i = 0; i < predictions.length; i++) {
    const idx = Math.min(Math.floor(predictions[i] * nBuckets), nBuckets - 1)
    buckets[idx].sumP += predictions[i]
    buckets[idx].sumY += outcomes[i]
    buckets[idx].count++
  }

  let ece = 0
  const n = predictions.length
  for (const b of buckets) {
    if (b.count === 0) continue
    ece += (b.count / n) * Math.abs(b.sumP / b.count - b.sumY / b.count)
  }
  return ece
}

function computeNDCG(predictedRanks: number[], actualValues: number[]): number {
  if (predictedRanks.length === 0) return 0

  const n = predictedRanks.length
  const items = predictedRanks.map((rank, i) => ({
    predictedRank: rank,
    actualValue: actualValues[i],
  }))

  items.sort((a, b) => a.predictedRank - b.predictedRank)

  let dcg = 0
  for (let i = 0; i < n; i++) {
    dcg += items[i].actualValue / Math.log2(i + 2)
  }

  const idealSorted = [...actualValues].sort((a, b) => b - a)
  let idcg = 0
  for (let i = 0; i < n; i++) {
    idcg += idealSorted[i] / Math.log2(i + 2)
  }

  if (idcg === 0) return 0
  return dcg / idcg
}

function computeSpearman(ranks1: number[], ranks2: number[]): number {
  const n = ranks1.length
  if (n < 3) return 0

  let sumD2 = 0
  for (let i = 0; i < n; i++) {
    sumD2 += (ranks1[i] - ranks2[i]) ** 2
  }

  return 1 - (6 * sumD2) / (n * (n * n - 1))
}

function rankArray(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }))
  indexed.sort((a, b) => b.v - a.v)
  const ranks = new Array(values.length)
  for (let r = 0; r < indexed.length; r++) {
    ranks[indexed[r].i] = r + 1
  }
  return ranks
}

async function computeWinPct3W(
  leagueId: string,
  weekStart: number,
  horizon: number,
  rosterIds: string[],
): Promise<Map<string, number> | null> {
  const winsMap = new Map<string, number>()
  const gamesMap = new Map<string, number>()
  for (const rid of rosterIds) {
    winsMap.set(rid, 0)
    gamesMap.set(rid, 0)
  }

  let hasData = false
  for (let w = weekStart + 1; w <= weekStart + horizon; w++) {
    try {
      const matchups = await getLeagueMatchups(leagueId, w)
      if (!matchups || matchups.length === 0) continue

      const byMatch = new Map<number, Array<{ roster_id: number; points: number }>>()
      for (const m of matchups) {
        const mid = m.matchup_id
        if (!mid) continue
        const arr = byMatch.get(mid) || []
        arr.push({ roster_id: m.roster_id, points: m.points || 0 })
        byMatch.set(mid, arr)
      }

      for (const [, pair] of byMatch) {
        if (pair.length !== 2) continue
        hasData = true
        const [a, b] = pair
        const ridA = String(a.roster_id)
        const ridB = String(b.roster_id)

        gamesMap.set(ridA, (gamesMap.get(ridA) || 0) + 1)
        gamesMap.set(ridB, (gamesMap.get(ridB) || 0) + 1)

        if (a.points > b.points) {
          winsMap.set(ridA, (winsMap.get(ridA) || 0) + 1)
        } else if (b.points > a.points) {
          winsMap.set(ridB, (winsMap.get(ridB) || 0) + 1)
        } else {
          winsMap.set(ridA, (winsMap.get(ridA) || 0) + 0.5)
          winsMap.set(ridB, (winsMap.get(ridB) || 0) + 0.5)
        }
      }
    } catch {
      continue
    }
  }

  if (!hasData) return null

  const result = new Map<string, number>()
  for (const rid of rosterIds) {
    const games = gamesMap.get(rid) || 0
    if (games === 0) {
      result.set(rid, 0.5)
    } else {
      result.set(rid, (winsMap.get(rid) || 0) / games)
    }
  }
  return result
}

function snapshotToPredictedWinPct(composite: number): number {
  return Math.max(0, Math.min(1, composite / 100))
}

function parseSegmentKey(segmentKey: string): { phase: string; isDynasty: boolean } {
  const base = segmentKey.replace(/_inseason|_offseason|_postDraft|_postSeason/, '')
  const phaseMatch = segmentKey.match(/_(.+)$/)
  const phase = phaseMatch ? phaseMatch[1].replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '') : 'inseason'
  const isDynasty = base.startsWith('DYN')
  return { phase, isDynasty }
}

export async function runBacktestForWeek(
  leagueId: string,
  season: string,
  week: number,
  segmentKey: string,
  targetType: BacktestTargetType = 'win_pct_3w',
  horizon: number = 3,
  candidateParams?: LearnedCompositeParams | null,
): Promise<BacktestResult | null> {
  const snapshots = await prisma.rankingsSnapshot.findMany({
    where: { leagueId, season, week },
    orderBy: { rank: 'asc' },
  })

  if (snapshots.length < 4) return null

  const teams: SnapshotRow[] = snapshots.map(s => {
    const m = (s.metricsJson || {}) as Record<string, any>
    return {
      rosterId: s.rosterId,
      rank: s.rank,
      composite: Number(s.composite),
      expectedWins: s.expectedWins ? Number(s.expectedWins) : null,
      winScore: m.winScore ?? null,
      powerScore: m.powerScore ?? null,
      luckScore: m.luckScore ?? null,
      marketValueScore: m.marketValueScore ?? null,
      managerSkillScore: m.managerSkillScore ?? null,
      futureCapitalScore: m.futureCapitalScore ?? null,
      draftGainP: m.draftGainP ?? null,
      starterPercentile: m.starterValuePercentile ?? null,
      benchPercentile: m.benchPercentile ?? null,
      injuryHealthRatio: m.injuryHealthRatio ?? null,
      riskConcentration: m.riskConcentration ?? null,
    }
  })

  const { phase, isDynasty } = parseSegmentKey(segmentKey)

  let weightProfile: CompositeWeightProfile | null = null
  if (candidateParams && hasComponentScores(teams[0])) {
    const config = await getCompositeWeightConfig()
    weightProfile = resolveWeightProfile(config, phase, isDynasty)
  }

  const rosterIds = teams.map(t => t.rosterId)
  let predictions: number[] = []
  let outcomes: number[] = []

  if (targetType === 'win_pct_3w') {
    const actualWinPcts = await computeWinPct3W(leagueId, week, horizon, rosterIds)
    if (!actualWinPcts) return null

    if (weightProfile && candidateParams) {
      predictions = teams.map(t => snapshotToPredictedWinPct(recomputeComposite(t, weightProfile!, candidateParams, phase, isDynasty)))
    } else {
      predictions = teams.map(t => snapshotToPredictedWinPct(t.composite))
    }
    outcomes = teams.map(t => actualWinPcts.get(t.rosterId) ?? 0.5)
  } else if (targetType === 'playoff_qual') {
    const endSnapshots = await prisma.rankingsSnapshot.findMany({
      where: { leagueId, season, week: { gte: 14 } },
      orderBy: { week: 'desc' },
      distinct: ['rosterId'],
    })

    if (endSnapshots.length < 4) return null

    const totalTeams = endSnapshots.length
    const playoffCutoff = Math.max(Math.floor(totalTeams / 2), 4)

    const endRanks = new Map<string, number>()
    for (const s of endSnapshots) {
      endRanks.set(s.rosterId, s.rank)
    }

    if (weightProfile && candidateParams) {
      const recomposites = teams.map(t => recomputeComposite(t, weightProfile!, candidateParams, phase, isDynasty))
      predictions = recomposites.map(c => Math.max(0, Math.min(1, 1 - (1 - c / 100) * (totalTeams - 1) / totalTeams)))
    } else {
      predictions = teams.map(t => {
        const rank = t.rank
        return Math.max(0, Math.min(1, 1 - (rank - 1) / totalTeams))
      })
    }
    outcomes = teams.map(t => {
      const finalRank = endRanks.get(t.rosterId)
      if (finalRank === undefined) return 0.5
      return finalRank <= playoffCutoff ? 1 : 0
    })
  } else if (targetType === 'championship_finish') {
    const endSnapshots = await prisma.rankingsSnapshot.findMany({
      where: { leagueId, season, week: { gte: 14 } },
      orderBy: { week: 'desc' },
      distinct: ['rosterId'],
    })

    if (endSnapshots.length < 4) return null

    const totalTeams = endSnapshots.length
    const endRanks = new Map<string, number>()
    for (const s of endSnapshots) {
      endRanks.set(s.rosterId, s.rank)
    }

    if (weightProfile && candidateParams) {
      predictions = teams.map(t => snapshotToPredictedWinPct(recomputeComposite(t, weightProfile!, candidateParams, phase, isDynasty)))
    } else {
      predictions = teams.map(t => {
        return Math.max(0, Math.min(1, (totalTeams - t.rank + 1) / totalTeams))
      })
    }
    outcomes = teams.map(t => {
      const finalRank = endRanks.get(t.rosterId)
      if (finalRank === undefined) return 0.5
      return Math.max(0, Math.min(1, (totalTeams - finalRank + 1) / totalTeams))
    })
  }

  if (predictions.length === 0) return null

  const brier = computeBrier(predictions, outcomes)
  const ece = computeECE(predictions, outcomes)

  const predictedRanks = rankArray(predictions)
  const actualRanks = rankArray(outcomes)
  const ndcg = computeNDCG(predictedRanks, outcomes)
  const spearman = computeSpearman(predictedRanks, actualRanks)

  const teamDetails: TeamBacktestDetail[] = teams.map((t, i) => ({
    rosterId: t.rosterId,
    predicted: Math.round(predictions[i] * 10000) / 10000,
    actual: Math.round(outcomes[i] * 10000) / 10000,
    rank: t.rank,
  }))

  return {
    leagueId,
    season,
    weekEvaluated: week,
    targetType,
    horizonWeeks: horizon,
    segmentKey,
    nTeams: teams.length,
    metrics: {
      brier: Math.round(brier * 10000) / 10000,
      ece: Math.round(ece * 10000) / 10000,
      ndcg: Math.round(ndcg * 10000) / 10000,
      spearman: Math.round(spearman * 10000) / 10000,
    },
    teamDetails,
  }
}

export async function persistBacktestResult(result: BacktestResult): Promise<void> {
  await prisma.rankingsBacktestResult.upsert({
    where: {
      uniq_backtest_league_week_target: {
        leagueId: result.leagueId,
        season: result.season,
        weekEvaluated: result.weekEvaluated,
        targetType: result.targetType,
      },
    },
    create: {
      leagueId: result.leagueId,
      season: result.season,
      weekEvaluated: result.weekEvaluated,
      targetType: result.targetType,
      horizonWeeks: result.horizonWeeks,
      segmentKey: result.segmentKey,
      nTeams: result.nTeams,
      brier: result.metrics.brier,
      ece: result.metrics.ece,
      ndcg: result.metrics.ndcg,
      spearman: result.metrics.spearman,
      payloadJson: { teamDetails: result.teamDetails } as any,
    },
    update: {
      horizonWeeks: result.horizonWeeks,
      segmentKey: result.segmentKey,
      nTeams: result.nTeams,
      brier: result.metrics.brier,
      ece: result.metrics.ece,
      ndcg: result.metrics.ndcg,
      spearman: result.metrics.spearman,
      payloadJson: { teamDetails: result.teamDetails } as any,
    },
  })
}

