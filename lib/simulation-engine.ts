import { prisma } from '@/lib/prisma'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'

const openai = getOpenAIRouteClient()

export interface SimulationScenario {
  type: 'trade' | 'roster_move' | 'draft_pick'
  description: string
  assets: {
    giving: { name: string; position: string; value?: number }[]
    receiving: { name: string; position: string; value?: number }[]
  }
  leagueContext?: {
    format: string
    teamCount: number
    scoring: string
    isSF: boolean
  }
  weatherImpact?: string
}

interface SimulationResult {
  iterations: number
  winProbability: { before: number; after: number; change: number }
  playoffProbability: { before: number; after: number; change: number }
  championshipProbability: { before: number; after: number; change: number }
  rosterStrength: { before: number; after: number; change: number }
  riskProfile: {
    level: 'low' | 'moderate' | 'high' | 'extreme'
    factors: string[]
  }
  distribution: {
    bestCase: string
    expectedCase: string
    worstCase: string
  }
  grade: string
  summary: string
  reportCard: ReportCard
}

interface ReportCard {
  overallGrade: string
  categories: {
    name: string
    grade: string
    score: number
    explanation: string
  }[]
  verdict: string
  keyTakeaways: string[]
}

function gaussianRandom(mean: number, stddev: number): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
  return z * stddev + mean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getPositionVolatility(position: string): number {
  const volatilityMap: Record<string, number> = {
    'QB': 0.08,
    'RB': 0.18,
    'WR': 0.12,
    'TE': 0.15,
    'K': 0.20,
    'DEF': 0.22,
  }
  return volatilityMap[position.toUpperCase()] || 0.15
}

function scoreGrade(score: number): string {
  if (score >= 90) return 'A+'
  if (score >= 85) return 'A'
  if (score >= 80) return 'A-'
  if (score >= 75) return 'B+'
  if (score >= 70) return 'B'
  if (score >= 65) return 'B-'
  if (score >= 60) return 'C+'
  if (score >= 55) return 'C'
  if (score >= 50) return 'C-'
  if (score >= 45) return 'D+'
  if (score >= 40) return 'D'
  return 'F'
}

