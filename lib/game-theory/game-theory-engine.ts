/**
 * AI Game Theory Engine
 *
 * Strategic decision intelligence: evaluates matchup state, opponent behavior,
 * leverage opportunities, and recommends optimal posture (safe/aggressive/chaos).
 * Poker-style reasoning for fantasy sports.
 *
 * Pure deterministic. <10ms.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StrategicPosture = 'safe' | 'balanced' | 'aggressive' | 'chaos' | 'block_and_protect'

interface GameTheoryPlayer {
  playerId: string
  playerName: string
  position: string
  projection: number
  floor: number
  ceiling: number
  volatility: number
}

export const GameTheoryInputSchema = z.object({
  sport: z.string().default('NFL'),
  userProjectedTotal: z.number(),
  opponentProjectedTotal: z.number(),
  userPlayers: z.array(z.object({
    playerId: z.string(), playerName: z.string(), position: z.string(),
    projection: z.number(), floor: z.number(), ceiling: z.number(),
    volatility: z.number().default(0.2),
  })),
  opponentPlayers: z.array(z.object({
    playerId: z.string(), playerName: z.string(), position: z.string(),
    projection: z.number(), floor: z.number(), ceiling: z.number(),
    volatility: z.number().default(0.2),
  })),
  isPlayoff: z.boolean().default(false),
  weekNumber: z.number().default(1),
  riskTolerance: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
  opponentArchetype: z.string().optional(),
})
type GameTheoryInput = z.infer<typeof GameTheoryInputSchema>

interface DecisionPath {
  pathLabel: string
  useCase: string
  move: string
  expectedBenefit: string
  riskLevel: 'low' | 'medium' | 'high'
}

interface GameTheoryResult {
  decisionMode: string
  confidencePct: number
  strategicPosture: StrategicPosture
  winProbabilityImpactSummary: string
  coreRecommendation: string
  whyThisIsOptimal: string
  leveragePlays: string[]
  safePlays: string[]
  aggressivePlays: string[]
  trapPlays: string[]
  counterfactualNotes: string[]
  opponentResponseRisks: string[]
  playoffPressureNotes: string[]
  summary: string
  generatedAt: string
  bestDecisionTree: DecisionPath[]
  leverageScore: number
  volatilityNeedScore: number
  opponentFragilityScore: number
  blockValueScore: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)) }

// ---------------------------------------------------------------------------
// Posture Classification
// ---------------------------------------------------------------------------

function classifyPosture(
  projDiff: number,
  isPlayoff: boolean,
  riskTol: string,
  oppFragility: number,
): StrategicPosture {
  // Heavily favored → safe
  if (projDiff >= 15) return 'safe'
  if (projDiff >= 8 && isPlayoff) return 'safe'
  if (projDiff >= 8) return 'balanced'

  // Close matchup → balanced with risk tolerance influence
  if (Math.abs(projDiff) < 8) {
    if (riskTol === 'aggressive') return 'aggressive'
    if (riskTol === 'conservative') return 'safe'
    return 'balanced'
  }

  // Underdog → aggressive/chaos
  if (projDiff <= -15) return 'chaos'
  if (projDiff <= -8) return 'aggressive'

  // Opponent is fragile → block
  if (oppFragility >= 70 && projDiff >= 0) return 'block_and_protect'

  return 'balanced'
}

// ---------------------------------------------------------------------------
// Leverage Analysis
// ---------------------------------------------------------------------------

function computeLeverageScore(userPlayers: GameTheoryPlayer[], oppPlayers: GameTheoryPlayer[]): number {
  // How many high-leverage decisions exist
  const userHighVar = userPlayers.filter(p => p.ceiling - p.floor >= 15)
  const oppHighVar = oppPlayers.filter(p => p.ceiling - p.floor >= 15)
  return clamp(Math.round((userHighVar.length + oppHighVar.length) * 12), 0, 100)
}

function computeVolatilityNeed(projDiff: number): number {
  // Negative diff = need more volatility
  if (projDiff <= -15) return 90
  if (projDiff <= -8) return 70
  if (projDiff <= -3) return 55
  if (projDiff >= 15) return 10
  if (projDiff >= 8) return 25
  return 45
}

function computeOpponentFragility(oppPlayers: GameTheoryPlayer[]): number {
  const total = oppPlayers.reduce((s, p) => s + p.projection, 0)
  if (total <= 0) return 50
  const topPlayer = [...oppPlayers].sort((a, b) => b.projection - a.projection)[0]
  const concentration = topPlayer ? topPlayer.projection / total : 0
  const highVol = oppPlayers.filter(p => p.volatility >= 0.3).length
  return clamp(Math.round(concentration * 150 + highVol * 15), 0, 100)
}

function computeBlockValue(oppPlayers: GameTheoryPlayer[], posture: StrategicPosture): number {
  if (posture !== 'block_and_protect' && posture !== 'safe') return 0
  const oppTopPlayers = [...oppPlayers].sort((a, b) => b.projection - a.projection).slice(0, 2)
  const blockableValue = oppTopPlayers.reduce((s, p) => s + (p.ceiling - p.projection), 0)
  return clamp(Math.round(blockableValue * 2), 0, 100)
}

// ---------------------------------------------------------------------------
// Play Classification
// ---------------------------------------------------------------------------

function findLeveragePlays(userPlayers: GameTheoryPlayer[], posture: StrategicPosture): string[] {
  const plays: string[] = []
  const sorted = [...userPlayers].sort((a, b) => (b.ceiling - b.floor) - (a.ceiling - a.floor))
  for (const p of sorted.slice(0, 3)) {
    const range = p.ceiling - p.floor
    if (range >= 15) {
      plays.push(`${p.playerName}: ${p.floor.toFixed(0)}-${p.ceiling.toFixed(0)} range — ${posture === 'aggressive' || posture === 'chaos' ? 'START for ceiling' : 'high-leverage decision'}`)
    }
  }
  return plays
}

function findSafePlays(userPlayers: GameTheoryPlayer[]): string[] {
  return userPlayers
    .filter(p => p.floor >= 10 && p.volatility <= 0.18)
    .sort((a, b) => b.floor - a.floor)
    .slice(0, 3)
    .map(p => `${p.playerName}: ${p.floor.toFixed(0)}+ floor — reliable production`)
}

function findTrapPlays(userPlayers: GameTheoryPlayer[]): string[] {
  return userPlayers
    .filter(p => p.projection >= 10 && p.floor < 4 && p.volatility >= 0.3)
    .slice(0, 2)
    .map(p => `${p.playerName}: projects ${p.projection.toFixed(0)} but floor is ${p.floor.toFixed(0)} — trap start risk`)
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function analyzeGameTheory(input: GameTheoryInput): GameTheoryResult {
  const projDiff = input.userProjectedTotal - input.opponentProjectedTotal
  const oppFragility = computeOpponentFragility(input.opponentPlayers)
  const posture = classifyPosture(projDiff, input.isPlayoff, input.riskTolerance, oppFragility)
  const leverageScore = computeLeverageScore(input.userPlayers, input.opponentPlayers)
  const volatilityNeed = computeVolatilityNeed(projDiff)
  const blockValue = computeBlockValue(input.opponentPlayers, posture)

  const leveragePlays = findLeveragePlays(input.userPlayers, posture)
  const safePlays = findSafePlays(input.userPlayers)
  const trapPlays = findTrapPlays(input.userPlayers)

  const aggressivePlays = input.userPlayers
    .filter(p => p.ceiling >= 25 && p.volatility >= 0.25)
    .slice(0, 3)
    .map(p => `${p.playerName}: ceiling ${p.ceiling.toFixed(0)} — upside play for underdog scenarios`)

  const coreRec = posture === 'safe'
    ? 'Play your highest-floor lineup. You are favored — protect the lead.'
    : posture === 'aggressive'
      ? 'Lean into ceiling. You need your players to outperform projections.'
      : posture === 'chaos'
        ? 'Maximum volatility. Start every boom-or-bust option — you need variance to win.'
        : posture === 'block_and_protect'
          ? 'Opponent is fragile. Play your floor and let their variance work against them.'
          : 'Balanced approach. Mix reliable floor with selective upside at FLEX positions.'

  const whyOptimal = posture === 'safe'
    ? `You\'re projected +${projDiff.toFixed(1)} ahead. Taking risks only gives your opponent more paths to win.`
    : posture === 'aggressive' || posture === 'chaos'
      ? `You\'re projected ${Math.abs(projDiff).toFixed(1)} behind. Playing safe guarantees a loss — variance is your ally.`
      : posture === 'block_and_protect'
        ? `Opponent fragility score is ${oppFragility}/100. They need boom weeks to beat you — deny them by playing stable.`
        : `Close matchup (${Math.abs(projDiff).toFixed(1)} pt margin). Need a blend of floor and ceiling.`

  const counterfactuals: string[] = []
  if (posture === 'safe') counterfactuals.push('If you play aggressive instead: you increase variance unnecessarily, giving the underdog more paths to upset you.')
  if (posture === 'aggressive') counterfactuals.push('If you play safe instead: you accept the projected loss. Only variance gives you a chance.')
  if (posture === 'balanced') counterfactuals.push('Playing all-safe caps your ceiling. Playing all-aggressive exposes you to a collapse. Balance is optimal here.')

  const oppRisks: string[] = []
  if (oppFragility >= 60) oppRisks.push('Opponent is fragile — if their top player busts, they collapse')
  if (input.opponentArchetype === 'Gambler') oppRisks.push('Opponent is a Gambler — expect volatile lineup choices')
  if (input.opponentArchetype === 'Shark') oppRisks.push('Opponent is a Shark — expect optimal decisions')

  const playoffNotes: string[] = []
  if (input.isPlayoff) {
    playoffNotes.push('Playoff context: every point matters. Avoid unnecessary risk unless trailing.')
    if (posture === 'safe') playoffNotes.push('Protect the lead — one bad gamble can end your season.')
  }

  const confidence = clamp(55 + (input.userPlayers.length >= 7 ? 15 : 0) + (Math.abs(projDiff) >= 10 ? 10 : 0) + (input.isPlayoff ? 5 : 0), 30, 90)

  const decisionTree: DecisionPath[] = [
    { pathLabel: 'Safe Path', useCase: 'If favored or protecting lead', move: safePlays[0] ?? 'Play highest-floor options', expectedBenefit: 'Minimize upset risk', riskLevel: 'low' },
    { pathLabel: 'Balanced Path', useCase: 'If matchup is close', move: 'Mix floor starters with 1-2 upside FLEX plays', expectedBenefit: 'Competitive in most outcomes', riskLevel: 'medium' },
    { pathLabel: 'Aggressive Path', useCase: 'If underdog or need ceiling', move: aggressivePlays[0] ?? 'Start highest-ceiling options', expectedBenefit: 'Maximize win probability when trailing', riskLevel: 'high' },
  ]

  return {
    decisionMode: posture, confidencePct: confidence, strategicPosture: posture,
    winProbabilityImpactSummary: `Projected margin: ${projDiff > 0 ? '+' : ''}${projDiff.toFixed(1)}. ${posture === 'safe' ? 'Safe play maximizes win probability.' : posture === 'aggressive' ? 'Aggressive play is necessary to overcome the deficit.' : 'Balanced play optimizes for this close matchup.'}`,
    coreRecommendation: coreRec, whyThisIsOptimal: whyOptimal,
    leveragePlays, safePlays, aggressivePlays, trapPlays,
    counterfactualNotes: counterfactuals, opponentResponseRisks: oppRisks,
    playoffPressureNotes: playoffNotes,
    summary: `${posture.replace(/_/g, ' ')} posture | Margin: ${projDiff > 0 ? '+' : ''}${projDiff.toFixed(1)} | Leverage: ${leverageScore}/100 | Volatility need: ${volatilityNeed}/100 | Opponent fragility: ${oppFragility}/100`,
    generatedAt: new Date().toISOString(),
    bestDecisionTree: decisionTree,
    leverageScore, volatilityNeedScore: volatilityNeed,
    opponentFragilityScore: oppFragility, blockValueScore: blockValue,
  }
}
