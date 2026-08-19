import type { RecommendationSet } from '@/lib/decision-os/phase6/recommendations/types'
import {
  buildRecommendationPresentation,
  buildRecommendationPresentationSet,
} from '@/lib/decision-os/presentation/recommendations'
import type {
  RecommendationPresentation,
  RecommendationPresentationSet,
} from '@/lib/decision-os/presentation/types'

export type RecommendationEvidence = {
  label: string
  value: string
}

export type RecommendationItemView = {
  title: string
  priority: string
  expectedImpact: string
  difficulty: string
  evidence: string[]
  suggestedAction: string
  confidence: string
  completionStatus?: string
}

export type DecisionRecommendationsViewModel = {
  title: string
  subtitle: string
  status: 'ready' | 'insufficient-data'
  confidenceLabel: 'High' | 'Medium' | 'Low'
  evidence: RecommendationEvidence[]
  recommendations: RecommendationItemView[]
  lastUpdatedIso: string
  insufficientData?: {
    title: string
    message: string
    missing: string[]
  }
}

type BuildDecisionRecommendationsInput = {
  source?: RecommendationPresentationSet | RecommendationSet | RecommendationPresentation[] | null
  now?: Date
}

const DEFAULT_NOW = () => new Date()

const PRIORITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

function titleCaseToken(value: string | null | undefined, fallback = 'Unknown') {
  const source = String(value ?? '').trim()
  if (!source) return fallback
  return source
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function isPresentationSet(source: unknown): source is RecommendationPresentationSet {
  return typeof source === 'object' && source !== null && Array.isArray((source as { items?: unknown }).items)
}

function isPhaseSixSet(source: unknown): source is RecommendationSet {
  return typeof source === 'object' && source !== null && Array.isArray((source as { recommendations?: unknown }).recommendations)
}

function normalizeRecommendations(
  source: BuildDecisionRecommendationsInput['source'],
): RecommendationPresentation[] {
  if (!source) return []
  if (Array.isArray(source)) return [...source]
  if (isPresentationSet(source)) return [...source.items]
  if (isPhaseSixSet(source)) {
    const presentations = source.recommendations.map((rec) => buildRecommendationPresentation(rec))
    return buildRecommendationPresentationSet(presentations, source.entityId, source.tier).items
  }
  return []
}

function confidenceFromItems(items: RecommendationPresentation[]): DecisionRecommendationsViewModel['confidenceLabel'] {
  if (items.length === 0) return 'Low'
  const completeness = items.reduce((sum, item) => sum + item.completeness, 0) / items.length
  if (completeness >= 80) return 'High'
  if (completeness >= 55) return 'Medium'
  return 'Low'
}

export function buildDecisionRecommendationsViewModel({
  source,
  now = DEFAULT_NOW(),
}: BuildDecisionRecommendationsInput): DecisionRecommendationsViewModel {
  const items = normalizeRecommendations(source).sort((a, b) => {
    const priorityDiff = (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0)
    if (priorityDiff !== 0) return priorityDiff
    return a.title.localeCompare(b.title)
  })

  if (items.length === 0) {
    return {
      title: 'Recommended Moves',
      subtitle: 'Personal action queue',
      status: 'insufficient-data',
      confidenceLabel: 'Low',
      evidence: [{ label: 'Recommendations', value: 'None ready yet' }],
      recommendations: [],
      lastUpdatedIso: now.toISOString(),
      insufficientData: {
        title: 'No grounded recommendations yet',
        message: 'Recommendations appear here after enough league and manager activity is available.',
        missing: ['Behavior signals', 'League activity', 'Actionable opportunity'],
      },
    }
  }

  const topItems = items.slice(0, 3)
  return {
    title: 'Recommended Moves',
    subtitle: 'Personal action queue',
    status: 'ready',
    confidenceLabel: confidenceFromItems(topItems),
    evidence: [
      { label: 'Ready actions', value: String(items.length) },
      { label: 'Critical items', value: String(items.filter((item) => item.priority === 'critical').length) },
      { label: 'Evidence points', value: String(topItems.reduce((sum, item) => sum + item.supportingEvidence.length, 0)) },
    ],
    recommendations: topItems.map((item) => ({
      title: item.title,
      priority: titleCaseToken(item.priority),
      expectedImpact: item.expectedImpact,
      difficulty: titleCaseToken(item.difficulty),
      evidence: item.supportingEvidence.slice(0, 3),
      suggestedAction: item.actions[0]?.action ?? 'Review this opportunity',
      confidence: titleCaseToken(item.uncertainty.length > 0 ? 'medium' : 'high'),
      completionStatus: titleCaseToken(item.completionStatus),
    })),
    lastUpdatedIso: now.toISOString(),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function extractRecommendationsSource(payload: unknown): BuildDecisionRecommendationsInput['source'] {
  if (!isRecord(payload)) return null
  const direct = payload.recommendations ?? payload.recommendationSet ?? payload.recommendationPresentationSet
  if (Array.isArray(direct) || isPresentationSet(direct) || isPhaseSixSet(direct)) {
    return direct as BuildDecisionRecommendationsInput['source']
  }
  const nested = payload.intelligence ?? payload.decisionIntelligence ?? payload.actions
  if (isRecord(nested)) return extractRecommendationsSource(nested)
  return null
}
