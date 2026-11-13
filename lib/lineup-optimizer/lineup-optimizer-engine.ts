/**
 * AI Lineup Optimizer Engine
 *
 * Strategy-aware lineup optimization. Not just highest projected points —
 * considers floor/ceiling, matchup context, risk, weather, and strategic mode.
 *
 * Modes: balanced, safe, upside, favored, underdog, projection_max, chaos_mode
 * Pure deterministic. <20ms.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const LineupStrategyEnum = z.enum([
  'balanced', 'safe', 'upside', 'favored', 'underdog', 'projection_max', 'chaos_mode',
])
export type LineupStrategy = z.infer<typeof LineupStrategyEnum>

export interface LineupPlayer {
  playerId: string
  playerName: string
  team: string | null
  position: string
  projection: number
  floor: number
  ceiling: number
  volatility: number
  injuryStatus: string
  weatherFactor: number
  matchupRating: number // 0-100, higher=better matchup
  eligibleSlots: string[]
  isLocked: boolean
}

export const LineupOptimizerInputSchema = z.object({
  sport: z.string().default('NFL'),
  scoringFormat: z.string().default('PPR'),
  lineupSlots: z.array(z.string()),
  players: z.array(z.object({
    playerId: z.string(), playerName: z.string(), team: z.string().nullable(),
    position: z.string(), projection: z.number(), floor: z.number(), ceiling: z.number(),
    volatility: z.number().default(0.2), injuryStatus: z.string().default('healthy'),
    weatherFactor: z.number().default(1.0), matchupRating: z.number().default(50),
    eligibleSlots: z.array(z.string()), isLocked: z.boolean().default(false),
  })),
  strategyMode: LineupStrategyEnum.default('balanced'),
  riskTolerance: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
})
export type LineupOptimizerInput = z.infer<typeof LineupOptimizerInputSchema>

export interface LineupSlotResult {
  slot: string
  playerId: string
  playerName: string
  team: string | null
  position: string
  reason: string
  confidence: number
  floorLabel: string
  ceilingLabel: string
  riskLabel: string
}

export interface BenchRecommendation {
  playerId: string
  playerName: string
  whyBenched: string
  startIf: string
}

export interface PivotOption {
  slot: string
  recommendedStarter: string
  alternateStarter: string
  whenToUseAlternate: string
}

export interface LineupOptimizerResult {
  strategyMode: string
  confidencePct: number
  projectedPoints: number
  winImpactSummary: string
  lineup: LineupSlotResult[]
  benchRecommendations: BenchRecommendation[]
  pivotOptions: PivotOption[]
  trapWarnings: string[]
  leverageSwaps: string[]
  weatherWarnings: string[]
  injuryRiskWarnings: string[]
  xFactors: string[]
  summary: string
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function computePlayerScore(player: LineupPlayer, strategy: LineupStrategy): number {
  const weights: Record<string, { proj: number; floor: number; ceiling: number; matchup: number }> = {
    balanced:       { proj: 0.40, floor: 0.20, ceiling: 0.20, matchup: 0.20 },
    safe:           { proj: 0.25, floor: 0.45, ceiling: 0.10, matchup: 0.20 },
    upside:         { proj: 0.20, floor: 0.05, ceiling: 0.55, matchup: 0.20 },
    favored:        { proj: 0.30, floor: 0.40, ceiling: 0.10, matchup: 0.20 },
    underdog:       { proj: 0.15, floor: 0.05, ceiling: 0.55, matchup: 0.25 },
    projection_max: { proj: 0.70, floor: 0.05, ceiling: 0.15, matchup: 0.10 },
    chaos_mode:     { proj: 0.05, floor: 0.00, ceiling: 0.70, matchup: 0.25 },
  }
  const w = weights[strategy] ?? weights.balanced

  // Normalize scores to 0-100
  const projScore = clamp(player.projection * 3, 0, 100) // ~33pts = 100
  const floorScore = clamp(player.floor * 4, 0, 100)     // ~25pts = 100
  const ceilingScore = clamp(player.ceiling * 2.5, 0, 100) // ~40pts = 100
  const matchupScore = player.matchupRating

  let score = projScore * w.proj + floorScore * w.floor + ceilingScore * w.ceiling + matchupScore * w.matchup

  // Weather penalty
  if (player.weatherFactor < 0.9) score *= player.weatherFactor

  // Injury penalty
  if (player.injuryStatus === 'questionable') score *= 0.85
  if (player.injuryStatus === 'doubtful') score *= 0.50
  if (player.injuryStatus === 'out' || player.injuryStatus === 'ir') score *= 0

  return Math.round(score * 10) / 10
}

function labelFromScore(score: number, type: 'floor' | 'ceiling' | 'risk'): string {
  if (type === 'floor') return score >= 12 ? 'High Floor' : score >= 7 ? 'Moderate Floor' : 'Low Floor'
  if (type === 'ceiling') return score >= 30 ? 'Smash Ceiling' : score >= 20 ? 'Good Ceiling' : 'Limited Ceiling'
  return score <= 0.15 ? 'Low Risk' : score <= 0.25 ? 'Moderate Risk' : 'High Risk'
}

// ---------------------------------------------------------------------------
// Slot Solver (greedy assignment)
// ---------------------------------------------------------------------------

function solveLineup(
  players: Array<LineupPlayer & { score: number }>,
  slots: string[],
): Array<{ slot: string; player: LineupPlayer & { score: number } } | null> {
  const assigned = new Set<string>()
  const result: Array<{ slot: string; player: LineupPlayer & { score: number } } | null> = []

  // Sort players by score descending
  const sorted = [...players].sort((a, b) => b.score - a.score)

  for (const slot of slots) {
    // Locked players first
    const locked = sorted.find(p => p.isLocked && p.eligibleSlots.includes(slot) && !assigned.has(p.playerId))
    if (locked) {
      assigned.add(locked.playerId)
      result.push({ slot, player: locked })
      continue
    }

    // Best available for this slot
    const best = sorted.find(p => p.eligibleSlots.includes(slot) && !assigned.has(p.playerId))
    if (best) {
      assigned.add(best.playerId)
      result.push({ slot, player: best })
    } else {
      result.push(null)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function optimizeLineup(input: LineupOptimizerInput): LineupOptimizerResult {
  const strategy = input.strategyMode

  // Score all players
  const scoredPlayers = input.players.map(p => ({
    ...p,
    score: computePlayerScore(p, strategy),
  }))

  // Solve lineup
  const solution = solveLineup(scoredPlayers, input.lineupSlots)

  // Build lineup results
  const lineup: LineupSlotResult[] = solution.map((s, i) => {
    if (!s) return {
      slot: input.lineupSlots[i], playerId: '', playerName: 'EMPTY',
      team: null, position: '', reason: 'No eligible player available',
      confidence: 0, floorLabel: '', ceilingLabel: '', riskLabel: '',
    }
    const p = s.player
    const confidence = clamp(Math.round(p.score * 1.5), 20, 95)
    return {
      slot: s.slot, playerId: p.playerId, playerName: p.playerName,
      team: p.team, position: p.position,
      reason: p.isLocked ? 'Locked by user'
        : p.matchupRating >= 70 ? `Strong matchup (${p.matchupRating}/100) + ${strategy === 'safe' ? 'high floor' : strategy === 'upside' ? 'high ceiling' : 'best projection'}`
        : `Best ${strategy} option for this slot (score: ${p.score})`,
      confidence,
      floorLabel: labelFromScore(p.floor, 'floor'),
      ceilingLabel: labelFromScore(p.ceiling, 'ceiling'),
      riskLabel: labelFromScore(p.volatility, 'risk'),
    }
  })

  // Bench recommendations
  const startedIds = new Set(lineup.map(l => l.playerId))
  const benched = scoredPlayers.filter(p => !startedIds.has(p.playerId) && p.score > 0)
  const benchRecommendations: BenchRecommendation[] = benched.slice(0, 4).map(p => ({
    playerId: p.playerId, playerName: p.playerName,
    whyBenched: p.injuryStatus !== 'healthy' ? `Injury: ${p.injuryStatus}`
      : p.score < 30 ? 'Lower projection than starters'
      : 'Close call — monitor for game-time updates',
    startIf: p.injuryStatus !== 'healthy' ? 'Confirmed active before game time'
      : `A starter at ${p.position} is ruled out or downgraded`,
  }))

  // Pivot options (close decisions)
  const pivotOptions: PivotOption[] = []
  for (const slot of lineup) {
    const alternatives = benched.filter(b =>
      b.eligibleSlots?.includes(slot.slot) && Math.abs(b.score - (scoredPlayers.find(s => s.playerId === slot.playerId)?.score ?? 0)) < 8,
    )
    if (alternatives.length > 0) {
      pivotOptions.push({
        slot: slot.slot, recommendedStarter: slot.playerName,
        alternateStarter: alternatives[0].playerName,
        whenToUseAlternate: `If ${slot.playerName} is downgraded or you need ${strategy === 'upside' ? 'more ceiling' : 'a safer floor'}`,
      })
    }
  }

  // Warnings
  const trapWarnings = scoredPlayers
    .filter(p => startedIds.has(p.playerId) && p.volatility > 0.3 && p.floor < 5)
    .map(p => `${p.playerName} — high variance with low floor. Trap start risk.`)

  const weatherWarnings = scoredPlayers
    .filter(p => startedIds.has(p.playerId) && p.weatherFactor < 0.9)
    .map(p => `${p.playerName} — weather impact (${Math.round((1 - p.weatherFactor) * 100)}% reduction)`)

  const injuryRiskWarnings = scoredPlayers
    .filter(p => startedIds.has(p.playerId) && p.injuryStatus !== 'healthy')
    .map(p => `${p.playerName} — ${p.injuryStatus}. Monitor before lock.`)

  const projectedPoints = lineup.reduce((s, l) => {
    const p = scoredPlayers.find(sp => sp.playerId === l.playerId)
    return s + (p?.projection ?? 0)
  }, 0)

  return {
    strategyMode: strategy, confidencePct: lineup.length > 0 ? 70 : 20,
    projectedPoints: Math.round(projectedPoints * 10) / 10,
    winImpactSummary: `${strategy} lineup projects ${projectedPoints.toFixed(1)} points with ${trapWarnings.length} trap risks and ${pivotOptions.length} close calls.`,
    lineup, benchRecommendations, pivotOptions,
    trapWarnings, leverageSwaps: [], weatherWarnings, injuryRiskWarnings,
    xFactors: scoredPlayers.filter(p => startedIds.has(p.playerId) && p.ceiling >= 30).map(p => `${p.playerName} has smash ceiling (${p.ceiling} pts)`).slice(0, 3),
    summary: `Optimized for ${strategy} strategy. ${lineup.filter(l => l.playerId).length} starters set, ${benchRecommendations.length} bench options ready.`,
    generatedAt: new Date().toISOString(),
  }
}
