/**
 * Deterministic post-draft scoring: value vs ADP, roster balance, positional depth,
 * upside profile, reach penalties, injury risk, bye week overlap, bench value.
 * value_score = ADP - actual_pick (positive = value, negative = reach).
 */

import type { SlotOrderEntry, DraftPickSnapshot } from '@/lib/live-draft-engine/types'
import { getAdpMapForLeague, getAdpForPick } from './adpResolver'
import { scoreToLetterGrade } from './gradeMapper'
import type { PickScoreEntry, ManagerRankingEntry, DraftResultsPayload } from './types'
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'

export interface ScoringInput {
  leagueId: string
  leagueName: string | null
  sport: string
  draftType: string
  season: string
  status: string
  rounds: number
  teamCount: number
  slotOrder: SlotOrderEntry[]
  picks: DraftPickSnapshot[]
  isDynasty: boolean
  formatKey?: string
}

type TeamMetricBreakdown = {
  totalValueScore: number
  positionalScore: number
  positionalDepthScore: number
  benchScore: number
  balanceScore: number
  upsideScore: number
  reachPenaltyScore: number
  injuryRiskScore: number
  byeWeekScore: number
  score: number
}

const CORE_POSITIONS: Record<SupportedSport, string[]> = {
  NFL: ['QB', 'RB', 'WR', 'TE'],
  NCAAF: ['QB', 'RB', 'WR', 'TE'],
  NBA: ['PG', 'SG', 'SF', 'PF', 'C'],
  NCAAB: ['PG', 'SG', 'SF', 'PF', 'C'],
  MLB: ['SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'OF'],
  NHL: ['C', 'LW', 'RW', 'D', 'G'],
  SOCCER: ['F', 'M', 'D', 'GK'],
}

const DEPTH_TARGETS: Record<SupportedSport, Record<string, number>> = {
  NFL: { QB: 1, RB: 2, WR: 2, TE: 1 },
  NCAAF: { QB: 1, RB: 2, WR: 2, TE: 1 },
  NBA: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 },
  NCAAB: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 },
  MLB: { SP: 2, RP: 1, C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 2 },
  NHL: { C: 1, LW: 1, RW: 1, D: 2, G: 1 },
  SOCCER: { F: 1, M: 2, D: 2, GK: 1 },
}

const UPSIDE_POSITIONS: Record<SupportedSport, Set<string>> = {
  NFL: new Set(['RB', 'WR', 'TE']),
  NCAAF: new Set(['RB', 'WR', 'TE']),
  NBA: new Set(['SG', 'SF', 'PF']),
  NCAAB: new Set(['SG', 'SF', 'PF']),
  MLB: new Set(['OF', 'SP', 'SS', '3B']),
  NHL: new Set(['C', 'LW', 'RW']),
  SOCCER: new Set(['F', 'M']),
}

const POSITION_RISK_WEIGHTS: Record<SupportedSport, Record<string, number>> = {
  NFL: { QB: 0.4, RB: 0.82, WR: 0.52, TE: 0.58, K: 0.2, DST: 0.2 },
  NCAAF: { QB: 0.42, RB: 0.8, WR: 0.52, TE: 0.58, K: 0.2, DST: 0.2 },
  NBA: { PG: 0.5, SG: 0.54, SF: 0.5, PF: 0.56, C: 0.62 },
  NCAAB: { PG: 0.5, SG: 0.54, SF: 0.5, PF: 0.56, C: 0.62 },
  MLB: { SP: 0.72, RP: 0.62, C: 0.58, '1B': 0.36, '2B': 0.42, '3B': 0.44, SS: 0.42, OF: 0.4 },
  NHL: { C: 0.44, LW: 0.48, RW: 0.48, D: 0.42, G: 0.74 },
  SOCCER: { F: 0.5, M: 0.42, D: 0.36, GK: 0.44 },
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function normalizePositionForSport(sport: SupportedSport, rawPosition: string): string {
  const upper = String(rawPosition ?? '').trim().toUpperCase()
  if (!upper) return 'OTHER'
  if (sport === 'SOCCER') {
    if (['F', 'FW', 'ST', 'CF'].includes(upper)) return 'F'
    if (['M', 'MID', 'MF', 'CM', 'AM', 'DM'].includes(upper)) return 'M'
    if (['D', 'DEF', 'CB', 'LB', 'RB', 'WB'].includes(upper)) return 'D'
    if (['GK', 'GKP', 'GOALIE', 'GOALKEEPER'].includes(upper)) return 'GK'
  }
  if (sport === 'NHL' && upper === 'W') return 'LW'
  if ((sport === 'MLB' || sport === 'NCAAF' || sport === 'NFL') && upper === 'DEF') return 'DST'
  return upper
}

/**
 * Score each pick: valueScore = adp - actual_pick.
 * ADP is the market ADP recorded when the pick was made (`adpAtPick`) when present —
 * what the manager actually faced — else today's AI ADP for the format. When neither
 * matches, actual_pick is used as neutral (valueScore = 0).
 */
function scorePicks(
  picks: DraftPickSnapshot[],
  adpMap: Map<string, number>
): PickScoreEntry[] {
  return picks.map((p) => {
    const current = getAdpForPick(adpMap, p.playerName, p.position, p.team ?? null, Number.NaN)
    const adpSource = p.adpAtPick != null ? 'at_pick' : Number.isNaN(current) ? 'none' : 'current'
    const adp = p.adpAtPick ?? (Number.isNaN(current) ? p.overall : current)
    const valueScore = adp - p.overall
    return {
      id: p.id,
      overall: p.overall,
      round: p.round,
      slot: p.slot,
      rosterId: p.rosterId,
      displayName: p.displayName ?? null,
      playerName: p.playerName,
      position: p.position,
      team: p.team ?? null,
      byeWeek: p.byeWeek ?? null,
      adp,
      adpSource,
      valueScore,
    }
  })
}

function countByCorePosition(teamPicks: PickScoreEntry[], sport: SupportedSport): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const pick of teamPicks) {
    const normalized = normalizePositionForSport(sport, pick.position)
    counts[normalized] = (counts[normalized] ?? 0) + 1
  }
  return counts
}

