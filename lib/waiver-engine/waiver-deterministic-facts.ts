/**
 * Waiver Deterministic Facts Layer
 *
 * Computes rich team, league, waiver pool, and decision facts BEFORE
 * any AI model is called. All values are numeric, fast, and deterministic.
 * This layer drives smarter recommendations and reduces hallucinations.
 */

import type {
  WaiverRosterPlayer,
  WaiverCandidate,
  WaiverScoringContext,
} from './waiver-scoring'
import type { TeamNeedsMap } from './team-needs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FactualEvidence {
  source: 'league' | 'roster' | 'news' | 'model' | 'waiver_pool' | 'schedule'
  metric: string
  value: string
}

export interface TeamStructureFacts {
  startersByPosition: Record<string, number>
  benchByPosition: Record<string, number>
  irByPosition: Record<string, number>
  avgStarterAge: number
  avgBenchAge: number
  weakestStarter: { name: string; position: string; value: number } | null
  lowestUpsideBench: { name: string; position: string; value: number; age: number | null } | null
  redundantBenchClusters: { position: string; count: number; names: string[] }[]
  injuryExposureCount: number
  handcuffExposureCount: number
  missingPositions: string[]
  totalRosterSize: number
  starterCount: number
  benchCount: number
  irCount: number
}

export interface PerformanceFacts {
  pointsFor: number
  pointsAgainst: number
  wins: number
  losses: number
  ties: number
  currentRank: number
  recentTrend: 'hot' | 'warm' | 'cold' | 'unknown'
  performanceLabel: 'overperforming' | 'underperforming' | 'on_pace' | 'unknown'
  leagueAvgPoints: number
  pointsDelta: number
}

export interface LeagueFacts {
  numTeams: number
  scoringFormat: string
  waiverFormat: string
  leagueDepthIndex: number
  avgBenchSize: number
  startingRequirements: Record<string, number>
  leagueFormat: 'dynasty' | 'redraft' | 'keeper' | 'devy' | 'bestball' | 'unknown'
  isTEP: boolean
  isSF: boolean
  isPPC: boolean
  isBestBall: boolean
  isIDP: boolean
  sport: string
}

export interface WaiverPoolFacts {
  availableByPosition: Record<string, number>
  scarcityByPosition: Record<string, number>
  bestShortTermByPosition: Record<string, { name: string; value: number } | null>
  bestStashByPosition: Record<string, { name: string; value: number; age: number | null } | null>
  replacementLevelByPosition: Record<string, number>
  totalAvailable: number
}

export interface DecisionFacts {
  biggestNeedPositions: string[]
  benchCutCandidates: { name: string; position: string; value: number; reason: string }[]
  contenderWindowScore: number
  stashToleranceScore: number
  streamingNeedScore: number
  faabAggressionScore: number
  urgencyLevel: 'critical' | 'high' | 'medium' | 'low' | 'none'
}