export function runMonteCarloSimulation(
  scenario: SimulationScenario,
  iterations: number = 1000
): SimulationResult {
  const givingValues = scenario.assets.giving.map(a => a.value || 500)
  const receivingValues = scenario.assets.receiving.map(a => a.value || 500)

  const totalGiving = givingValues.reduce((s, v) => s + v, 0)
  const totalReceiving = receivingValues.reduce((s, v) => s + v, 0)

  const givingVolatilities = scenario.assets.giving.map(a => getPositionVolatility(a.position))
  const receivingVolatilities = scenario.assets.receiving.map(a => getPositionVolatility(a.position))

  const baseWinProb = 50
  const basePlayoffProb = 33
  const baseChampProb = 8

  const valueDelta = totalReceiving - totalGiving
  const valueRatio = totalReceiving / Math.max(totalGiving, 1)

  const winChanges: number[] = []
  const playoffChanges: number[] = []
  const champChanges: number[] = []
  const strengthChanges: number[] = []

  for (let i = 0; i < iterations; i++) {
    let simGivingValue = 0
    for (let j = 0; j < givingValues.length; j++) {
      simGivingValue += gaussianRandom(givingValues[j], givingValues[j] * givingVolatilities[j])
    }

    let simReceivingValue = 0
    for (let j = 0; j < receivingValues.length; j++) {
      simReceivingValue += gaussianRandom(receivingValues[j], receivingValues[j] * receivingVolatilities[j])
    }

    const simDelta = simReceivingValue - simGivingValue
    const normalizedDelta = simDelta / Math.max(totalGiving + totalReceiving, 1) * 100

    const winChange = normalizedDelta * 0.3
    const playoffChange = normalizedDelta * 0.25
    const champChange = normalizedDelta * 0.15
    const strengthChange = normalizedDelta

    winChanges.push(winChange)
    playoffChanges.push(playoffChange)
    champChanges.push(champChange)
    strengthChanges.push(strengthChange)
  }

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length
  const percentile = (arr: number[], p: number) => {
    const sorted = [...arr].sort((a, b) => a - b)
    const idx = Math.floor(sorted.length * p / 100)
    return sorted[Math.min(idx, sorted.length - 1)]
  }

  const avgWinChange = avg(winChanges)
  const avgPlayoffChange = avg(playoffChanges)
  const avgChampChange = avg(champChanges)
  const avgStrengthChange = avg(strengthChanges)

  const riskFactors: string[] = []
  const stdDev = Math.sqrt(strengthChanges.reduce((s, v) => s + (v - avgStrengthChange) ** 2, 0) / iterations)

  if (stdDev > 15) riskFactors.push('High outcome variance')
  if (scenario.assets.giving.some(a => a.position === 'RB')) riskFactors.push('Trading RB (short shelf life)')
  if (scenario.assets.receiving.length > scenario.assets.giving.length) riskFactors.push('Adding roster depth (consolidation trade)')
  if (scenario.assets.giving.length > scenario.assets.receiving.length) riskFactors.push('Reducing roster depth (consolidation risk)')
  if (valueDelta < -50) riskFactors.push('Giving up more value than receiving')
  if (scenario.weatherImpact) riskFactors.push(`Weather factor: ${scenario.weatherImpact}`)

  const riskLevel = riskFactors.length >= 4 ? 'extreme'
    : riskFactors.length >= 3 ? 'high'
    : riskFactors.length >= 2 ? 'moderate'
    : 'low'

  const bestCase = `+${Math.round(percentile(strengthChanges, 90))} roster value`
  const expectedCase = `${avgStrengthChange >= 0 ? '+' : ''}${Math.round(avgStrengthChange)} roster value`
  const worstCase = `${Math.round(percentile(strengthChanges, 10))} roster value`

  const valueScore = clamp(50 + valueDelta / 20, 0, 100)
  const volatilityScore = clamp(100 - stdDev * 2, 0, 100)
  const upside = percentile(strengthChanges, 90)
  const downside = Math.abs(percentile(strengthChanges, 10))
  const asymmetryScore = clamp(50 + (upside - downside) * 2, 0, 100)
  const depthScore = clamp(60 + (scenario.assets.receiving.length - scenario.assets.giving.length) * 10, 0, 100)

  const overallScore = Math.round(valueScore * 0.4 + volatilityScore * 0.2 + asymmetryScore * 0.25 + depthScore * 0.15)
  const overallGrade = scoreGrade(overallScore)

  const reportCard: ReportCard = {
    overallGrade,
    categories: [
      {
        name: 'Value',
        grade: scoreGrade(valueScore),
        score: Math.round(valueScore),
        explanation: valueDelta >= 0
          ? `You're receiving ${Math.abs(Math.round(valueDelta))} more value than giving up`
          : `You're giving up ${Math.abs(Math.round(valueDelta))} more value than receiving`,
      },
      {
        name: 'Risk/Stability',
        grade: scoreGrade(volatilityScore),
        score: Math.round(volatilityScore),
        explanation: stdDev > 15 ? 'High variance in outcomes — this trade is a gamble' : 'Relatively stable outcome distribution',
      },
      {
        name: 'Upside Potential',
        grade: scoreGrade(asymmetryScore),
        score: Math.round(asymmetryScore),
        explanation: upside > downside
          ? `More upside (${Math.round(upside)}) than downside risk (${Math.round(downside)})`
          : `More downside risk (${Math.round(downside)}) than upside (${Math.round(upside)})`,
      },
      {
        name: 'Roster Depth',
        grade: scoreGrade(depthScore),
        score: Math.round(depthScore),
        explanation: scenario.assets.receiving.length > scenario.assets.giving.length
          ? 'Adding roster depth improves injury insurance'
          : scenario.assets.receiving.length < scenario.assets.giving.length
          ? 'Consolidating talent — higher ceiling but less depth'
          : 'Neutral impact on roster depth',
      },
    ],
    verdict: overallScore >= 70
      ? 'This trade looks favorable based on simulation results.'
      : overallScore >= 50
      ? 'This trade is roughly neutral — context and league dynamics matter.'
      : 'This trade carries significant risk. Proceed with caution.',
    keyTakeaways: [
      `${iterations} Monte Carlo simulations ran`,
      `Expected outcome: ${expectedCase}`,
      `Win probability ${avgWinChange >= 0 ? 'increases' : 'decreases'} by ${Math.abs(Math.round(avgWinChange * 10) / 10)}%`,
      `${riskFactors.length} risk factors identified`,
    ],
  }

  return {
    iterations,
    winProbability: {
      before: baseWinProb,
      after: clamp(baseWinProb + avgWinChange, 0, 100),
      change: Math.round(avgWinChange * 10) / 10,
    },
    playoffProbability: {
      before: basePlayoffProb,
      after: clamp(basePlayoffProb + avgPlayoffChange, 0, 100),
      change: Math.round(avgPlayoffChange * 10) / 10,
    },
    championshipProbability: {
      before: baseChampProb,
      after: clamp(baseChampProb + avgChampChange, 0, 100),
      change: Math.round(avgChampChange * 10) / 10,
    },
    rosterStrength: {
      before: 50,
      after: clamp(50 + avgStrengthChange, 0, 100),
      change: Math.round(avgStrengthChange * 10) / 10,
    },
    riskProfile: { level: riskLevel, factors: riskFactors },
    distribution: { bestCase, expectedCase, worstCase },
    grade: overallGrade,
    summary: reportCard.verdict,
    reportCard,
  }
}

export async function saveSimulationRun(
  userId: string,
  sleeperUsername: string | undefined,
  leagueId: string | undefined,
  scenario: SimulationScenario,
  result: SimulationResult
): Promise<string> {
  const run = await prisma.simulationRun.create({
    data: {
      userId,
      sleeperUsername,
      leagueId,
      simulationType: scenario.type,
      scenario: scenario as any,
      results: result as any,
      iterations: result.iterations,
      confidence: 0.7 + (result.iterations / 10000) * 0.2,
      summary: result.summary,
    },
  })
  return run.id
}

export async function getSimulationHistory(
  userId: string,
  limit: number = 10
): Promise<any[]> {
  return prisma.simulationRun.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}