function computeValueComponent(teamPicks: PickScoreEntry[]): { totalValueScore: number; valuePoints: number } {
  const totalValueScore = teamPicks.reduce((sum, pick) => sum + pick.valueScore, 0)
  const avgValue = teamPicks.length > 0 ? totalValueScore / teamPicks.length : 0
  const normalized = (clamp(avgValue, -20, 20) + 20) / 40
  return { totalValueScore, valuePoints: round1(normalized * 30) }
}

function computePositionalCoverageScore(teamPicks: PickScoreEntry[], sport: SupportedSport): number {
  const corePositions = CORE_POSITIONS[sport]
  if (!corePositions.length) return 7
  const counts = countByCorePosition(teamPicks, sport)
  const represented = corePositions.filter((pos) => (counts[pos] ?? 0) > 0).length
  return round1((represented / corePositions.length) * 14)
}

function computePositionalDepthScore(teamPicks: PickScoreEntry[], sport: SupportedSport): number {
  const targets = DEPTH_TARGETS[sport]
  const corePositions = CORE_POSITIONS[sport]
  const counts = countByCorePosition(teamPicks, sport)
  if (!corePositions.length) return 6
  const ratio =
    corePositions.reduce((sum, position) => {
      const target = Math.max(1, targets[position] ?? 1)
      const count = counts[position] ?? 0
      return sum + clamp(count / target, 0, 1)
    }, 0) / corePositions.length
  return round1(ratio * 12)
}

function computeBenchValueScore(teamPicks: PickScoreEntry[], rounds: number): number {
  const benchStart = Math.max(2, Math.ceil(rounds * 0.6))
  const benchPicks = teamPicks.filter((pick) => pick.round >= benchStart)
  if (benchPicks.length === 0) return 5
  const avgBenchValue = benchPicks.reduce((sum, pick) => sum + pick.valueScore, 0) / benchPicks.length
  const normalizedAvg = (clamp(avgBenchValue, -12, 18) + 12) / 30
  const depthFactor = clamp(benchPicks.length / Math.max(1, Math.floor(teamPicks.length * 0.4)), 0, 1)
  return round1((normalizedAvg * 0.75 + depthFactor * 0.25) * 10)
}

function computeRosterBalanceScore(teamPicks: PickScoreEntry[], sport: SupportedSport): number {
  if (teamPicks.length < 2) return 5
  const counts = countByCorePosition(teamPicks, sport)
  const core = CORE_POSITIONS[sport]
  const values = core.map((position) => counts[position] ?? 0).filter((value) => value > 0)
  const total = values.reduce((sum, value) => sum + value, 0)
  const entropy =
    values.length > 0
      ? values.reduce((sum, value) => {
          const ratio = value / total
          return sum - ratio * Math.log2(ratio)
        }, 0)
      : 0
  const maxEntropy = values.length > 1 ? Math.log2(values.length) : 1
  const entropyRatio = clamp(entropy / Math.max(1e-6, maxEntropy), 0, 1)
  const meanValue = teamPicks.reduce((sum, pick) => sum + pick.valueScore, 0) / teamPicks.length
  const variance =
    teamPicks.reduce((sum, pick) => sum + (pick.valueScore - meanValue) ** 2, 0) /
    teamPicks.length
  const consistency = clamp(1 - Math.sqrt(variance) / 25, 0, 1)
  return round1((entropyRatio * 0.6 + consistency * 0.4) * 10)
}