export interface DeterministicFactsResult {
  facts: string[]
  evidence: FactualEvidence[]
  teamSummary: TeamStructureFacts
  performanceSummary: PerformanceFacts
  leagueSummary: LeagueFacts
  waiverPoolSummary: WaiverPoolFacts
  decisionSummary: DecisionFacts
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function countByPosition(players: WaiverRosterPlayer[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const p of players) {
    counts[p.position] = (counts[p.position] || 0) + 1
  }
  return counts
}

function avgAge(players: WaiverRosterPlayer[]): number {
  const ages = players.map(p => p.age).filter((a): a is number => a != null)
  if (ages.length === 0) return 0
  return Math.round((ages.reduce((s, a) => s + a, 0) / ages.length) * 10) / 10
}

// ---------------------------------------------------------------------------
// Team Structure Facts
// ---------------------------------------------------------------------------

function computeTeamStructure(
  roster: WaiverRosterPlayer[],
  startingRequirements: Record<string, number>,
): TeamStructureFacts {
  const starters = roster.filter(p => p.slot === 'starter')
  const bench = roster.filter(p => p.slot === 'bench')
  const ir = roster.filter(p => p.slot === 'ir')

  const startersByPosition = countByPosition(starters)
  const benchByPosition = countByPosition(bench)
  const irByPosition = countByPosition(ir)

  // Weakest starter (lowest value)
  const sortedStarters = [...starters].sort((a, b) => a.value - b.value)
  const weakestStarter = sortedStarters.length > 0
    ? { name: sortedStarters[0].name, position: sortedStarters[0].position, value: sortedStarters[0].value }
    : null

  // Lowest upside bench (oldest + lowest value)
  const benchScored = bench.map(p => ({
    ...p,
    upsideScore: p.value * (p.age != null && p.age <= 25 ? 1.3 : p.age != null && p.age >= 29 ? 0.6 : 1.0),
  })).sort((a, b) => a.upsideScore - b.upsideScore)
  const lowestUpsideBench = benchScored.length > 0
    ? { name: benchScored[0].name, position: benchScored[0].position, value: benchScored[0].value, age: benchScored[0].age }
    : null

  // Redundant bench clusters (3+ same position on bench)
  const redundantBenchClusters: TeamStructureFacts['redundantBenchClusters'] = []
  for (const [pos, count] of Object.entries(benchByPosition)) {
    if (count >= 3) {
      const names = bench.filter(p => p.position === pos).map(p => p.name)
      redundantBenchClusters.push({ position: pos, count, names })
    }
  }

  // Injury exposure (players on IR or with injury status)
  const injuryExposureCount = ir.length

  // Handcuff exposure (backup RBs on bench — simplified detection)
  const handcuffExposureCount = bench.filter(
    p => p.position === 'RB' && p.value < 2000,
  ).length

  // Missing positions
  const missingPositions: string[] = []
  for (const [pos, required] of Object.entries(startingRequirements)) {
    const have = (startersByPosition[pos] || 0) + (benchByPosition[pos] || 0)
    if (have < required) {
      missingPositions.push(pos)
    }
  }

  return {
    startersByPosition,
    benchByPosition,
    irByPosition,
    avgStarterAge: avgAge(starters),
    avgBenchAge: avgAge(bench),
    weakestStarter,
    lowestUpsideBench,
    redundantBenchClusters,
    injuryExposureCount,
    handcuffExposureCount,
    missingPositions,
    totalRosterSize: roster.length,
    starterCount: starters.length,
    benchCount: bench.length,
    irCount: ir.length,
  }
}

// ---------------------------------------------------------------------------
// Performance Facts
// ---------------------------------------------------------------------------

export function computePerformanceFacts(input: {
  pointsFor?: number
  pointsAgainst?: number
  wins?: number
  losses?: number
  ties?: number
  currentRank?: number
  recentWeekScores?: number[]
  leagueAvgPoints?: number
}): PerformanceFacts {
  const pointsFor = input.pointsFor ?? 0
  const pointsAgainst = input.pointsAgainst ?? 0
  const wins = input.wins ?? 0
  const losses = input.losses ?? 0
  const ties = input.ties ?? 0
  const currentRank = input.currentRank ?? 0
  const leagueAvgPoints = input.leagueAvgPoints ?? 0

  // Recent trend from last 3 weeks
  let recentTrend: PerformanceFacts['recentTrend'] = 'unknown'
  if (input.recentWeekScores && input.recentWeekScores.length >= 2) {
    const recent = input.recentWeekScores.slice(-3)
    const avg = recent.reduce((s, v) => s + v, 0) / recent.length
    if (leagueAvgPoints > 0) {
      const ratio = avg / leagueAvgPoints
      if (ratio >= 1.1) recentTrend = 'hot'
      else if (ratio >= 0.95) recentTrend = 'warm'
      else recentTrend = 'cold'
    }
  }

  // Over/under performing
  let performanceLabel: PerformanceFacts['performanceLabel'] = 'unknown'
  const totalGames = wins + losses + ties
  if (totalGames >= 3 && leagueAvgPoints > 0) {
    const expectedWinPct = pointsFor > leagueAvgPoints ? 0.55 : 0.45
    const actualWinPct = totalGames > 0 ? wins / totalGames : 0.5
    if (actualWinPct > expectedWinPct + 0.15) performanceLabel = 'overperforming'
    else if (actualWinPct < expectedWinPct - 0.15) performanceLabel = 'underperforming'
    else performanceLabel = 'on_pace'
  }

  return {
    pointsFor,
    pointsAgainst,
    wins,
    losses,
    ties,
    currentRank,
    recentTrend,
    performanceLabel,
    leagueAvgPoints,
    pointsDelta: leagueAvgPoints > 0 ? Math.round((pointsFor - leagueAvgPoints) * 10) / 10 : 0,
  }
}

// ---------------------------------------------------------------------------
// League Facts
// ---------------------------------------------------------------------------

export function computeLeagueFacts(ctx: WaiverScoringContext & {
  waiverFormat?: string
  sport?: string
  avgBenchSize?: number
  leagueFormat?: string
  isPPC?: boolean
  isBestBall?: boolean
  isIDP?: boolean
  rosterPositions?: string[]
}): LeagueFacts {
  const positions = ctx.rosterPositions ?? []
  const startingRequirements: Record<string, number> = {}
  for (const pos of positions) {
    if (pos === 'BN' || pos === 'IR' || pos === 'TAXI') continue
    const mapped = pos.toUpperCase()
    startingRequirements[mapped] = (startingRequirements[mapped] || 0) + 1
  }

  // League depth index: higher = deeper league (more scarce waiver pool)
  const depthIndex = clamp(
    Math.round(
      (ctx.numTeams / 12) * 50 +
      (ctx.rosterPlayers.length / 25) * 30 +
      (ctx.isDynasty ? 20 : 0),
    ),
    0,
    100,
  )

  return {
    numTeams: ctx.numTeams,
    scoringFormat: ctx.isSF ? 'Superflex' : ctx.isTEP ? 'TE Premium' : 'Standard',
    waiverFormat: ctx.waiverFormat ?? 'FAAB',
    leagueDepthIndex: depthIndex,
    avgBenchSize: ctx.avgBenchSize ?? Math.max(0, ctx.rosterPlayers.length - Object.values(startingRequirements).reduce((s, v) => s + v, 0)),
    startingRequirements,
    leagueFormat: (ctx.leagueFormat ?? (ctx.isDynasty ? 'dynasty' : 'redraft')) as LeagueFacts['leagueFormat'],
    isTEP: ctx.isTEP,
    isSF: ctx.isSF,
    isPPC: ctx.isPPC ?? false,
    isBestBall: ctx.isBestBall ?? false,
    isIDP: ctx.isIDP ?? false,
    sport: ctx.sport ?? 'NFL',
  }
}

// ---------------------------------------------------------------------------
// Waiver Pool Facts
// ---------------------------------------------------------------------------

export function computeWaiverPoolFacts(
  candidates: WaiverCandidate[],
  rosterPlayers: WaiverRosterPlayer[],
): WaiverPoolFacts {
  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
  const availableByPosition: Record<string, number> = {}
  const scarcityByPosition: Record<string, number> = {}
  const bestShortTermByPosition: Record<string, { name: string; value: number } | null> = {}
  const bestStashByPosition: Record<string, { name: string; value: number; age: number | null } | null> = {}
  const replacementLevelByPosition: Record<string, number> = {}

  for (const pos of positions) {
    const posCandidates = candidates.filter(c => c.position === pos)
    availableByPosition[pos] = posCandidates.length

    // Scarcity: fewer available = higher scarcity (0-100)
    scarcityByPosition[pos] = clamp(Math.round(100 - Math.min(posCandidates.length, 20) * 5), 0, 100)

    // Best short-term: highest value
    const sortedByValue = [...posCandidates].sort((a, b) => b.value - a.value)
    bestShortTermByPosition[pos] = sortedByValue.length > 0
      ? { name: sortedByValue[0].playerName, value: sortedByValue[0].value }
      : null

    // Best stash: youngest with decent value
    const youngCandidates = posCandidates
      .filter(c => c.age != null && c.age <= 25 && c.value >= 500)
      .sort((a, b) => b.value - a.value)
    bestStashByPosition[pos] = youngCandidates.length > 0
      ? { name: youngCandidates[0].playerName, value: youngCandidates[0].value, age: youngCandidates[0].age }
      : null

    // Replacement level: median value of bottom half of available
    if (posCandidates.length >= 2) {
      const bottomHalf = sortedByValue.slice(Math.floor(sortedByValue.length / 2))
      replacementLevelByPosition[pos] = Math.round(
        bottomHalf.reduce((s, c) => s + c.value, 0) / bottomHalf.length,
      )
    } else {
      replacementLevelByPosition[pos] = 0
    }
  }

  return {
    availableByPosition,
    scarcityByPosition,
    bestShortTermByPosition,
    bestStashByPosition,
    replacementLevelByPosition,
    totalAvailable: candidates.length,
  }
}

// ---------------------------------------------------------------------------
// Decision Facts
// ---------------------------------------------------------------------------

export function computeDecisionFacts(
  teamNeeds: TeamNeedsMap,
  teamStructure: TeamStructureFacts,
  performance: PerformanceFacts,
  league: LeagueFacts,
  poolFacts: WaiverPoolFacts,
  goal: 'win-now' | 'balanced' | 'rebuild',
): DecisionFacts {
  // Biggest need positions
  const biggestNeedPositions = teamNeeds.weakestSlots
    .slice(0, 3)
    .map(s => s.position)

  // Bench cut candidates
  const benchCutCandidates = teamNeeds.dropCandidates
    .filter(d => d.riskOfRegret <= 40)
    .slice(0, 3)
    .map(d => ({ name: d.playerName, position: d.position, value: d.value, reason: d.reason }))

  // Contender window score (0-100): how close to championship contention
  let contenderWindowScore = 50
  if (performance.currentRank > 0 && league.numTeams > 0) {
    const rankPct = 1 - (performance.currentRank / league.numTeams)
    contenderWindowScore += Math.round(rankPct * 30)
  }
  if (performance.recentTrend === 'hot') contenderWindowScore += 10
  if (performance.recentTrend === 'cold') contenderWindowScore -= 10
  if (teamStructure.avgStarterAge > 28) contenderWindowScore -= 5
  if (teamStructure.avgStarterAge < 25) contenderWindowScore -= 10 // young = rebuilding
  contenderWindowScore = clamp(contenderWindowScore, 0, 100)

  // Stash tolerance (0-100): how much room for long-term bets
  let stashToleranceScore = 50
  if (goal === 'rebuild') stashToleranceScore += 25
  if (goal === 'win-now') stashToleranceScore -= 25
  if (league.leagueFormat === 'dynasty') stashToleranceScore += 15
  if (league.leagueFormat === 'redraft') stashToleranceScore -= 30
  if (teamStructure.benchCount > 6) stashToleranceScore += 10
  if (teamStructure.benchCount < 4) stashToleranceScore -= 15
  stashToleranceScore = clamp(stashToleranceScore, 0, 100)

  // Streaming need (0-100): urgency to plug holes weekly
  let streamingNeedScore = 0
  const criticalByes = teamNeeds.byeWeekClusters.filter(c => c.severity === 'critical')
  if (criticalByes.length > 0) streamingNeedScore += 30
  if (teamStructure.injuryExposureCount >= 2) streamingNeedScore += 25
  if (teamNeeds.weakestSlots.length >= 2) streamingNeedScore += 20
  if (performance.recentTrend === 'cold') streamingNeedScore += 15
  streamingNeedScore = clamp(streamingNeedScore, 0, 100)

  // FAAB aggression (0-100)
  let faabAggressionScore = 50
  if (goal === 'win-now') faabAggressionScore += 15
  if (goal === 'rebuild') faabAggressionScore -= 10
  if (performance.recentTrend === 'cold' && goal === 'win-now') faabAggressionScore += 10
  if (biggestNeedPositions.length >= 2) faabAggressionScore += 10
  if (league.leagueDepthIndex >= 70) faabAggressionScore += 10 // deep league = harder to find value
  faabAggressionScore = clamp(faabAggressionScore, 0, 100)

  // Urgency
  let urgencyLevel: DecisionFacts['urgencyLevel'] = 'low'
  const urgencyScore = streamingNeedScore * 0.4 + faabAggressionScore * 0.3 + (100 - contenderWindowScore) * 0.3
  if (urgencyScore >= 75) urgencyLevel = 'critical'
  else if (urgencyScore >= 60) urgencyLevel = 'high'
  else if (urgencyScore >= 40) urgencyLevel = 'medium'
  else if (urgencyScore >= 20) urgencyLevel = 'low'
  else urgencyLevel = 'none'

  return {
    biggestNeedPositions,
    benchCutCandidates,
    contenderWindowScore,
    stashToleranceScore,
    streamingNeedScore,
    faabAggressionScore,
    urgencyLevel,
  }
}

// ---------------------------------------------------------------------------
// Main Entry: Build All Facts
// ---------------------------------------------------------------------------

export function buildDeterministicFacts(
  ctx: WaiverScoringContext & {
    waiverFormat?: string
    sport?: string
    avgBenchSize?: number
    leagueFormat?: string
    isPPC?: boolean
    isBestBall?: boolean
    isIDP?: boolean
    rosterPositions?: string[]
    pointsFor?: number
    pointsAgainst?: number
    wins?: number
    losses?: number
    ties?: number
    currentRank?: number
    recentWeekScores?: number[]
    leagueAvgPoints?: number
  },
  candidates: WaiverCandidate[],
): DeterministicFactsResult {
  const leagueSummary = computeLeagueFacts(ctx)
  const teamSummary = computeTeamStructure(ctx.rosterPlayers, leagueSummary.startingRequirements)
  const performanceSummary = computePerformanceFacts({
    pointsFor: ctx.pointsFor,
    pointsAgainst: ctx.pointsAgainst,
    wins: ctx.wins,
    losses: ctx.losses,
    ties: ctx.ties,
    currentRank: ctx.currentRank,
    recentWeekScores: ctx.recentWeekScores,
    leagueAvgPoints: ctx.leagueAvgPoints,
  })
  const waiverPoolSummary = computeWaiverPoolFacts(candidates, ctx.rosterPlayers)
  const decisionSummary = computeDecisionFacts(
    ctx.teamNeeds,
    teamSummary,
    performanceSummary,
    leagueSummary,
    waiverPoolSummary,
    ctx.goal,
  )

  // Build human-readable fact lines for prompt injection
  const facts: string[] = []
  facts.push(`Team: ${teamSummary.starterCount} starters, ${teamSummary.benchCount} bench, ${teamSummary.irCount} IR`)
  facts.push(`Avg starter age: ${teamSummary.avgStarterAge} | Avg bench age: ${teamSummary.avgBenchAge}`)
  if (teamSummary.weakestStarter) {
    facts.push(`Weakest starter: ${teamSummary.weakestStarter.name} (${teamSummary.weakestStarter.position}, value ${teamSummary.weakestStarter.value})`)
  }
  if (teamSummary.lowestUpsideBench) {
    facts.push(`Lowest upside bench: ${teamSummary.lowestUpsideBench.name} (${teamSummary.lowestUpsideBench.position}, value ${teamSummary.lowestUpsideBench.value}, age ${teamSummary.lowestUpsideBench.age ?? '?'})`)
  }
  if (teamSummary.redundantBenchClusters.length > 0) {
    for (const c of teamSummary.redundantBenchClusters) {
      facts.push(`Redundant bench cluster: ${c.count} ${c.position}s (${c.names.join(', ')})`)
    }
  }
  if (teamSummary.missingPositions.length > 0) {
    facts.push(`Missing required positions: ${teamSummary.missingPositions.join(', ')}`)
  }
  facts.push(`Injury exposure: ${teamSummary.injuryExposureCount} players on IR`)
  facts.push(`Record: ${performanceSummary.wins}-${performanceSummary.losses}${performanceSummary.ties > 0 ? `-${performanceSummary.ties}` : ''} | Rank: #${performanceSummary.currentRank || '?'}`)
  facts.push(`Trend: ${performanceSummary.recentTrend} | ${performanceSummary.performanceLabel}`)
  facts.push(`League: ${leagueSummary.numTeams} teams, ${leagueSummary.leagueFormat}, ${leagueSummary.scoringFormat}, ${leagueSummary.waiverFormat}`)
  facts.push(`League depth index: ${leagueSummary.leagueDepthIndex}/100`)
  facts.push(`Biggest needs: ${decisionSummary.biggestNeedPositions.join(', ') || 'none identified'}`)
  facts.push(`Urgency: ${decisionSummary.urgencyLevel}`)
  facts.push(`Contender window: ${decisionSummary.contenderWindowScore}/100 | Stash tolerance: ${decisionSummary.stashToleranceScore}/100`)
  facts.push(`FAAB aggression: ${decisionSummary.faabAggressionScore}/100 | Streaming need: ${decisionSummary.streamingNeedScore}/100`)
  facts.push(`Waiver pool: ${waiverPoolSummary.totalAvailable} available`)
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const avail = waiverPoolSummary.availableByPosition[pos] ?? 0
    const scarcity = waiverPoolSummary.scarcityByPosition[pos] ?? 0
    const best = waiverPoolSummary.bestShortTermByPosition[pos]
    facts.push(`  ${pos}: ${avail} available, scarcity ${scarcity}/100${best ? `, best: ${best.name} (${best.value})` : ''}`)
  }

