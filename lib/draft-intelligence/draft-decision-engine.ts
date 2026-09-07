/**
 * Draft Decision Engine — Premium AI Draft Brain
 *
 * Takes draft state + player pool + league context → produces ranked
 * recommendations with scoring, alerts, and strategy-aware guidance.
 *
 * Pure deterministic scoring. Fast (<20ms). No AI calls.
 * Consumed by lib/draft-war-room/draft-war-room-engine.ts, reached from /api/draft-war-room.
 */

import { getAgeCurve } from '@/lib/trade-engine/sport-tuning-registry'
import { analyzeDraftBoard, type DraftBoardAnalysis } from './draft-board-analyzer'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AIStrategy = 'balanced' | 'value' | 'upside' | 'positional-need' | 'stack' | 'league-winning'

export interface DraftRosterPlayer {
  position: string
  playerName: string
  value: number
}

export interface DraftAvailablePlayer {
  playerId: string
  name: string
  position: string
  team: string | null
  adp: number
  value: number
  age: number | null
  tier: number | null
  /** Optional outlook enrichment */
  outlookTags?: string[]
  outlookTrend?: string
  outlookRiskFlags?: string[]
}

export interface DraftedPlayer {
  playerId: string
  name: string
  position: string
  teamId: string
  pickNumber: number
}

export interface DraftDecisionInput {
  draftType: string
  sport: string
  leagueFormat: string
  scoringType: string
  isSF: boolean
  isTEP: boolean
  numTeams: number
  currentPick: number
  currentRound: number
  totalRounds: number
  myTeamId: string
  myRoster: DraftRosterPlayer[]
  availablePlayers: DraftAvailablePlayer[]
  draftedByOthers: DraftedPlayer[]
  rosterRequirements: Record<string, number>
  strategy: AIStrategy
  mode: 'live' | 'mock'
}

export type PickType = 'safe' | 'balanced' | 'upside' | 'value'

export interface DraftPickRecommendation {
  playerId: string
  playerName: string
  position: string
  team: string | null
  rank: number
  pickType: PickType
  teamFitScore: number
  boardValueScore: number
  needScore: number
  overallScore: number
  reasoning: string[]
  riskFlags: string[]
  avoidNotes: string[]
  isReach: boolean
  isValue: boolean
  stackNote: string | null
  handcuffNote: string | null
}

export type DraftAlertType =
  | 'tier_break'
  | 'positional_run'
  | 'stack_opportunity'
  | 'value_cliff'
  | 'scarcity_warning'

export interface DraftAlert {
  type: DraftAlertType
  message: string
  severity: 'info' | 'warning' | 'critical'
  relatedPlayers: string[]
}

export interface DraftDecisionResult {
  recommendedPick: DraftPickRecommendation
  topAlternatives: DraftPickRecommendation[]
  alerts: DraftAlert[]
  draftPlanNote: string
  confidencePct: number
  boardAnalysis: DraftBoardAnalysis
}

// ---------------------------------------------------------------------------
// Strategy Weights
// ---------------------------------------------------------------------------

type WeightKey = 'teamFit' | 'boardValue' | 'needScore' | 'upside'