function computeUpsideScore(teamPicks: PickScoreEntry[], rounds: number, sport: SupportedSport): number {
  const laterRoundCutoff = Math.max(2, Math.ceil(rounds * 0.5))
  const laterPicks = teamPicks.filter((pick) => pick.round >= laterRoundCutoff)
  if (laterPicks.length === 0) return 4
  const positiveValueRatio =
    laterPicks.filter((pick) => pick.valueScore > 0).length / laterPicks.length
  const upsideSet = UPSIDE_POSITIONS[sport]
  const upsidePositionRatio =
    laterPicks.filter((pick) => upsideSet.has(normalizePositionForSport(sport, pick.position))).length /
    laterPicks.length
  return round1((positiveValueRatio * 0.65 + upsidePositionRatio * 0.35) * 8)
}

function computeReachPenaltyScore(teamPicks: PickScoreEntry[]): number {
  if (teamPicks.length === 0) return 4
  const reachPenalty = Math.abs(
    teamPicks.reduce((sum, pick) => sum + (pick.valueScore < 0 ? pick.valueScore : 0), 0)
  )
  const penaltyPerPick = reachPenalty / teamPicks.length
  return round1((1 - clamp(penaltyPerPick / 10, 0, 1)) * 8)
}

function computeInjuryRiskScore(teamPicks: PickScoreEntry[], sport: SupportedSport): number {
  if (teamPicks.length === 0) return 2
  const weightMap = POSITION_RISK_WEIGHTS[sport]
  const weightedPicks = teamPicks.slice(0, Math.min(10, teamPicks.length))
  const averageRisk =
    weightedPicks.reduce((sum, pick) => {
      const position = normalizePositionForSport(sport, pick.position)
      const riskWeight = weightMap[position] ?? 0.5
      return sum + riskWeight
    }, 0) / weightedPicks.length
  return round1((1 - clamp(averageRisk, 0, 1)) * 4)
}

function computeByeWeekScore(teamPicks: PickScoreEntry[], sport: SupportedSport): number {
  if (sport !== 'NFL' && sport !== 'NCAAF') return 4
  const earlyPicks = teamPicks
    .slice()
    .sort((a, b) => a.overall - b.overall)
    .slice(0, Math.min(10, teamPicks.length))
  const byeCounts = new Map<number, number>()
  for (const pick of earlyPicks) {
    const bye = Number(pick.byeWeek ?? 0)
    if (!Number.isFinite(bye) || bye <= 0) continue
    byeCounts.set(bye, (byeCounts.get(bye) ?? 0) + 1)
  }
  if (byeCounts.size === 0) return 3
  let overlapPenalty = 0
  for (const count of byeCounts.values()) {
    if (count > 1) overlapPenalty += count - 1
  }
  const normalizedPenalty = clamp(overlapPenalty / Math.max(1, earlyPicks.length * 0.5), 0, 1)
  return round1((1 - normalizedPenalty) * 4)
}

function computeTeamMetrics(
  allPicks: PickScoreEntry[],
  rosterId: string,
  rounds: number,
  sport: SupportedSport
): TeamMetricBreakdown {
  const teamPicks = allPicks.filter((pick) => pick.rosterId === rosterId)
  const { totalValueScore, valuePoints } = computeValueComponent(teamPicks)
  const positionalScore = computePositionalCoverageScore(teamPicks, sport)
  const positionalDepthScore = computePositionalDepthScore(teamPicks, sport)
  const benchScore = computeBenchValueScore(teamPicks, rounds)
  const balanceScore = computeRosterBalanceScore(teamPicks, sport)
  const upsideScore = computeUpsideScore(teamPicks, rounds, sport)
  const reachPenaltyScore = computeReachPenaltyScore(teamPicks)
  const injuryRiskScore = computeInjuryRiskScore(teamPicks, sport)
  const byeWeekScore = computeByeWeekScore(teamPicks, sport)
  const score = round1(
    valuePoints +
      positionalScore +
      positionalDepthScore +
      benchScore +
      balanceScore +
      upsideScore +
      reachPenaltyScore +
      injuryRiskScore +
      byeWeekScore
  )
  return {
    totalValueScore: round1(totalValueScore),
    positionalScore,
    positionalDepthScore,
    benchScore,
    balanceScore,
    upsideScore,
    reachPenaltyScore,
    injuryRiskScore,
    byeWeekScore,
    score,
  }
}

