/**
 * Shared types for Chimmy as the central AI orchestration layer.
 * Used by /api/chat/chimmy and the Chimmy client UI.
 */

import type { AIContextEnvelope, AIModelRole, ModelOutput, OrchestrationMode } from '@/lib/unified-ai/types'

export type ChimmyOrchestrationIntent =
  | 'trade'
  | 'waiver'
  | 'start_sit'
  | 'player_value'
  | 'draft'
  | 'commissioner'
  | 'bracket'
  | 'injury'
  | 'weather'
  | 'matchup'
  | 'league_strength'
  | 'manager_psychology'
  | 'story_recap'
  | 'general'

export type ChimmyToolId =
  | 'trade_analyzer'
  | 'waiver_ai'
  | 'player_comparison'
  | 'player_outlook'
  | 'draft_assistant'
  | 'commissioner_report'
  | 'bracket_intelligence'
  | 'injury_report'
  | 'weather_engine'
  | 'matchup_simulator'
  | 'league_analysis'
  | 'manager_psychology'
  | 'story_generator'
  | 'rankings'
  | 'fantasy_coach'
  | 'none'

export type ChimmyToolLaunch = {
  id: ChimmyToolId
  label: string
  href: string
  description: string
}

export type ChimmyFollowUpSuggestion = {
  label: string
  prompt: string
}

/**
 * Structured augmentation returned alongside the main assistant text.
 */
export type ChimmyOrchestrationMeta = {
  intent: ChimmyOrchestrationIntent
  intentLabel: string
  recommendedToolId: ChimmyToolId
  confidence: number
  /** Primary deep-link for the recommended tool */
  primaryLaunch: ChimmyToolLaunch | null
  /** Secondary options (e.g. rankings + compare for “value”) */
  secondaryLaunches: ChimmyToolLaunch[]
  followUps: ChimmyFollowUpSuggestion[]
  /** Short bullet summary of remembered preferences (risk, archetype, scoring) */
  memorySummary: string | null
  /** Tone / behavior hints injected into the model */
  answerShape: {
    directAnswer: string
    why: string
    recommendedTool: string
    confidenceLine: string
    followUp: string
  }
}

export type DeterministicSectionKey =
  | 'projections'
  | 'matchupData'
  | 'rosterNeeds'
  | 'adpComparisons'
  | 'rankings'
  | 'scoringOutputs'

export type ChimmyDeterministicLayer = {
  projections: Record<string, unknown> | null
  matchupData: Record<string, unknown> | null
  rosterNeeds: Record<string, unknown> | null
  adpComparisons: Record<string, unknown> | null
  rankings: Record<string, unknown> | null
  scoringOutputs: Record<string, unknown> | null
  missingSections: DeterministicSectionKey[]
  completenessPct: number
}

type ChimmyRoutingTask = {
  model: AIModelRole
  purpose: 'analysis' | 'trends' | 'final_synthesis'
  instruction: string
}

export type ChimmyRoutingPlan = {
  models: AIModelRole[]
  tasks: ChimmyRoutingTask[]
  finalModel: AIModelRole
}

export type ChimmyConfidenceResult = {
  scorePct: number
  label: 'low' | 'medium' | 'high'
  reason: string
  agreementPct: number
}

export type ChimmyAggregationResult = {
  primaryAnswer: string
  reason: string
  factGuardWarnings?: string[]
}

export type ChimmyOrchestratorInput = {
  mode: OrchestrationMode
  envelope: AIContextEnvelope
  modelOutputs: ModelOutput[]
}

export type ChimmyOrchestrationResult = {
  mode: OrchestrationMode
  primaryAnswer: string
  confidencePct?: number
  confidenceLabel?: 'low' | 'medium' | 'high'
  reason?: string
  modelOutputs: ModelOutput[]
  usedDeterministic: boolean
  factGuardWarnings?: string[]
}
