import type { CorePluginId } from '@/lib/plugin-framework'
import type { Decision } from './decision'

export type DecisionOSEvidenceSourceType =
  | 'engine_event'
  | 'engine_state'
  | 'plugin_context'
  | 'manager_behavior'
  | 'league_behavior'
  | 'platform_behavior'
  | 'provider_snapshot'
  | 'user_input'
  | 'ai_narrative'

export type DecisionOSTrustLevel = 'authoritative' | 'high' | 'medium' | 'low' | 'unverified'

export type DecisionOSRecommendationType =
  | 'manager_intelligence'
  | 'league_intelligence'
  | 'commissioner_recommendation'
  | 'matchup_insight'
  | 'waiver_recommendation'
  | 'trade_recommendation'
  | 'schedule_insight'
  | 'playoff_insight'
  | 'retention_risk'
  | 'engagement_pattern'
  | 'churn_alert'
  | 'competitive_balance'
  | 'archetype'
  | 'benchmark'
  | 'action_recommendation'

export type DecisionOSRiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical'
export type DecisionOSActionability = 'informational' | 'review' | 'recommended' | 'urgent' | 'blocked'

export type DecisionOSEvidenceRef = {
  id: string
  sourceType: DecisionOSEvidenceSourceType
  sourceId: string
  label: string
  trust: DecisionOSTrustLevel
  observedAt?: string | null
  url?: string | null
  metadata?: Record<string, unknown>
}

export type DecisionOSDerivationStep = {
  id: string
  label: string
  inputEvidenceIds: string[]
  ruleId: string
  output: string
  confidenceDelta?: number
}

export type DecisionOSAiBoundary = {
  usedAi: boolean
  role: 'none' | 'explanation_only' | 'summary_only' | 'unsupported'
  model?: string | null
  mayInventFacts: false
  mayOverrideEngineMath: false
  mustCiteEvidence: true
  insufficientDataMessage?: string | null
}

export type DecisionOSPluginContext = {
  pluginId: CorePluginId | string
  leagueType: string
  leagueVariant?: string | null
  inheritedBehavior?: string[]
  overriddenBehavior?: string[]
}

export type DecisionOSInsight<TAction = unknown> = {
  id: string
  recommendationType: DecisionOSRecommendationType
  targetUserId?: string | null
  leagueId?: string | null
  plugin: DecisionOSPluginContext
  riskLevel: DecisionOSRiskLevel
  actionability: DecisionOSActionability
  confidence: number
  dataCompleteness: number
  evidence: DecisionOSEvidenceRef[]
  derivationChain: DecisionOSDerivationStep[]
  explanation: string
  aiBoundary: DecisionOSAiBoundary
  decision?: Decision<TAction>
  metadata?: Record<string, unknown>
}

export function createDeterministicAiBoundary(
  insufficientDataMessage?: string | null,
): DecisionOSAiBoundary {
  return {
    usedAi: false,
    role: 'none',
    mayInventFacts: false,
    mayOverrideEngineMath: false,
    mustCiteEvidence: true,
    insufficientDataMessage: insufficientDataMessage ?? null,
  }
}

export function createExplanationOnlyAiBoundary(args: {
  model?: string | null
  insufficientDataMessage?: string | null
} = {}): DecisionOSAiBoundary {
  return {
    usedAi: true,
    role: 'explanation_only',
    model: args.model ?? null,
    mayInventFacts: false,
    mayOverrideEngineMath: false,
    mustCiteEvidence: true,
    insufficientDataMessage: args.insufficientDataMessage ?? null,
  }
}

export function assertDecisionOSInsightGrounded(insight: DecisionOSInsight): void {
  if (!Number.isFinite(insight.confidence) || insight.confidence < 0 || insight.confidence > 100) {
    throw new Error('Decision OS insight confidence must be 0-100')
  }
  if (!Number.isFinite(insight.dataCompleteness) || insight.dataCompleteness < 0 || insight.dataCompleteness > 100) {
    throw new Error('Decision OS insight dataCompleteness must be 0-100')
  }
  if (insight.evidence.length === 0) {
    throw new Error('Decision OS insight requires at least one evidence source')
  }
  const evidenceIds = new Set(insight.evidence.map((e) => e.id))
  for (const step of insight.derivationChain) {
    for (const id of step.inputEvidenceIds) {
      if (!evidenceIds.has(id)) {
        throw new Error(`Decision OS derivation step references missing evidence: ${id}`)
      }
    }
  }
  if (insight.aiBoundary.mayInventFacts !== false || insight.aiBoundary.mayOverrideEngineMath !== false) {
    throw new Error('Decision OS AI boundary cannot invent facts or override engine math')
  }
  if (insight.aiBoundary.usedAi && !insight.aiBoundary.mustCiteEvidence) {
    throw new Error('Decision OS AI explanations must cite evidence when possible')
  }
}