function buildDeterministicExplanation(entry: ManagerRankingEntry): string {
  const valueTone =
    entry.totalValueScore >= 10
      ? 'consistently drafted below ADP for positive market value'
      : entry.totalValueScore <= -10
        ? 'paid above ADP on several core picks'
        : 'stayed close to ADP with limited volatility'
  const depthTone =
    entry.positionalDepthScore >= 8
      ? 'strong positional depth'
      : 'moderate positional depth with room to improve'
  const riskTone =
    entry.reachPenaltyScore >= 5.5
      ? 'controlled reaches well'
      : 'took multiple reach penalties'
  return `Ranked #${entry.rank} with grade ${entry.grade}. This roster ${valueTone}, maintained ${depthTone}, and ${riskTone}.`
}

export async function computeDraftResults(input: ScoringInput): Promise<DraftResultsPayload> {
  const {
    leagueId,
    leagueName,
    sport,
    draftType,
    season,
    status,
    rounds,
    teamCount,
    slotOrder,
    picks,
    isDynasty,
    formatKey,
  } = input
  const supportedSport = normalizeToSupportedSport(sport)
  const adpMap = await getAdpMapForLeague(supportedSport, isDynasty, formatKey)
  const scoredPicks = scorePicks(picks, adpMap)
  const totalPicks = rounds * teamCount

  const pickLog = scoredPicks.map((p) => ({
    id: p.id,
    overall: p.overall,
    round: p.round,
    slot: p.slot,
    rosterId: p.rosterId,
    displayName: p.displayName,
    playerName: p.playerName,
    position: p.position,
    team: p.team,
    valueScore: p.valueScore,
    adp: p.adp,
  }))

  const bestPickOfDraft = scoredPicks.length
    ? scoredPicks.reduce((left, right) => (left.valueScore >= right.valueScore ? left : right))
    : null
  const worstReachOfDraft = scoredPicks.length
    ? scoredPicks.reduce((left, right) => (left.valueScore <= right.valueScore ? left : right))
    : null
  const stealOfDraft = bestPickOfDraft

  const managerRankings: ManagerRankingEntry[] = slotOrder.map((slot) => {
    const rosterId = slot.rosterId
    const teamPicks = scoredPicks.filter((p) => p.rosterId === rosterId)
    const metrics = computeTeamMetrics(scoredPicks, rosterId, rounds, supportedSport)
    const grade = scoreToLetterGrade(metrics.score)
    const bestPick = teamPicks.length
      ? teamPicks.reduce((left, right) => (left.valueScore >= right.valueScore ? left : right))
      : null
    const worstReach = teamPicks.length
      ? teamPicks.reduce((left, right) => (left.valueScore <= right.valueScore ? left : right))
      : null
    return {
      rank: 0,
      rosterId,
      displayName: slot.displayName ?? `Team ${slot.slot}`,
      slot: slot.slot,
      grade,
      score: metrics.score,
      totalValueScore: metrics.totalValueScore,
      positionalScore: metrics.positionalScore,
      positionalDepthScore: metrics.positionalDepthScore,
      benchScore: metrics.benchScore,
      balanceScore: metrics.balanceScore,
      upsideScore: metrics.upsideScore,
      reachPenaltyScore: metrics.reachPenaltyScore,
      injuryRiskScore: metrics.injuryRiskScore,
      byeWeekScore: metrics.byeWeekScore,
      pickCount: teamPicks.length,
      picks: teamPicks,
      bestPick,
      worstReach,
      explanation: null,
      explanationSource: 'deterministic',
    }
  })

  managerRankings.sort((left, right) => right.score - left.score)
  managerRankings.forEach((m, i) => {
    m.rank = i + 1
    m.explanation = buildDeterministicExplanation(m)
  })

  return {
    leagueId,
    leagueName,
    sport: supportedSport,
    draftType,
    season,
    status,
    rounds,
    teamCount,
    totalPicks,
    pickLog,
    managerRankings,
    bestPickOfDraft,
    worstReachOfDraft,
    stealOfDraft,
  }
}
