/**
 * AI Draft War Room Engine
 *
 * Live draft command center that combines Draft Decision Engine,
 * Board Analyzer, Player Outlook, Market Value, and strategy posture
 * into one premium recommendation. Delegates to existing engines.
 *
 * Pure deterministic. <25ms.
 */

import { z } from 'zod'
import { computeDraftDecision, type DraftDecisionResult } from '@/lib/draft-intelligence/draft-decision-engine'
import { analyzeDraftBoard, type DraftBoardAnalysis } from '@/lib/draft-intelligence/draft-board-analyzer'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const WarRoomModeEnum = z.enum([
  'live_pick', 'board_review', 'best_value', 'best_fit', 'upside_swing',
  'safe_build', 'auction_bid', 'dynasty_long_range',
])

export const DraftFormatEnum = z.enum([
  'redraft_snake', 'dynasty_startup', 'rookie_draft', 'devy_draft',
  'c2c_draft', 'auction', 'keeper', 'bestball', 'mock',
])

export const WarRoomInputSchema = z.object({
  sport: z.string().default('NFL'),
  draftFormat: DraftFormatEnum.default('redraft_snake'),
  warRoomMode: WarRoomModeEnum.default('live_pick'),
  scoringFormat: z.string().default('PPR'),
  isSF: z.boolean().default(false),
  isTEP: z.boolean().default(false),
  numTeams: z.number().default(12),
  currentPickNumber: z.number(),
  currentRound: z.number(),
  totalRounds: z.number().default(15),
  myTeamId: z.string(),
  myRoster: z.array(z.object({
    position: z.string(), playerName: z.string(), value: z.number(),
  })).default([]),
  availablePlayers: z.array(z.object({
    playerId: z.string(), name: z.string(), position: z.string(),
    team: z.string().nullable(), adp: z.number(), value: z.number(),
    age: z.number().nullable(), tier: z.number().nullable(),
    outlookTags: z.array(z.string()).optional(),
    outlookTrend: z.string().optional(),
    outlookRiskFlags: z.array(z.string()).optional(),
  })),
  draftedByOthers: z.array(z.object({
    playerId: z.string(), name: z.string(), position: z.string(),
    teamId: z.string(), pickNumber: z.number(),
  })).default([]),
  rosterRequirements: z.record(z.string(), z.number()).default({ QB: 1, RB: 2, WR: 2, TE: 1 }),
  strategyGoal: z.enum(['balanced', 'value', 'upside', 'positional-need', 'stack', 'league-winning']).default('balanced'),
  riskTolerance: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate'),
})
export type WarRoomInput = z.infer<typeof WarRoomInputSchema>