const STRATEGY_WEIGHTS: Record<AIStrategy, Record<WeightKey, number>> = {
  balanced:           { teamFit: 0.25, boardValue: 0.25, needScore: 0.25, upside: 0.25 },
  value:              { teamFit: 0.15, boardValue: 0.45, needScore: 0.25, upside: 0.15 },
  upside:             { teamFit: 0.15, boardValue: 0.15, needScore: 0.25, upside: 0.45 },
  'positional-need':  { teamFit: 0.15, boardValue: 0.15, needScore: 0.55, upside: 0.15 },
  stack:              { teamFit: 0.20, boardValue: 0.20, needScore: 0.20, upside: 0.40 },
  'league-winning':   { teamFit: 0.10, boardValue: 0.30, needScore: 0.20, upside: 0.40 },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function countByPosition(roster: DraftRosterPlayer[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const p of roster) {
    counts[p.position] = (counts[p.position] || 0) + 1
  }
  return counts
}

// ---------------------------------------------------------------------------
// Player Scoring
// ---------------------------------------------------------------------------

interface PlayerScores {
  teamFitScore: number
  boardValueScore: number
  needScore: number
  upsideScore: number
  overallScore: number
  pickType: PickType
}

function scorePlayer(
  player: DraftAvailablePlayer,
  input: DraftDecisionInput,
  positionGaps: Record<string, number>,
  scarcityMap: Record<string, number>,
): PlayerScores {
  const weights = STRATEGY_WEIGHTS[input.strategy] ?? STRATEGY_WEIGHTS.balanced

  // --- Team Fit Score (0-100) ---
  const myPositions = countByPosition(input.myRoster)
  const required = input.rosterRequirements[player.position] ?? 1
  const have = myPositions[player.position] ?? 0
  const gap = Math.max(0, required - have)
  let teamFitScore = 30 // baseline
  if (gap > 0) teamFitScore += 40 // position needed
  if (gap > 1) teamFitScore += 15 // critically needed
  // SF premium for QB
  if (input.isSF && player.position === 'QB' && (myPositions['QB'] ?? 0) < 2) {
    teamFitScore += 15
  }
  // TEP premium for TE
  if (input.isTEP && player.position === 'TE' && (myPositions['TE'] ?? 0) < 1) {
    teamFitScore += 10
  }
  teamFitScore = clamp(teamFitScore, 0, 100)

  // --- Board Value Score (0-100) --- ADP vs current pick
  const adpDiff = player.adp - input.currentPick
  let boardValueScore = clamp(50 + adpDiff * 2, 0, 100)
  // Tier bonus
  if (player.tier != null && player.tier <= 2) boardValueScore = Math.min(100, boardValueScore + 10)

  // --- Need Score (0-100) ---
  const posGap = positionGaps[player.position] ?? 0
  const scarcity = scarcityMap[player.position] ?? 50
  let needScore = clamp(posGap * 20 + scarcity * 0.3, 0, 100)
  // Late-round K/DEF penalty
  if (['K', 'DEF'].includes(player.position) && input.currentRound < 10) {
    needScore = Math.max(0, needScore - 40)
  }
  needScore = clamp(needScore, 0, 100)

  // --- Upside Score (0-100) ---
  let upsideScore = 40
  if (player.age != null) {
    const ageCurve = getAgeCurve(input.sport, player.position)
    if (ageCurve && player.age < ageCurve.peakAge - 2) upsideScore += 20
    if (ageCurve && player.age > ageCurve.declineAge) upsideScore -= 15
  }
  if (player.value >= 7000) upsideScore += 15
  if (player.outlookTrend === 'buy') upsideScore += 10
  if (player.outlookTags?.includes('breakout_candidate')) upsideScore += 15
  if (player.outlookRiskFlags?.includes('injury_concern')) upsideScore -= 10
  upsideScore = clamp(upsideScore, 0, 100)

  // --- Overall Score (weighted composite) ---
  const overallScore = Math.round(
    teamFitScore * weights.teamFit +
    boardValueScore * weights.boardValue +
    needScore * weights.needScore +
    upsideScore * weights.upside,
  )

  // --- Pick Type ---
  const pickType = classifyPickType(teamFitScore, boardValueScore, needScore, upsideScore)

  return { teamFitScore, boardValueScore, needScore, upsideScore, overallScore, pickType }
}

function classifyPickType(
  teamFit: number,
  boardValue: number,
  needScore: number,
  upside: number,
): PickType {
  const max = Math.max(teamFit, boardValue, needScore, upside)
  if (max === boardValue && boardValue >= 60) return 'value'
  if (max === upside && upside >= 60) return 'upside'
  if (max === teamFit && teamFit >= 70) return 'safe'
  return 'balanced'
}

// ---------------------------------------------------------------------------
// Reasoning Generation
// ---------------------------------------------------------------------------

function buildReasoning(
  player: DraftAvailablePlayer,
  scores: PlayerScores,
  input: DraftDecisionInput,
): string[] {
  const reasons: string[] = []

  if (scores.boardValueScore >= 70) {
    reasons.push(`ADP ${player.adp} vs pick ${input.currentPick} — strong value`)
  } else if (scores.boardValueScore <= 30) {
    reasons.push(`ADP ${player.adp} vs pick ${input.currentPick} — reaching`)
  }

  if (scores.teamFitScore >= 70) {
    reasons.push(`Fills a direct roster need at ${player.position}`)
  }

  if (scores.needScore >= 65) {
    reasons.push(`${player.position} is scarce on the board — act now or miss out`)
  }

  if (scores.upsideScore >= 70) {
    reasons.push('High-upside profile with room to grow')
  }

  if (player.outlookTrend === 'buy') {
    reasons.push('Trending upward — buy-low window')
  }
  if (player.outlookTrend === 'sell') {
    reasons.push('Trending downward — potential value trap')
  }

  if (player.tier != null && player.tier <= 2) {
    reasons.push(`Tier ${player.tier} talent still on the board`)
  }

  if (reasons.length === 0) {
    reasons.push(`Solid option at ${player.position} with ${scores.overallScore}/100 composite score`)
  }

  return reasons.slice(0, 4)
}

function buildRiskFlags(player: DraftAvailablePlayer, input: DraftDecisionInput): string[] {
  const flags: string[] = []
  if (player.outlookRiskFlags) flags.push(...player.outlookRiskFlags)
  if (player.age != null) {
    const ageCurve = getAgeCurve(input.sport, player.position)
    if (ageCurve && player.age > ageCurve.declineAge) flags.push('age_decline')
    if (ageCurve && player.age > ageCurve.cliffAge) flags.push('age_cliff')
  }
  return [...new Set(flags)]
}

function buildAvoidNotes(player: DraftAvailablePlayer, input: DraftDecisionInput): string[] {
  const notes: string[] = []
  if (player.outlookTrend === 'sell') notes.push('Declining trend — consider alternatives')
  if (player.outlookRiskFlags?.includes('injury_concern')) notes.push('Injury risk — have a backup plan')
  if (['K', 'DEF'].includes(player.position) && input.currentRound < 10) {
    notes.push('Too early for this position — better value available')
  }
  return notes
}

function findStackNote(
  player: DraftAvailablePlayer,
  myRoster: DraftRosterPlayer[],
): string | null {
  if (!player.team) return null
  const qbs = myRoster.filter(r => r.position === 'QB')
  // Very simplified stack detection — in production would use team data
  // For now just check if we have a QB and the player is a pass catcher on any team
  if (qbs.length > 0 && ['WR', 'TE'].includes(player.position)) {
    return `Potential stack with your QB — monitor team correlation`
  }
  return null
}

function findHandcuffNote(
  player: DraftAvailablePlayer,
  myRoster: DraftRosterPlayer[],
): string | null {
  if (player.position !== 'RB') return null
  if (player.value < 2000 && player.team) {
    const myRBs = myRoster.filter(r => r.position === 'RB')
    if (myRBs.length > 0) {
      return `Potential handcuff — insures your RB investment`
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

function detectAlerts(
  input: DraftDecisionInput,
  boardAnalysis: DraftBoardAnalysis,
  topPlayers: Array<{ player: DraftAvailablePlayer; scores: PlayerScores }>,
): DraftAlert[] {
  const alerts: DraftAlert[] = []

  // Tier break alert
  if (topPlayers.length >= 2) {
    const gap = topPlayers[0].scores.overallScore - topPlayers[1].scores.overallScore
    const tierGap = (topPlayers[0].player.tier ?? 4) !== (topPlayers[1].player.tier ?? 4)
    if (gap >= 15 || tierGap) {
      alerts.push({
        type: 'tier_break',
        message: `Tier break detected: ${topPlayers[0].player.name} (${topPlayers[0].scores.overallScore}) is significantly better than the next option`,
        severity: gap >= 25 ? 'critical' : 'warning',
        relatedPlayers: [topPlayers[0].player.name, topPlayers[1].player.name],
      })
    }
  }

  // Positional run alerts
  for (const run of boardAnalysis.runs) {
    if (run.count >= 3) {
      alerts.push({
        type: 'positional_run',
        message: `${run.position} run: ${run.count} ${run.position}s drafted in the last ${run.windowSize} picks`,
        severity: run.count >= 4 ? 'critical' : 'warning',
        relatedPlayers: [],
      })
    }
  }

  // Stack opportunity alerts
  for (const stack of boardAnalysis.stackOpportunities) {
    alerts.push({
      type: 'stack_opportunity',
      message: `Stack opportunity: ${stack.targets.map(t => t.name).join(', ')} on ${stack.team} (your QB: ${stack.qbName})`,
      severity: 'info',
      relatedPlayers: [stack.qbName, ...stack.targets.map(t => t.name)],
    })
  }

  // Scarcity warnings
  for (const [pos, remaining] of Object.entries(boardAnalysis.scarcityByPosition)) {
    if (remaining <= 3 && (input.rosterRequirements[pos] ?? 0) > 0) {
      const have = input.myRoster.filter(r => r.position === pos).length
      if (have < (input.rosterRequirements[pos] ?? 0)) {
        alerts.push({
          type: 'scarcity_warning',
          message: `Only ${remaining} startable ${pos}s remain — you need ${(input.rosterRequirements[pos] ?? 0) - have} more`,
          severity: remaining <= 1 ? 'critical' : 'warning',
          relatedPlayers: [],
        })
      }
    }
  }

  // Value cliff: position where top player is much better than #2
  for (const cliff of boardAnalysis.valueCliffs) {
    alerts.push({
      type: 'value_cliff',
      message: `Value cliff at ${cliff.position}: ${cliff.topPlayer} is far ahead of next option — draft now or lose the tier`,
      severity: 'warning',
      relatedPlayers: [cliff.topPlayer],
    })
  }

  return alerts.slice(0, 6)
}

// ---------------------------------------------------------------------------
// Draft Plan Note
// ---------------------------------------------------------------------------

function generateDraftPlanNote(
  input: DraftDecisionInput,
  recommendation: DraftPickRecommendation,
  alerts: DraftAlert[],
): string {
  const parts: string[] = []

  if (recommendation.isValue) {
    parts.push(`${recommendation.playerName} is a value pick — ADP says they should go later.`)
  } else if (recommendation.isReach) {
    parts.push(`${recommendation.playerName} is a slight reach, but the need justifies it.`)
  }

  const criticalAlerts = alerts.filter(a => a.severity === 'critical')
  if (criticalAlerts.length > 0) {
    parts.push(criticalAlerts[0].message)
  }

  if (input.currentRound <= 3) {
    parts.push('Early rounds — prioritize foundational pieces over depth.')
  } else if (input.currentRound >= input.totalRounds - 2) {
    parts.push('Late rounds — take upside shots and handcuffs.')
  }

  return parts.join(' ').slice(0, 200)
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function computeDraftDecision(input: DraftDecisionInput): DraftDecisionResult {
  // Step 1: Analyze the board
  const boardAnalysis = analyzeDraftBoard({
    availablePlayers: input.availablePlayers,
    draftedByOthers: input.draftedByOthers,
    myRoster: input.myRoster,
    rosterRequirements: input.rosterRequirements,
    currentPick: input.currentPick,
  })

  // Step 2: Compute position gaps
  const myPositions = countByPosition(input.myRoster)
  const positionGaps: Record<string, number> = {}
  for (const [pos, req] of Object.entries(input.rosterRequirements)) {
    positionGaps[pos] = Math.max(0, req - (myPositions[pos] ?? 0))
  }

  // Step 3: Score all available players
  const scored = input.availablePlayers
    .map((player) => ({
      player,
      scores: scorePlayer(player, input, positionGaps, boardAnalysis.scarcityByPosition),
    }))
    .sort((a, b) => b.scores.overallScore - a.scores.overallScore)

  // Step 4: Build recommendations
  const topCandidates = scored.slice(0, 5)

  const buildRecommendation = (
    item: { player: DraftAvailablePlayer; scores: PlayerScores },
    rank: number,
  ): DraftPickRecommendation => ({
    playerId: item.player.playerId,
    playerName: item.player.name,
    position: item.player.position,
    team: item.player.team,
    rank,
    pickType: item.scores.pickType,
    teamFitScore: item.scores.teamFitScore,
    boardValueScore: item.scores.boardValueScore,
    needScore: item.scores.needScore,
    overallScore: item.scores.overallScore,
    reasoning: buildReasoning(item.player, item.scores, input),
    riskFlags: buildRiskFlags(item.player, input),
    avoidNotes: buildAvoidNotes(item.player, input),
    isReach: item.player.adp > input.currentPick + 10,
    isValue: item.player.adp < input.currentPick - 8,
    stackNote: findStackNote(item.player, input.myRoster),
    handcuffNote: findHandcuffNote(item.player, input.myRoster),
  })

  const recommendedPick = topCandidates.length > 0
    ? buildRecommendation(topCandidates[0], 1)
    : emptyRecommendation()

  const topAlternatives = topCandidates.slice(1, 5).map((item, i) =>
    buildRecommendation(item, i + 2),
  )

  // Step 5: Detect alerts
  const alerts = detectAlerts(input, boardAnalysis, topCandidates)

  // Step 6: Draft plan note
  const draftPlanNote = generateDraftPlanNote(input, recommendedPick, alerts)

  // Step 7: Confidence
  const scoreDiff = topCandidates.length >= 2
    ? topCandidates[0].scores.overallScore - topCandidates[1].scores.overallScore
    : 0
  let confidencePct = 50
  if (scoreDiff >= 20) confidencePct += 25
  else if (scoreDiff >= 10) confidencePct += 15
  else if (scoreDiff >= 5) confidencePct += 8
  if (input.availablePlayers.length < 20) confidencePct -= 10
  if (alerts.some(a => a.severity === 'critical')) confidencePct += 5
  confidencePct = clamp(confidencePct, 20, 95)

  return {
    recommendedPick,
    topAlternatives,
    alerts,
    draftPlanNote,
    confidencePct,
    boardAnalysis,
  }
}

function emptyRecommendation(): DraftPickRecommendation {
  return {
    playerId: '',
    playerName: 'No recommendation available',
    position: '',
    team: null,
    rank: 1,
    pickType: 'balanced',
    teamFitScore: 0,
    boardValueScore: 0,
    needScore: 0,
    overallScore: 0,
    reasoning: ['Insufficient data to make a recommendation'],
    riskFlags: [],
    avoidNotes: [],
    isReach: false,
    isValue: false,
    stackNote: null,
    handcuffNote: null,
  }
}
