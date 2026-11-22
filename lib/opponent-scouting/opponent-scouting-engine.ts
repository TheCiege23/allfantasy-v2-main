/**
 * AI Opponent Scouting Engine
 *
 * Produces a tactical scouting report for a weekly matchup opponent.
 * Analyzes roster strength, weaknesses, swing players, lineup tendencies,
 * manager behavior, and generates counter-strategy recommendations.
 *
 * Pure deterministic. <15ms.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const ScoutingModeEnum = z.enum([
  'standard', 'favored_plan', 'underdog_plan', 'high_risk', 'playoff', 'dynasty_scout',
])
type ScoutingMode = z.infer<typeof ScoutingModeEnum>

type ThreatLevel = 'low' | 'moderate' | 'high' | 'elite'
type SwingLevel = 'low' | 'medium' | 'high'

interface ScoutingPlayer {
  playerId: string
  playerName: string
  position: string
  team: string | null
  projection: number
  floor: number
  ceiling: number
  volatility: number
  injuryStatus: string
  slot: 'starter' | 'bench'
}

interface SwingPlayer {
  playerId: string
  playerName: string
  whyImportant: string
  swingLevel: SwingLevel
}

export const OpponentScoutingInputSchema = z.object({
  sport: z.string().default('NFL'),
  scoringFormat: z.string().default('PPR'),
  weekOrSlate: z.number().default(1),
  userTeam: z.object({
    teamName: z.string(),
    starters: z.array(z.object({
      playerId: z.string(), playerName: z.string(), position: z.string(),
      team: z.string().nullable(), projection: z.number(),
      floor: z.number(), ceiling: z.number(), volatility: z.number().default(0.2),
      injuryStatus: z.string().default('healthy'), slot: z.enum(['starter', 'bench']).default('starter'),
    })),
  }),
  opponentTeam: z.object({
    teamName: z.string(),
    managerName: z.string().default('Opponent'),
    starters: z.array(z.object({
      playerId: z.string(), playerName: z.string(), position: z.string(),
      team: z.string().nullable(), projection: z.number(),
      floor: z.number(), ceiling: z.number(), volatility: z.number().default(0.2),
      injuryStatus: z.string().default('healthy'), slot: z.enum(['starter', 'bench']).default('starter'),
    })),
    bench: z.array(z.object({
      playerId: z.string(), playerName: z.string(), position: z.string(),
      team: z.string().nullable(), projection: z.number().default(0),
    })).default([]),
    archetype: z.string().optional(),
    record: z.string().optional(),
    contenderTier: z.string().optional(),
  }),
  scoutingMode: ScoutingModeEnum.default('standard'),
  riskTolerance: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
})
type OpponentScoutingInput = z.infer<typeof OpponentScoutingInputSchema>

interface OpponentScoutingResult {
  opponentName: string
  opponentManagerName: string
  matchupSummary: string
  confidencePct: number
  opponentArchetype: string
  overallThreatLevel: ThreatLevel
  opponentStrengths: string[]
  opponentWeaknesses: string[]
  likelyLineupTendencies: string[]
  managerBehaviorNotes: string[]
  leveragePoints: string[]
  attackPlan: string
  cautionAreas: string[]
  xFactors: string[]
  swingPlayers: SwingPlayer[]
  likelyOpponentMoves: string[]
  counterRecommendations: string[]
  favoredStrategy: string
  underdogStrategy: string
  summary: string
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function totalProjection(players: ScoutingPlayer[]): number {
  return players.filter(p => p.slot === 'starter').reduce((s, p) => s + p.projection, 0)
}

function avgVolatility(players: ScoutingPlayer[]): number {
  const starters = players.filter(p => p.slot === 'starter')
  if (starters.length === 0) return 0.2
  return starters.reduce((s, p) => s + p.volatility, 0) / starters.length
}

function positionStrengthMap(players: ScoutingPlayer[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const p of players.filter(s => s.slot === 'starter')) {
    map[p.position] = (map[p.position] || 0) + p.projection
  }
  return map
}

// ---------------------------------------------------------------------------
// Threat Assessment
// ---------------------------------------------------------------------------

function assessThreatLevel(oppProj: number, userProj: number, oppVol: number): ThreatLevel {
  const diff = oppProj - userProj
  if (diff >= 15 || (oppProj >= 140 && oppVol < 0.2)) return 'elite'
  if (diff >= 5 || oppProj >= 120) return 'high'
  if (diff >= -5 || oppProj >= 100) return 'moderate'
  return 'low'
}

// ---------------------------------------------------------------------------
// Strength / Weakness Detection
// ---------------------------------------------------------------------------

function detectStrengths(oppStarters: ScoutingPlayer[]): string[] {
  const strengths: string[] = []
  const posMap = positionStrengthMap(oppStarters)

  // Position-level strength
  const positions = Object.entries(posMap).sort((a, b) => b[1] - a[1])
  if (positions.length > 0) {
    strengths.push(`Strong at ${positions[0][0]} (${positions[0][1].toFixed(1)} projected points)`)
  }

  // Star power
  const topPlayer = [...oppStarters].sort((a, b) => b.projection - a.projection)[0]
  if (topPlayer && topPlayer.projection >= 20) {
    strengths.push(`Star player: ${topPlayer.playerName} (${topPlayer.projection.toFixed(1)} projected)`)
  }

  // Depth
  const startersAbove10 = oppStarters.filter(p => p.projection >= 10).length
  if (startersAbove10 >= 6) {
    strengths.push(`Deep lineup — ${startersAbove10} starters projecting 10+ points`)
  }

  // Consistency
  const avgVol = avgVolatility(oppStarters)
  if (avgVol < 0.18) {
    strengths.push('Consistent, low-variance lineup — hard to beat with a bad week from them')
  }

  // High floor
  const totalFloor = oppStarters.reduce((s, p) => s + p.floor, 0)
  if (totalFloor >= 80) {
    strengths.push(`High floor (${totalFloor.toFixed(0)} pts) — unlikely to collapse`)
  }

  return strengths.slice(0, 5)
}

function detectWeaknesses(oppStarters: ScoutingPlayer[], oppBench: Array<{ playerName: string; position: string; projection: number }>): string[] {
  const weaknesses: string[] = []
  const posMap = positionStrengthMap(oppStarters)

  // Weakest position
  const positions = Object.entries(posMap).sort((a, b) => a[1] - b[1])
  if (positions.length > 0 && positions[0][1] < 10) {
    weaknesses.push(`Weak at ${positions[0][0]} (only ${positions[0][1].toFixed(1)} projected)`)
  }

  // Injury vulnerability
  const injured = oppStarters.filter(p => p.injuryStatus !== 'healthy')
  if (injured.length >= 2) {
    weaknesses.push(`${injured.length} starters with injury concerns: ${injured.map(p => p.playerName).join(', ')}`)
  }

  // High variance
  const highVol = oppStarters.filter(p => p.volatility >= 0.3)
  if (highVol.length >= 2) {
    weaknesses.push(`${highVol.length} high-variance starters — prone to bust weeks`)
  }

  // Top-heavy concentration
  const total = totalProjection(oppStarters)
  const topPlayer = [...oppStarters].sort((a, b) => b.projection - a.projection)[0]
  if (topPlayer && total > 0 && topPlayer.projection / total > 0.22) {
    weaknesses.push(`Over-reliant on ${topPlayer.playerName} (${Math.round((topPlayer.projection / total) * 100)}% of output)`)
  }

  // Thin bench
  const viableBench = oppBench.filter(p => p.projection >= 8)
  if (viableBench.length <= 1) {
    weaknesses.push('Thin bench — one injury could collapse their lineup')
  }

  // Low ceiling
  const totalCeiling = oppStarters.reduce((s, p) => s + p.ceiling, 0)
  if (totalCeiling < 150) {
    weaknesses.push(`Limited ceiling (${totalCeiling.toFixed(0)} max) — capped upside`)
  }

  return weaknesses.slice(0, 5)
}

// ---------------------------------------------------------------------------
// Swing Players
// ---------------------------------------------------------------------------

function identifySwingPlayers(oppStarters: ScoutingPlayer[], userStarters: ScoutingPlayer[]): SwingPlayer[] {
  const allPlayers = [
    ...oppStarters.map(p => ({ ...p, side: 'opp' as const })),
    ...userStarters.map(p => ({ ...p, side: 'user' as const })),
  ]

  return allPlayers
    .flatMap((p): SwingPlayer[] => {
      const range = p.ceiling - p.floor
      const impact = range * (p.projection / 100)
      const swingLevel: SwingLevel = impact >= 15 ? 'high' : impact >= 8 ? 'medium' : 'low'

      if (swingLevel === 'low') return []

      const sideLabel = p.side === 'opp' ? 'Opponent' : 'Your'
      const whyImportant = p.volatility >= 0.3
        ? `${sideLabel} ${p.playerName} is boom-or-bust (floor ${p.floor.toFixed(0)}, ceiling ${p.ceiling.toFixed(0)}). This matchup may hinge on their output.`
        : `${sideLabel} ${p.playerName} has a wide range (${p.floor.toFixed(0)}-${p.ceiling.toFixed(0)}). A big game shifts everything.`

      return [{ playerId: p.playerId, playerName: p.playerName, whyImportant, swingLevel }]
    })
    .sort((a, b) => (b.swingLevel === 'high' ? 2 : b.swingLevel === 'medium' ? 1 : 0) - (a.swingLevel === 'high' ? 2 : a.swingLevel === 'medium' ? 1 : 0))
    .slice(0, 6)
}

// ---------------------------------------------------------------------------
// Leverage & Counter Strategy
// ---------------------------------------------------------------------------

function detectLeveragePoints(oppStarters: ScoutingPlayer[], userStarters: ScoutingPlayer[]): string[] {
  const leverage: string[] = []

  // Find position matchup advantages
  const oppByPos = positionStrengthMap(oppStarters)
  const userByPos = positionStrengthMap(userStarters)

  for (const pos of Object.keys(userByPos)) {
    const userStrength = userByPos[pos] ?? 0
    const oppStrength = oppByPos[pos] ?? 0
    if (userStrength > oppStrength + 8) {
      leverage.push(`Your ${pos} projects ${(userStrength - oppStrength).toFixed(1)} points above theirs — key advantage`)
    }
  }

  // Opponent injury leverage
  const oppInjured = oppStarters.filter(p => p.injuryStatus !== 'healthy' && p.projection >= 8)
  for (const p of oppInjured.slice(0, 2)) {
    leverage.push(`${p.playerName} is ${p.injuryStatus} — if they sit, opponent loses ${p.projection.toFixed(1)} projected points`)
  }

  // Volatility leverage
  const oppVolatile = oppStarters.filter(p => p.volatility >= 0.3 && p.projection >= 10)
  if (oppVolatile.length >= 2) {
    leverage.push(`Opponent has ${oppVolatile.length} high-variance starters — if they bust, you win easily`)
  }

  return leverage.slice(0, 4)
}

function buildCounterRecommendations(
  threatLevel: ThreatLevel,
  oppWeaknesses: string[],
  leveragePoints: string[],
  mode: ScoutingMode,
): string[] {
  const recs: string[] = []

  if (threatLevel === 'elite' || threatLevel === 'high') {
    recs.push('This is a tough matchup. Play your highest-upside lineup to have a shot.')
    if (oppWeaknesses.some(w => w.includes('high-variance'))) {
      recs.push('Their variance is your friend — if they bust, you win. Play your floor and let them beat themselves.')
    }
  } else if (threatLevel === 'low') {
    recs.push('You are heavily favored. Play your safe, high-floor lineup. Do not take unnecessary risks.')
    recs.push('Avoid starting volatile boom-or-bust options — you don\'t need them this week.')
  } else {
    recs.push('Competitive matchup. Play a balanced lineup — lean toward upside at FLEX positions.')
  }

  if (leveragePoints.length > 0) {
    recs.push('Exploit your position advantages: ' + leveragePoints[0])
  }

  if (mode === 'playoff') {
    recs.push('Playoffs — every point matters. Prioritize floor over ceiling unless projected behind.')
  }

  return recs.slice(0, 4)
}

function buildFavoredStrategy(oppWeaknesses: string[]): string {
  const parts = ['You are favored. Protect the lead with safe, high-floor starters.']
  if (oppWeaknesses.some(w => w.includes('Thin bench'))) {
    parts.push('Their bench is thin — any injury to their starters is devastating.')
  }
  parts.push('Avoid volatile plays. Let consistency win you the week.')
  return parts.join(' ')
}

function buildUnderdogStrategy(oppStrengths: string[], oppWeaknesses: string[]): string {
  const parts = ['You are the underdog. Maximize ceiling and embrace variance.']
  if (oppWeaknesses.some(w => w.includes('high-variance'))) {
    parts.push('Their volatile players could bust — match that volatility and hope for the right outcome.')
  }
  if (oppStrengths.some(s => s.includes('Star player'))) {
    parts.push('You can\'t stop their star — focus on outscoring everywhere else.')
  }
  parts.push('Play your highest-ceiling options at FLEX. This is not the week for safe floors.')
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// Manager Behavior Notes
// ---------------------------------------------------------------------------

function buildManagerNotes(archetype?: string): string[] {
  if (!archetype) return ['No manager behavior data available.']
  const notes: string[] = []
  switch (archetype) {
    case 'Shark': notes.push('Elite manager — expect optimal lineup decisions. No mistakes to exploit.'); break
    case 'Taco': notes.push('Prone to suboptimal decisions — likely to leave points on the bench.'); break
    case 'Hoarder': notes.push('Rarely makes roster moves. Expect the same lineup they\'ve been running.'); break
    case 'Impulsive': notes.push('Reactive manager — may make last-minute lineup changes based on news.'); break
    case 'Gambler': notes.push('Loves upside plays — expect volatile lineup choices.'); break
    default: notes.push(`Manager archetype: ${archetype}. Adjust expectations accordingly.`); break
  }
  return notes
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function generateScoutingReport(input: OpponentScoutingInput): OpponentScoutingResult {
  const opp = input.opponentTeam
  const user = input.userTeam
  const oppStarters = opp.starters as ScoutingPlayer[]
  const userStarters = user.starters as ScoutingPlayer[]
  const oppBench = opp.bench

  const oppProj = totalProjection(oppStarters)
  const userProj = totalProjection(userStarters)
  const oppVol = avgVolatility(oppStarters)

  const threatLevel = assessThreatLevel(oppProj, userProj, oppVol)
  const strengths = detectStrengths(oppStarters)
  const weaknesses = detectWeaknesses(oppStarters, oppBench)
  const swingPlayers = identifySwingPlayers(oppStarters, userStarters)
  const leveragePoints = detectLeveragePoints(oppStarters, userStarters)
  const counterRecs = buildCounterRecommendations(threatLevel, weaknesses, leveragePoints, input.scoutingMode)
  const managerNotes = buildManagerNotes(opp.archetype)
  const favoredStrategy = buildFavoredStrategy(weaknesses)
  const underdogStrategy = buildUnderdogStrategy(strengths, weaknesses)

  // X-factors
  const xFactors: string[] = []
  const oppInjured = oppStarters.filter(p => p.injuryStatus !== 'healthy')
  if (oppInjured.length > 0) xFactors.push(`Injury watch: ${oppInjured.map(p => `${p.playerName} (${p.injuryStatus})`).join(', ')}`)
  const highCeilingOpp = oppStarters.filter(p => p.ceiling >= 30)
  if (highCeilingOpp.length > 0) xFactors.push(`Smash potential: ${highCeilingOpp.map(p => p.playerName).join(', ')} can single-handedly win the week`)

  // Lineup tendencies
  const tendencies: string[] = []
  if (oppVol < 0.18) tendencies.push('Conservative lineup builder — prefers safe, proven options')
  else if (oppVol > 0.28) tendencies.push('Aggressive lineup builder — chases upside and ceiling')
  else tendencies.push('Balanced lineup approach — mix of floor and ceiling')
  const oppHighEnd = oppStarters.filter(p => p.projection >= 15).length
  tendencies.push(`Starts ${oppHighEnd} high-projection player${oppHighEnd !== 1 ? 's' : ''} (15+ pts)`)

  // Caution areas
  const cautions: string[] = []
  if (threatLevel === 'elite') cautions.push('Do not underestimate this opponent — their lineup is elite this week')
  if (oppStarters.some(p => p.ceiling >= 35)) cautions.push('Opponent has a player who can score 35+ — game-breaking upside')
  if (weaknesses.length === 0) cautions.push('No clear weaknesses detected — this is a well-rounded team')

  const projDiff = userProj - oppProj
  const matchupSummary = projDiff > 10
    ? `You are projected to win by ${projDiff.toFixed(1)} points. Play safe and protect the lead.`
    : projDiff < -10
      ? `You are projected to lose by ${Math.abs(projDiff).toFixed(1)} points. Maximize ceiling.`
      : `Tight matchup — projected within ${Math.abs(projDiff).toFixed(1)} points. Every decision matters.`

  const confidence = clamp(60 + (strengths.length > 0 ? 10 : 0) + (weaknesses.length > 0 ? 10 : 0) - (oppInjured.length > 0 ? 5 : 0), 30, 90)

  return {
    opponentName: opp.teamName,
    opponentManagerName: opp.managerName,
    matchupSummary,
    confidencePct: confidence,
    opponentArchetype: opp.archetype ?? 'Unknown',
    overallThreatLevel: threatLevel,
    opponentStrengths: strengths,
    opponentWeaknesses: weaknesses,
    likelyLineupTendencies: tendencies,
    managerBehaviorNotes: managerNotes,
    leveragePoints,
    attackPlan: counterRecs[0] ?? 'No specific attack plan — play your best lineup.',
    cautionAreas: cautions,
    xFactors,
    swingPlayers,
    likelyOpponentMoves: [
      `Likely to ${oppVol < 0.2 ? 'keep their current lineup' : 'make 1-2 adjustments before lock'}`,
    ],
    counterRecommendations: counterRecs,
    favoredStrategy,
    underdogStrategy,
    summary: `${opp.teamName} is a ${threatLevel}-threat opponent projecting ${oppProj.toFixed(1)} points. ${strengths[0] ?? 'No clear strength.'} ${weaknesses[0] ? `Weakness: ${weaknesses[0]}.` : ''} ${swingPlayers.length > 0 ? `Key swing: ${swingPlayers[0].playerName}.` : ''}`,
    generatedAt: new Date().toISOString(),
  }
}