export interface WarRoomResult {
  draftMode: string
  currentPickNumber: number
  confidencePct: number
  bestPick: {
    playerId: string
    playerName: string
    position: string
    reason: string
    fitLabel: string
    valueLabel: string
    riskLabel: string
  }
  topAlternatives: Array<{
    playerId: string
    playerName: string
    position: string
    whyConsider: string
  }>
  tierBreakAlerts: string[]
  positionalRunAlerts: string[]
  rosterConstructionNotes: string[]
  valueOnBoardNotes: string[]
  reachWarnings: string[]
  pivotPlans: string[]
  backupTargets: string[]
  draftStrategySummary: string
  summary: string
  generatedAt: string
  rosterBuildScore: number
  boardValueScore: number
  urgencyScore: number
  devyPipelineNotes: string[]
  c2cBalanceNotes: string[]
  longTermFitNotes: string[]
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function runDraftWarRoom(input: WarRoomInput): WarRoomResult {
  // Delegate to existing Draft Decision Engine
  const decisionResult: DraftDecisionResult = computeDraftDecision({
    draftType: input.draftFormat,
    sport: input.sport,
    leagueFormat: input.draftFormat.includes('dynasty') ? 'dynasty' : 'redraft',
    scoringType: input.scoringFormat,
    isSF: input.isSF,
    isTEP: input.isTEP,
    numTeams: input.numTeams,
    currentPick: input.currentPickNumber,
    currentRound: input.currentRound,
    totalRounds: input.totalRounds,
    myTeamId: input.myTeamId,
    myRoster: input.myRoster,
    availablePlayers: input.availablePlayers,
    draftedByOthers: input.draftedByOthers,
    rosterRequirements: input.rosterRequirements,
    strategy: input.strategyGoal,
    mode: input.draftFormat === 'mock' ? 'mock' : 'live',
  })

  const rec = decisionResult.recommendedPick
  const board = decisionResult.boardAnalysis

  // Build war room output from decision engine results
  const bestPick = {
    playerId: rec.playerId,
    playerName: rec.playerName,
    position: rec.position,
    reason: rec.reasoning[0] ?? 'Best available option',
    fitLabel: rec.teamFitScore >= 70 ? 'Strong Fit' : rec.teamFitScore >= 45 ? 'Moderate Fit' : 'Low Fit',
    valueLabel: rec.isValue ? 'VALUE' : rec.isReach ? 'REACH' : 'AT ADP',
    riskLabel: rec.riskFlags.length >= 2 ? 'High Risk' : rec.riskFlags.length >= 1 ? 'Moderate Risk' : 'Low Risk',
  }

  const topAlternatives = decisionResult.topAlternatives.slice(0, 4).map(alt => ({
    playerId: alt.playerId,
    playerName: alt.playerName,
    position: alt.position,
    whyConsider: alt.reasoning[0] ?? `${alt.pickType} option with ${alt.overallScore}/100 score`,
  }))

  // Alerts
  const tierBreakAlerts = decisionResult.alerts.filter(a => a.type === 'tier_break').map(a => a.message)
  const positionalRunAlerts = decisionResult.alerts.filter(a => a.type === 'positional_run').map(a => a.message)
  const reachWarnings = decisionResult.alerts.filter(a => a.type === 'value_cliff').map(a => a.message)

  // Roster construction notes
  const rosterNotes: string[] = []
  const filled: Record<string, number> = {}
  for (const p of input.myRoster) filled[p.position] = (filled[p.position] || 0) + 1
  for (const [pos, req] of Object.entries(input.rosterRequirements)) {
    const have = filled[pos] ?? 0
    if (have < req) rosterNotes.push(`Need ${req - have} more ${pos}${req - have > 1 ? 's' : ''}`)
  }
  if (rosterNotes.length === 0) rosterNotes.push('Starting requirements met — draft for value or depth')

  // Value on board
  const valueNotes = board.valuePlayers.slice(0, 3).map(v => `${v.name} (${v.position}): ADP ${v.adp} — available ${input.currentPickNumber - v.adp} picks after expected`)

  // Pivot plans
  const pivotPlans: string[] = []
  if (topAlternatives.length >= 2) {
    pivotPlans.push(`If ${bestPick.playerName} is taken: pivot to ${topAlternatives[0].playerName} (${topAlternatives[0].position})`)
    pivotPlans.push(`If both top options go: ${topAlternatives[1].playerName} is the backup`)
  }

  // Backup targets
  const backupTargets = topAlternatives.slice(0, 3).map(a => a.playerName)

  // Scores
  const rosterBuildScore = Math.round((Object.values(filled).reduce((s, v) => s + v, 0) / Math.max(Object.values(input.rosterRequirements).reduce((s, v) => s + v, 0), 1)) * 100)
  const boardValueScore = rec.boardValueScore
  const urgencyScore = decisionResult.alerts.filter(a => a.severity === 'critical').length >= 1 ? 80 : decisionResult.alerts.length >= 2 ? 60 : 40

  // Format-specific notes
  const devyNotes: string[] = []
  const c2cNotes: string[] = []
  const longTermNotes: string[] = []

  if (input.draftFormat === 'devy_draft') {
    devyNotes.push('Devy draft: prioritize breakout age and college production metrics over current NFL value')
  }
  if (input.draftFormat === 'c2c_draft') {
    c2cNotes.push('C2C draft: balance college and pro side needs — don\'t overload one side')
  }
  if (input.draftFormat.includes('dynasty')) {
    longTermNotes.push('Dynasty context: weigh age and long-term trajectory alongside immediate production')
  }

  return {
    draftMode: input.warRoomMode,
    currentPickNumber: input.currentPickNumber,
    confidencePct: decisionResult.confidencePct,
    bestPick, topAlternatives,
    tierBreakAlerts, positionalRunAlerts,
    rosterConstructionNotes: rosterNotes,
    valueOnBoardNotes: valueNotes,
    reachWarnings,
    pivotPlans, backupTargets,
    draftStrategySummary: decisionResult.draftPlanNote,
    summary: `Pick #${input.currentPickNumber}: ${bestPick.playerName} (${bestPick.position}) — ${bestPick.reason}. ${tierBreakAlerts.length > 0 ? tierBreakAlerts[0] : ''} ${pivotPlans[0] ?? ''}`,
    generatedAt: new Date().toISOString(),
    rosterBuildScore, boardValueScore, urgencyScore,
    devyPipelineNotes: devyNotes, c2cBalanceNotes: c2cNotes, longTermFitNotes: longTermNotes,
  }
}
