/**
 * Decision OS — Phase 7.0 IPM Recommendation Presentation.
 *
 * Maps Phase 6.4 Recommendation objects to fully presentation-ready contracts
 * with display titles, difficulty, estimated time, icon tokens, and related KPIs.
 * Pure functions — no AI, no DB, no side effects.
 */

import type {
  RecommendationPresentation, RecommendationPresentationSet,
  RecommendationDifficulty, RecommendationTimeEstimate,
  MetricPresentation, GraphModel, ColorToken, IconToken,
} from './types'
import {
  PRESENTATION_VERSION,
  SEVERITY_DEFINITIONS,
  recommendationPriorityToSeverity,
} from './tokens'

// ── Category templates ────────────────────────────────────────────────────────

interface CategoryTemplate {
  title: string
  description: string
  difficulty: RecommendationDifficulty
  estimatedTime: RecommendationTimeEstimate
  iconToken: IconToken
  colorToken: ColorToken
}

const CATEGORY_TEMPLATES: Record<string, CategoryTemplate> = {
  // Manager tier
  engagement_boost: {
    title: 'Boost Engagement',
    description: "This manager's engagement has dropped — a personal nudge or incentive can re-activate participation.",
    difficulty: 'easy',
    estimatedTime: '5_min',
    iconToken: 'flame',
    colorToken: 'warning',
  },
  lineup_discipline: {
    title: 'Lineup Discipline',
    description: 'Repeated lineup changes suggest indecision — consider simplifying roster decisions.',
    difficulty: 'easy',
    estimatedTime: '5_min',
    iconToken: 'target',
    colorToken: 'warning',
  },
  trade_coaching: {
    title: 'Trade Strategy',
    description: 'Trade activity signals an opportunity to improve roster value through strategic dealing.',
    difficulty: 'moderate',
    estimatedTime: '30_min',
    iconToken: 'activity',
    colorToken: 'accent',
  },
  waiver_opportunity: {
    title: 'Waiver Wire Opportunity',
    description: 'The waiver wire has an unclaimed opportunity that could meaningfully improve this roster.',
    difficulty: 'easy',
    estimatedTime: '5_min',
    iconToken: 'zap',
    colorToken: 'positive',
  },
  league_participation: {
    title: 'Increase League Participation',
    description: 'Low participation in league-wide activities — engagement nudges can rebuild habit.',
    difficulty: 'easy',
    estimatedTime: '5_min',
    iconToken: 'users',
    colorToken: 'warning',
  },
  draft_preparation: {
    title: 'Draft Preparation',
    description: 'Pre-draft research and preparation significantly improves season outcomes.',
    difficulty: 'moderate',
    estimatedTime: '1_hour',
    iconToken: 'star',
    colorToken: 'accent',
  },
  // Commissioner tier
  retention_intervention: {
    title: 'Retention Intervention',
    description: 'League has managers at risk of not returning. A commissioner outreach now can change outcomes.',
    difficulty: 'moderate',
    estimatedTime: '30_min',
    iconToken: 'shield',
    colorToken: 'danger',
  },
  trade_activation: {
    title: 'Activate Trade Market',
    description: 'Trade activity is below league potential — a deadline reminder or trade promotion can help.',
    difficulty: 'easy',
    estimatedTime: '5_min',
    iconToken: 'activity',
    colorToken: 'accent',
  },
  waiver_activation: {
    title: 'Activate Waiver Wire',
    description: 'Low waiver claim activity — reminding managers about available players can drive engagement.',
    difficulty: 'easy',
    estimatedTime: '5_min',
    iconToken: 'zap',
    colorToken: 'accent',
  },
  league_event: {
    title: 'Host a League Event',
    description: 'A timely league-wide event or challenge can reignite interest and build community.',
    difficulty: 'moderate',
    estimatedTime: '30_min',
    iconToken: 'star',
    colorToken: 'positive',
  },
  weekly_recap: {
    title: 'Post a Weekly Recap',
    description: 'Regular commissioner recaps keep managers informed and emotionally invested in the league.',
    difficulty: 'easy',
    estimatedTime: '5_min',
    iconToken: 'bar_chart',
    colorToken: 'positive',
  },
  rivalry_engagement: {
    title: 'Amplify Rivalries',
    description: 'Highlighting matchup storylines and rivalries increases emotional stakes and return visits.',
    difficulty: 'easy',
    estimatedTime: '5_min',
    iconToken: 'flame',
    colorToken: 'accent',
  },
  // Platform tier
  benchmark_intervention: {
    title: 'Platform Benchmark Alert',
    description: 'Platform health metrics are below benchmarks — targeted interventions can reverse the trend.',
    difficulty: 'hard',
    estimatedTime: '1_hour',
    iconToken: 'alert_triangle',
    colorToken: 'danger',
  },
  product_opportunity: {
    title: 'Product Opportunity',
    description: 'Usage patterns indicate a high-value feature opportunity for this platform segment.',
    difficulty: 'hard',
    estimatedTime: 'ongoing',
    iconToken: 'star',
    colorToken: 'accent',
  },
  cohort_improvement: {
    title: 'Cohort Improvement',
    description: 'A specific league archetype cohort is underperforming — a targeted program can improve outcomes.',
    difficulty: 'hard',
    estimatedTime: '1_hour',
    iconToken: 'users',
    colorToken: 'warning',
  },
  feature_adoption: {
    title: 'Feature Adoption Gap',
    description: 'A significant portion of leagues are not using high-value features — adoption campaigns can help.',
    difficulty: 'moderate',
    estimatedTime: '30_min',
    iconToken: 'trending_up',
    colorToken: 'positive',
  },
}

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildRecommendationPresentation(
  rec: {
    id: string
    tier: string
    category: string
    entityId: string
    priority: string
    severity: string
    confidence: string
    affectedDimensions: string[]
    expectedImpact: string
    derivation: string[]
    evidence: string[]
    benchmarkComparison: string | null
    prerequisites: string[]
    recommendedActions: Array<{ action: string; rationale: string }>
    rollbackCriteria: string[]
    completeness: number
    uncertainty: string[]
  },
  options?: {
    relatedGraph?: GraphModel | null
    relatedKpi?: MetricPresentation | null
  },
): RecommendationPresentation {
  const template = CATEGORY_TEMPLATES[rec.category] ?? {
    title: rec.category.replace(/_/g, ' '),
    description: rec.expectedImpact,
    difficulty: 'moderate' as RecommendationDifficulty,
    estimatedTime: '30_min' as RecommendationTimeEstimate,
    iconToken: 'arrow_right' as IconToken,
    colorToken: 'neutral' as ColorToken,
  }

  const sevToken = recommendationPriorityToSeverity(rec.priority)
  const severity = SEVERITY_DEFINITIONS[sevToken]

  return {
    recommendationId: rec.id,
    tier: rec.tier,
    category: rec.category,
    entityId: rec.entityId,
    priority: rec.priority,
    severity,
    colorToken: template.colorToken,
    iconToken: template.iconToken,
    title: template.title,
    description: template.description,
    expectedImpact: rec.expectedImpact,
    difficulty: template.difficulty,
    estimatedTime: template.estimatedTime,
    supportingEvidence: rec.evidence,
    actions: rec.recommendedActions,
    rollbackCriteria: rec.rollbackCriteria,
    prerequisites: rec.prerequisites,
    completionStatus: 'pending',
    relatedGraph: options?.relatedGraph ?? null,
    relatedKpi: options?.relatedKpi ?? null,
    benchmarkContext: rec.benchmarkComparison,
    uncertainty: rec.uncertainty,
    derivation: rec.derivation,
    completeness: rec.completeness,
  }
}

// ── Presentation set ──────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

export function buildRecommendationPresentationSet(
  recs: RecommendationPresentation[],
  entityId: string,
  tier: string,
): RecommendationPresentationSet {
  const sorted = [...recs].sort((a, b) => {
    const pDiff = (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0)
    if (pDiff !== 0) return pDiff
    const sDiff = (b.severity.priority) - (a.severity.priority)
    if (sDiff !== 0) return sDiff
    const catDiff = a.category.localeCompare(b.category)
    if (catDiff !== 0) return catDiff
    return a.recommendationId.localeCompare(b.recommendationId)
  })

  return {
    entityId,
    tier,
    items: sorted,
    totalItems: sorted.length,
    criticalCount: sorted.filter((r) => r.priority === 'critical').length,
    version: PRESENTATION_VERSION,
  }
}

// ── Batch builder ─────────────────────────────────────────────────────────────

export function buildRecommendationPresentations(
  recs: Parameters<typeof buildRecommendationPresentation>[0][],
): RecommendationPresentation[] {
  return recs.map((r) => buildRecommendationPresentation(r))
}
