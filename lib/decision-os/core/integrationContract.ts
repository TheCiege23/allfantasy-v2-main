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

type DecisionOSTrustLevel = 'authoritative' | 'high' | 'medium' | 'low' | 'unverified'

type DecisionOSRecommendationType =
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

type DecisionOSRiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical'
type DecisionOSActionability = 'informational' | 'review' | 'recommended' | 'urgent' | 'blocked'

type DecisionOSEvidenceRef = {
  id: string
  sourceType: DecisionOSEvidenceSourceType
  sourceId: string
  label: string
  trust: DecisionOSTrustLevel
  observedAt?: string | null
  url?: string | null
  metadata?: Record<string, unknown>
}

type DecisionOSDerivationStep = {
  id: string
  label: string
  inputEvidenceIds: string[]
  ruleId: string
  output: string
  confidenceDelta?: number
}

type DecisionOSAiBoundary = {
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