  // Build evidence array
  const evidence: FactualEvidence[] = [
    { source: 'roster', metric: 'starterCount', value: String(teamSummary.starterCount) },
    { source: 'roster', metric: 'benchCount', value: String(teamSummary.benchCount) },
    { source: 'roster', metric: 'irCount', value: String(teamSummary.irCount) },
    { source: 'roster', metric: 'avgStarterAge', value: String(teamSummary.avgStarterAge) },
    { source: 'roster', metric: 'injuryExposure', value: String(teamSummary.injuryExposureCount) },
    { source: 'league', metric: 'numTeams', value: String(leagueSummary.numTeams) },
    { source: 'league', metric: 'depthIndex', value: String(leagueSummary.leagueDepthIndex) },
    { source: 'league', metric: 'format', value: leagueSummary.leagueFormat },
    { source: 'waiver_pool', metric: 'totalAvailable', value: String(waiverPoolSummary.totalAvailable) },
    { source: 'model', metric: 'urgencyLevel', value: decisionSummary.urgencyLevel },
    { source: 'model', metric: 'contenderWindow', value: String(decisionSummary.contenderWindowScore) },
    { source: 'model', metric: 'faabAggression', value: String(decisionSummary.faabAggressionScore) },
  ]

  return {
    facts,
    evidence,
    teamSummary,
    performanceSummary,
    leagueSummary,
    waiverPoolSummary,
    decisionSummary,
  }
}

