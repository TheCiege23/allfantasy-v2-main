/**
 * Decision OS — Phase 7.0 Intelligence Presentation Model tests.
 *
 * Covers: version stamps, token system, badge assignment, graph generation,
 * card assembly, recommendation presentation, widget contracts, white-label,
 * determinism, no mutation, serialization, completeness propagation,
 * uncertainty propagation, sparse data, empty/single-entity platforms.
 */

import { describe, expect, it } from 'vitest'
import {
  PRESENTATION_VERSION,
  // Token system
  SEVERITY_DEFINITIONS,
  scoreToSeverity,
  percentileToSeverity,
  engagementTierToSeverity,
  retentionRiskToSeverity,
  workloadToSeverity,
  recommendationPriorityToSeverity,
  archetypeToSeverity,
  percentileToColorToken,
  archetypeToColorToken,
  identityToColorToken,
  scoreToColorToken,
  identityToIconToken,
  archetypeToIconToken,
  // Badges
  buildManagerBadges,
  buildLeagueBadges,
  buildPlatformBadges,
  // Graphs
  buildGaugeGraph,
  buildProgressRingGraph,
  buildBarGraph,
  buildHorizontalBarGraph,
  buildLineGraph,
  buildTrendGraph,
  buildSparklineGraph,
  buildDonutGraph,
  buildRadarGraph,
  buildHeatmapGraph,
  buildTimelineGraph,
  buildDistributionHistogramGraph,
  buildComparisonChartGraph,
  buildRankingTableGraph,
  buildWaterfallGraph,
  buildActivityCalendarGraph,
  buildBenchmarkRadarGraph,
  // Cards
  buildHealthCard,
  buildRecommendationCard,
  buildInsightCard,
  buildRetentionCard,
  buildCommissionerCard,
  buildManagerCard,
  buildDnaCard,
  buildLeagueArchetypeCard,
  buildPlatformBenchmarkCard,
  buildCompanyIntelligenceCard,
  buildEngagementMetric,
  buildRetentionMetric,
  buildArchetypeMetric,
  // Recommendations
  buildRecommendationPresentation,
  buildRecommendationPresentationSet,
  // Widgets
  buildCompactWidget,
  buildSidebarWidget,
  buildFullDashboardWidget,
  buildPopupWidget,
  buildCommissionerWidget,
  buildManagerWidget,
  buildMobileWidget,
  buildPartnerWidget,
  // API presentation
  buildLeagueApiPresentation,
  buildManagerApiPresentation,
  // White-label
  WHITE_LABEL_CONFIGS,
  getWhiteLabelConfig,
  resolveColorToken,
  resolveIconToken,
  isSectionVisible,
} from '../../../lib/decision-os/presentation/index'
import type {
  LeaguePresentationResult,
  ManagerPresentationResult,
} from '../../../lib/decision-os/presentation/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRec(overrides: Partial<ReturnType<typeof baseRec>> = {}) {
  return { ...baseRec(), ...overrides }
}
function baseRec() {
  return {
    id: 'rec_commissioner_retention_intervention_league001',
    tier: 'commissioner',
    category: 'retention_intervention',
    entityId: 'league001',
    priority: 'high',
    severity: 'elevated',
    confidence: 'high',
    affectedDimensions: ['engagement', 'retention'],
    expectedImpact: 'Reduces manager churn by reconnecting disengaged members.',
    derivation: ['retentionRisk=high → retention_intervention'],
    evidence: ['3 managers inactive 14+ days'],
    benchmarkComparison: 'Retention risk above platform p75',
    prerequisites: [],
    recommendedActions: [{ action: 'Send personal message', rationale: 'Direct outreach converts best' }],
    rollbackCriteria: ['manager re-engages within 7 days'],
    completeness: 85,
    uncertainty: [],
  }
}

function makeBenchmarkInput() {
  return {
    engagement: { percentile: 80, rank: 5, total: 25, archetypePercentile: 75, archetypeRank: 2, archetypeCohortSize: 8 },
    retentionSafety: { percentile: 60, rank: 10, total: 25, archetypePercentile: 55, archetypeRank: 4, archetypeCohortSize: 8 },
    tradeActivity: { percentile: 70, rank: 8, total: 25, archetypePercentile: null, archetypeRank: null, archetypeCohortSize: 2 },
    waiverActivity: { percentile: 50, rank: 13, total: 25, archetypePercentile: 48, archetypeRank: 5, archetypeCohortSize: 8 },
    commissionerEfficiency: { percentile: 90, rank: 3, total: 25, archetypePercentile: 88, archetypeRank: 1, archetypeCohortSize: 8 },
    archetype: 'competitive_balanced',
    archetypeCohortSize: 8,
  }
}

// ── Version stamps ────────────────────────────────────────────────────────────

describe('PRESENTATION_VERSION', () => {
  it('is the expected version string', () => {
    expect(PRESENTATION_VERSION).toBe('7.0.0')
  })

  it('is carried on graph model outputs', () => {
    const g = buildGaugeGraph('e1', 75, 'Health')
    expect(g.version).toBe(PRESENTATION_VERSION)
  })

  it('is carried on card outputs', () => {
    const c = buildHealthCard('e1', 80, 'good')
    expect(c.version).toBe(PRESENTATION_VERSION)
  })

  it('is carried on widget outputs', () => {
    const m = buildEngagementMetric('e1', 70, 'active', 90)
    const w = buildCompactWidget('e1', 'league', m)
    expect(w.version).toBe(PRESENTATION_VERSION)
  })

  it('is carried on recommendation presentation', () => {
    const rp = buildRecommendationPresentation(makeRec())
    const set = buildRecommendationPresentationSet([rp], 'league001', 'commissioner')
    expect(set.version).toBe(PRESENTATION_VERSION)
  })
})

// ── SEVERITY_DEFINITIONS ──────────────────────────────────────────────────────

describe('SEVERITY_DEFINITIONS', () => {
  it('defines all five severity tokens', () => {
    const tokens = ['critical', 'elevated', 'standard', 'advisory', 'positive'] as const
    for (const t of tokens) {
      expect(SEVERITY_DEFINITIONS[t]).toBeDefined()
      expect(SEVERITY_DEFINITIONS[t].token).toBe(t)
    }
  })

  it('critical has priority 1 (most urgent)', () => {
    expect(SEVERITY_DEFINITIONS.critical.priority).toBe(1)
  })

  it('positive has priority 5 (least urgent)', () => {
    expect(SEVERITY_DEFINITIONS.positive.priority).toBe(5)
  })

  it('critical has pulse animation', () => {
    expect(SEVERITY_DEFINITIONS.critical.animationToken).toBe('pulse')
  })

  it('all others have no animation', () => {
    for (const t of ['elevated', 'standard', 'advisory', 'positive'] as const) {
      expect(SEVERITY_DEFINITIONS[t].animationToken).toBe('none')
    }
  })
})

// ── Token system ──────────────────────────────────────────────────────────────

describe('scoreToSeverity', () => {
  it('maps score < 30 → critical', () => expect(scoreToSeverity(0)).toBe('critical'))
  it('maps score 29 → critical', () => expect(scoreToSeverity(29)).toBe('critical'))
  it('maps score 30 → elevated', () => expect(scoreToSeverity(30)).toBe('elevated'))
  it('maps score 50 → standard', () => expect(scoreToSeverity(50)).toBe('standard'))
  it('maps score 70 → advisory', () => expect(scoreToSeverity(70)).toBe('advisory'))
  it('maps score 85 → positive', () => expect(scoreToSeverity(85)).toBe('positive'))
  it('maps score 100 → positive', () => expect(scoreToSeverity(100)).toBe('positive'))
})

describe('percentileToSeverity', () => {
  it('p0 → critical', () => expect(percentileToSeverity(0)).toBe('critical'))
  it('p40 → standard', () => expect(percentileToSeverity(40)).toBe('standard'))
  it('p80 → positive', () => expect(percentileToSeverity(80)).toBe('positive'))
})

describe('engagementTierToSeverity', () => {
  it('elite → positive', () => expect(engagementTierToSeverity('elite')).toBe('positive'))
  it('active → advisory', () => expect(engagementTierToSeverity('active')).toBe('advisory'))
  it('moderate → standard', () => expect(engagementTierToSeverity('moderate')).toBe('standard'))
  it('passive → elevated', () => expect(engagementTierToSeverity('passive')).toBe('elevated'))
  it('dormant → critical', () => expect(engagementTierToSeverity('dormant')).toBe('critical'))
  it('unknown → advisory', () => expect(engagementTierToSeverity('unknown')).toBe('advisory'))
})

describe('retentionRiskToSeverity', () => {
  it('low → positive', () => expect(retentionRiskToSeverity('low')).toBe('positive'))
  it('medium → standard', () => expect(retentionRiskToSeverity('medium')).toBe('standard'))
  it('high → elevated', () => expect(retentionRiskToSeverity('high')).toBe('elevated'))
  it('critical → critical', () => expect(retentionRiskToSeverity('critical')).toBe('critical'))
})

describe('workloadToSeverity', () => {
  it('light → positive', () => expect(workloadToSeverity('light')).toBe('positive'))
  it('moderate → advisory', () => expect(workloadToSeverity('moderate')).toBe('advisory'))
  it('heavy → standard', () => expect(workloadToSeverity('heavy')).toBe('standard'))
  it('critical → critical', () => expect(workloadToSeverity('critical')).toBe('critical'))
})

describe('recommendationPriorityToSeverity', () => {
  it('critical → critical', () => expect(recommendationPriorityToSeverity('critical')).toBe('critical'))
  it('high → elevated', () => expect(recommendationPriorityToSeverity('high')).toBe('elevated'))
  it('medium → standard', () => expect(recommendationPriorityToSeverity('medium')).toBe('standard'))
  it('low → advisory', () => expect(recommendationPriorityToSeverity('low')).toBe('advisory'))
})

describe('archetypeToSeverity', () => {
  it('highly_engaged → positive', () => expect(archetypeToSeverity('highly_engaged')).toBe('positive'))
  it('inactive_or_stale → critical', () => expect(archetypeToSeverity('inactive_or_stale')).toBe('critical'))
  it('high_churn_risk → elevated', () => expect(archetypeToSeverity('high_churn_risk')).toBe('elevated'))
  it('unknown → advisory', () => expect(archetypeToSeverity('unknown')).toBe('advisory'))
})

describe('color token mappers', () => {
  it('percentile ≥ 75 → benchmark_above', () => expect(percentileToColorToken(80)).toBe('benchmark_above'))
  it('percentile 40–74 → benchmark_equal', () => expect(percentileToColorToken(50)).toBe('benchmark_equal'))
  it('percentile < 40 → benchmark_below', () => expect(percentileToColorToken(30)).toBe('benchmark_below'))
  it('highly_engaged → success', () => expect(archetypeToColorToken('highly_engaged')).toBe('success'))
  it('inactive_or_stale → critical', () => expect(archetypeToColorToken('inactive_or_stale')).toBe('critical'))
  it('ghost_manager → critical', () => expect(identityToColorToken('ghost_manager')).toBe('critical'))
  it('committed_grinder → success', () => expect(identityToColorToken('committed_grinder')).toBe('success'))
  it('score 85 → success', () => expect(scoreToColorToken(85)).toBe('success'))
  it('score 40 → danger', () => expect(scoreToColorToken(40)).toBe('danger'))
})

describe('icon token mappers', () => {
  it('ghost_manager → ghost', () => expect(identityToIconToken('ghost_manager')).toBe('ghost'))
  it('committed_grinder → trophy', () => expect(identityToIconToken('committed_grinder')).toBe('trophy'))
  it('waiver_hawk → zap', () => expect(identityToIconToken('waiver_hawk')).toBe('zap'))
  it('highly_engaged archetype → flame', () => expect(archetypeToIconToken('highly_engaged')).toBe('flame'))
  it('inactive_or_stale archetype → clock', () => expect(archetypeToIconToken('inactive_or_stale')).toBe('clock'))
})

// ── Badge system ──────────────────────────────────────────────────────────────

describe('buildManagerBadges', () => {
  it('returns ghost_manager badge for ghost_manager identity', () => {
    const badges = buildManagerBadges('mgr1', { primaryIdentity: 'ghost_manager', completeness: 80 })
    expect(badges.some((b) => b.catalogId === 'ghost_manager')).toBe(true)
  })

  it('returns committed_grinder badge', () => {
    const badges = buildManagerBadges('mgr2', { primaryIdentity: 'committed_grinder', completeness: 90 })
    expect(badges.some((b) => b.catalogId === 'committed_grinder')).toBe(true)
  })

  it('returns empty array for unknown identity', () => {
    const badges = buildManagerBadges('mgr3', { primaryIdentity: 'unknown', completeness: 80 })
    expect(badges).toHaveLength(0)
  })

  it('returns empty array when completeness < 20', () => {
    const badges = buildManagerBadges('mgr4', { primaryIdentity: 'ghost_manager', completeness: 10 })
    expect(badges).toHaveLength(0)
  })

  it('badge id is scoped to managerId', () => {
    const badges = buildManagerBadges('mgr5', { primaryIdentity: 'serial_trader', completeness: 70 })
    expect(badges[0]?.id).toContain('mgr5')
  })

  it('badges are stable-sorted by id', () => {
    const badges = buildManagerBadges('mgr6', { primaryIdentity: 'waiver_hawk', completeness: 80 })
    const sorted = [...badges].sort((a, b) => a.id.localeCompare(b.id))
    expect(badges).toEqual(sorted)
  })
})

describe('buildLeagueBadges', () => {
  it('assigns top_10_pct when engagement percentile ≥ 90', () => {
    const bm = { engagement: { percentile: 92 }, retentionSafety: { percentile: 60 }, tradeActivity: { percentile: 55 }, waiverActivity: { percentile: 50 }, commissionerEfficiency: { percentile: 45 } }
    const badges = buildLeagueBadges('league1', { archetype: 'highly_engaged', archetypeConfidence: 0.8, retentionRisk: 'low', engagementTier: 'elite', benchmark: bm, completeness: 90 })
    expect(badges.some((b) => b.catalogId === 'top_10_pct')).toBe(true)
  })

  it('assigns benchmark_leader when all 5 dimensions ≥ p50', () => {
    const bm = { engagement: { percentile: 80 }, retentionSafety: { percentile: 70 }, tradeActivity: { percentile: 60 }, waiverActivity: { percentile: 55 }, commissionerEfficiency: { percentile: 65 } }
    const badges = buildLeagueBadges('league2', { benchmark: bm, completeness: 80 })
    expect(badges.some((b) => b.catalogId === 'benchmark_leader')).toBe(true)
  })

  it('assigns retention_risk for high retention risk', () => {
    const badges = buildLeagueBadges('league3', { retentionRisk: 'high', completeness: 80 })
    expect(badges.some((b) => b.catalogId === 'retention_risk')).toBe(true)
  })

  it('assigns inactive_or_stale for that archetype', () => {
    const badges = buildLeagueBadges('league4', { archetype: 'inactive_or_stale', archetypeConfidence: 0.75, completeness: 80 })
    expect(badges.some((b) => b.catalogId === 'inactive_or_stale')).toBe(true)
  })

  it('assigns needs_attention when engagement < p25', () => {
    const bm = { engagement: { percentile: 20 }, retentionSafety: { percentile: 30 }, tradeActivity: { percentile: 25 }, waiverActivity: { percentile: 20 }, commissionerEfficiency: { percentile: 35 } }
    const badges = buildLeagueBadges('league5', { benchmark: bm, completeness: 70 })
    expect(badges.some((b) => b.catalogId === 'needs_attention')).toBe(true)
  })

  it('deduplicates badges by catalogId', () => {
    // trade_heavy appears both from archetype and from benchmark
    const bm = { engagement: { percentile: 50 }, retentionSafety: { percentile: 50 }, tradeActivity: { percentile: 80 }, waiverActivity: { percentile: 50 }, commissionerEfficiency: { percentile: 50 } }
    const badges = buildLeagueBadges('league6', { archetype: 'trade_heavy', archetypeConfidence: 0.8, benchmark: bm, completeness: 80 })
    const tradeHeavy = badges.filter((b) => b.catalogId === 'trade_heavy')
    expect(tradeHeavy.length).toBe(1)
  })

  it('returns empty when completeness < 20', () => {
    expect(buildLeagueBadges('league7', { completeness: 15 })).toHaveLength(0)
  })

  it('badges are sorted by id (deterministic)', () => {
    const bm = makeBenchmarkInput()
    const badges = buildLeagueBadges('league8', { archetype: 'competitive_balanced', archetypeConfidence: 0.8, retentionRisk: 'low', engagementTier: 'active', benchmark: bm, completeness: 85 })
    const sorted = [...badges].sort((a, b) => a.id.localeCompare(b.id))
    expect(badges).toEqual(sorted)
  })
})

describe('buildPlatformBadges', () => {
  it('assigns platform_growing when momentum = accelerating', () => {
    const badges = buildPlatformBadges('plat1', { momentumSignal: 'accelerating', platformHealthScore: 70, atRiskLeaguePercent: 0.15, completeness: 80 })
    expect(badges.some((b) => b.catalogId === 'platform_growing')).toBe(true)
  })

  it('assigns platform_at_risk when atRiskPercent > 0.40', () => {
    const badges = buildPlatformBadges('plat2', { momentumSignal: 'steady', platformHealthScore: 45, atRiskLeaguePercent: 0.50, completeness: 80 })
    expect(badges.some((b) => b.catalogId === 'platform_at_risk')).toBe(true)
  })
})

// ── Graph models ──────────────────────────────────────────────────────────────

describe('buildGaugeGraph', () => {
  it('produces gauge graphType', () => {
    expect(buildGaugeGraph('e1', 75, 'Health').graphType).toBe('gauge')
  })

  it('clamps value to [0, 100]', () => {
    expect(buildGaugeGraph('e1', 150, 'Health').value).toBe(100)
    expect(buildGaugeGraph('e1', -10, 'Health').value).toBe(0)
  })

  it('graphId is deterministic', () => {
    expect(buildGaugeGraph('e1', 75, 'H').graphId).toBe('graph_e1_gauge')
  })

  it('carries PRESENTATION_VERSION', () => {
    expect(buildGaugeGraph('e1', 75, 'H').version).toBe(PRESENTATION_VERSION)
  })

  it('high score → positive severity', () => {
    expect(buildGaugeGraph('e1', 90, 'H').severityToken).toBe('positive')
  })

  it('low score → critical severity', () => {
    expect(buildGaugeGraph('e1', 10, 'H').severityToken).toBe('critical')
  })
})

describe('buildProgressRingGraph', () => {
  it('produces progress_ring graphType', () => {
    expect(buildProgressRingGraph('e1', 65, 'Completeness').graphType).toBe('progress_ring')
  })

  it('displayValue includes % suffix', () => {
    expect(buildProgressRingGraph('e1', 72, 'Label').displayValue).toBe('72%')
  })
})

describe('buildBarGraph', () => {
  it('produces bar graphType', () => {
    const g = buildBarGraph('e1', [{ label: 'A', value: 50, colorToken: 'accent' }], 'Bars')
    expect(g.graphType).toBe('bar')
  })

  it('bars array is independent (no mutation)', () => {
    const bars = [{ label: 'A', value: 50, colorToken: 'accent' as const }]
    buildBarGraph('e1', bars, 'Test')
    expect(bars).toHaveLength(1)
  })
})

describe('buildTrendGraph', () => {
  it('direction=up when current > base', () => {
    expect(buildTrendGraph('e1', 50, 70, 'Trend').direction).toBe('up')
  })

  it('direction=down when current < base', () => {
    expect(buildTrendGraph('e1', 80, 60, 'Trend').direction).toBe('down')
  })

  it('direction=flat when equal', () => {
    expect(buildTrendGraph('e1', 70, 70, 'Trend').direction).toBe('flat')
  })
})

describe('buildSparklineGraph', () => {
  it('produces sparkline graphType', () => {
    expect(buildSparklineGraph('e1', [10, 20, 30], 'Spark').graphType).toBe('sparkline')
  })

  it('direction=up when last > first', () => {
    expect(buildSparklineGraph('e1', [10, 20, 30], 'S').direction).toBe('up')
  })

  it('direction=down when last < first', () => {
    expect(buildSparklineGraph('e1', [30, 20, 10], 'S').direction).toBe('down')
  })

  it('does not mutate input values array', () => {
    const vals = [1, 2, 3]
    buildSparklineGraph('e1', vals, 'S')
    expect(vals).toEqual([1, 2, 3])
  })
})

describe('buildDonutGraph', () => {
  it('computes totalValue', () => {
    const g = buildDonutGraph('e1', [
      { segmentId: 'a', label: 'A', value: 30, fraction: 0.3, colorToken: 'success' },
      { segmentId: 'b', label: 'B', value: 70, fraction: 0.7, colorToken: 'danger' },
    ], 'Donut')
    expect(g.totalValue).toBe(100)
  })
})

describe('buildHeatmapGraph', () => {
  it('produces heatmap graphType', () => {
    const g = buildHeatmapGraph('e1', [{ dayOfWeek: 2, hour: 19, count: 10 }], 'Activity')
    expect(g.graphType).toBe('heatmap')
  })

  it('identifies peak cell', () => {
    const g = buildHeatmapGraph('e1', [
      { dayOfWeek: 0, hour: 8, count: 5 },
      { dayOfWeek: 2, hour: 19, count: 100 },
    ], 'Peak')
    expect(g.peakCell?.x).toBe(2)
    expect(g.peakCell?.y).toBe(19)
  })

  it('xLabels has 7 day entries', () => {
    const g = buildHeatmapGraph('e1', [], 'H')
    expect(g.xLabels).toHaveLength(7)
  })

  it('yLabels has 24 hour entries', () => {
    const g = buildHeatmapGraph('e1', [], 'H')
    expect(g.yLabels).toHaveLength(24)
  })

  it('empty cells → peakCell is null', () => {
    expect(buildHeatmapGraph('e1', [], 'H').peakCell).toBeNull()
  })
})

describe('buildTimelineGraph', () => {
  it('sorts events by startedAt', () => {
    const g = buildTimelineGraph('e1', [
      { eventId: 'b', label: 'B', startedAt: '2026-02-01', endedAt: '2026-02-07', durationDays: 6, colorToken: 'accent', iconToken: 'zap', summary: 'Later' },
      { eventId: 'a', label: 'A', startedAt: '2026-01-01', endedAt: '2026-01-10', durationDays: 9, colorToken: 'accent', iconToken: 'check', summary: 'Earlier' },
    ], 'Timeline')
    expect(g.events[0]?.eventId).toBe('a')
  })
})

describe('buildDistributionHistogramGraph', () => {
  it('produces correct bucket count', () => {
    const values = Array.from({ length: 50 }, (_, i) => i * 2)
    const g = buildDistributionHistogramGraph('e1', values, 'Distribution', { bucketCount: 5 })
    expect(g.buckets).toHaveLength(5)
  })

  it('highlights bucket containing highlightValue', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80]
    const g = buildDistributionHistogramGraph('e1', values, 'D', { highlightValue: 50 })
    const highlighted = g.buckets.filter((b) => b.highlight)
    expect(highlighted.length).toBe(1)
  })
})

describe('buildWaterfallGraph', () => {
  it('computes correct final value', () => {
    const g = buildWaterfallGraph('e1', 100, [
      { label: 'Deduction 1', delta: -20 },
      { label: 'Deduction 2', delta: -10 },
    ], 'Score Breakdown')
    expect(g.finalValue).toBe(70)
  })

  it('first step is base, last step is final', () => {
    const g = buildWaterfallGraph('e1', 100, [{ label: 'D', delta: -5 }], 'W')
    expect(g.steps[0]?.isBase).toBe(true)
    expect(g.steps[g.steps.length - 1]?.isFinal).toBe(true)
  })

  it('clamps final value to 0 on large deductions', () => {
    const g = buildWaterfallGraph('e1', 100, [{ label: 'Big cut', delta: -999 }], 'W')
    expect(g.finalValue).toBeGreaterThanOrEqual(0)
  })
})

describe('buildActivityCalendarGraph', () => {
  it('sorts days ascending', () => {
    const g = buildActivityCalendarGraph('e1', [
      { date: '2026-02-01', count: 5 },
      { date: '2026-01-15', count: 3 },
    ], 'Calendar')
    expect(g.days[0]?.date).toBe('2026-01-15')
  })

  it('normalizedValue is 1 for the max-count day', () => {
    const g = buildActivityCalendarGraph('e1', [
      { date: '2026-01-01', count: 10 },
      { date: '2026-01-02', count: 5 },
    ], 'C')
    const maxDay = g.days.find((d) => d.count === 10)
    expect(maxDay?.normalizedValue).toBe(1)
  })
})

describe('buildBenchmarkRadarGraph', () => {
  it('produces radar graphType', () => {
    const g = buildBenchmarkRadarGraph('league1', makeBenchmarkInput())
    expect(g.graphType).toBe('radar')
  })

  it('has 5 dimensions', () => {
    const g = buildBenchmarkRadarGraph('league1', makeBenchmarkInput())
    expect(g.dimensions).toHaveLength(5)
  })

  it('benchmark dimensions are at 0.50 (platform median)', () => {
    const g = buildBenchmarkRadarGraph('league1', makeBenchmarkInput())
    for (const d of g.benchmarkDimensions) {
      expect(d.value).toBe(0.50)
    }
  })
})

// ── Card models ───────────────────────────────────────────────────────────────

describe('buildHealthCard', () => {
  it('produces health cardType', () => {
    expect(buildHealthCard('e1', 75, 'good').cardType).toBe('health')
  })

  it('cardId is deterministic', () => {
    expect(buildHealthCard('e1', 75, 'good').cardId).toBe('card_e1_health')
  })

  it('clamps health score to [0, 100]', () => {
    expect(buildHealthCard('e1', 150, 'good').healthScore).toBe(100)
    expect(buildHealthCard('e1', -5, 'poor').healthScore).toBe(0)
  })

  it('carries version', () => {
    expect(buildHealthCard('e1', 80, 'good').version).toBe(PRESENTATION_VERSION)
  })
})

describe('buildRetentionCard', () => {
  it('produces retention cardType', () => {
    expect(buildRetentionCard('e1', 'high', ['3 inactive managers']).cardType).toBe('retention')
  })

  it('severity.token is elevated for high retention risk', () => {
    expect(buildRetentionCard('e1', 'high', []).severity.token).toBe('elevated')
  })

  it('severity.token is positive for low retention risk', () => {
    expect(buildRetentionCard('e1', 'low', []).severity.token).toBe('positive')
  })
})

describe('buildDnaCard', () => {
  it('produces dna cardType', () => {
    const card = buildDnaCard('mgr1', {
      primaryIdentity: 'ghost_manager', confidence: 0.75,
      decisionStyle: 'reactive', transactionStyle: 'passive',
      riskTendency: 'risk_averse', engagementReliability: 'unreliable',
      traits: [{ trait: 'inactive', strength: 'strong' }],
      derivation: ['inactivity → ghost_manager'],
      completeness: 80,
    })
    expect(card.cardType).toBe('dna')
    expect(card.primaryIdentity).toBe('ghost_manager')
    expect(card.severity.token).toBe('critical')
  })

  it('low confidence → uncertainty flag', () => {
    const card = buildDnaCard('mgr2', {
      primaryIdentity: 'committed_grinder', confidence: 0.45,
      decisionStyle: 'methodical', transactionStyle: 'balanced',
      riskTendency: 'neutral', engagementReliability: 'reliable',
      traits: [], derivation: [], completeness: 70,
    })
    expect(card.uncertainty).toContain('identity_confidence_low')
  })
})

describe('buildLeagueArchetypeCard', () => {
  it('produces league_archetype cardType', () => {
    const card = buildLeagueArchetypeCard('league1', {
      label: 'highly_engaged', confidence: 0.82,
      reasons: ['elite tier'], derivation: [{ signal: 'engagementTier', value: 'elite', contribution: 'supports: highly_engaged' }],
    })
    expect(card.cardType).toBe('league_archetype')
    expect(card.archetypeLabel).toBe('highly_engaged')
  })
})

describe('buildPlatformBenchmarkCard', () => {
  it('produces platform_benchmark cardType', () => {
    const card = buildPlatformBenchmarkCard('league1', makeBenchmarkInput())
    expect(card.cardType).toBe('platform_benchmark')
  })

  it('engagement percentile maps to correct colorToken', () => {
    const card = buildPlatformBenchmarkCard('league1', makeBenchmarkInput())
    expect(card.engagement.colorToken).toBe('benchmark_above')  // p80 ≥ 75
  })
})

describe('buildCompanyIntelligenceCard', () => {
  it('produces company_intelligence cardType', () => {
    const card = buildCompanyIntelligenceCard('plat1', {
      platformHealthScore: 65, healthTier: 'good',
      activeLeagueFraction: 0.7, criticalRetentionFraction: 0.05,
      passiveDormantFraction: 0.15, derivation: ['health=65 → good'], completeness: 90,
    })
    expect(card.cardType).toBe('company_intelligence')
    expect(card.platformHealthScore).toBe(65)
  })
})

describe('metric builders', () => {
  it('buildEngagementMetric produces correct structure', () => {
    const m = buildEngagementMetric('e1', 78, 'active', 85)
    expect(m.metricId).toBe('metric_e1_engagement')
    expect(m.numericValue).toBe(78)
    expect(m.progressValue).toBe(78)
  })

  it('buildRetentionMetric produces correct structure', () => {
    const m = buildRetentionMetric('e1', 'high', 80)
    expect(m.metricId).toBe('metric_e1_retention')
    expect(m.numericValue).toBeNull()
    expect(m.severityToken).toBe('elevated')
  })

  it('buildArchetypeMetric produces correct structure', () => {
    const m = buildArchetypeMetric('e1', 'highly_engaged', 0.82, 90)
    expect(m.metricId).toBe('metric_e1_archetype')
    expect(m.colorToken).toBe('success')
    expect(m.subtext).toContain('82%')
  })
})

// ── Recommendation presentation ───────────────────────────────────────────────

describe('buildRecommendationPresentation', () => {
  it('uses category template title', () => {
    const rp = buildRecommendationPresentation(makeRec({ category: 'retention_intervention' }))
    expect(rp.title).toBe('Retention Intervention')
  })

  it('uses category template difficulty', () => {
    const rp = buildRecommendationPresentation(makeRec({ category: 'draft_preparation' }))
    expect(rp.difficulty).toBe('moderate')
    expect(rp.estimatedTime).toBe('1_hour')
  })

  it('completionStatus defaults to pending', () => {
    expect(buildRecommendationPresentation(makeRec()).completionStatus).toBe('pending')
  })

  it('severity comes from priority', () => {
    const rp = buildRecommendationPresentation(makeRec({ priority: 'critical' }))
    expect(rp.severity.token).toBe('critical')
  })

  it('relatedGraph is null by default', () => {
    expect(buildRecommendationPresentation(makeRec()).relatedGraph).toBeNull()
  })

  it('relatedKpi is null by default', () => {
    expect(buildRecommendationPresentation(makeRec()).relatedKpi).toBeNull()
  })

  it('unknown category falls back gracefully', () => {
    const rp = buildRecommendationPresentation(makeRec({ category: 'custom_category_xyz' }))
    expect(rp.title).toBe('custom category xyz')
  })
})

describe('buildRecommendationPresentationSet', () => {
  it('sorts by priority DESC', () => {
    const critical = buildRecommendationPresentation(makeRec({ id: 'a', priority: 'critical', category: 'retention_intervention' }))
    const low = buildRecommendationPresentation(makeRec({ id: 'b', priority: 'low', category: 'weekly_recap' }))
    const set = buildRecommendationPresentationSet([low, critical], 'league1', 'commissioner')
    expect(set.items[0]?.priority).toBe('critical')
  })

  it('criticalCount is accurate', () => {
    const c1 = buildRecommendationPresentation(makeRec({ id: 'c1', priority: 'critical' }))
    const c2 = buildRecommendationPresentation(makeRec({ id: 'c2', priority: 'critical', category: 'waiver_activation' }))
    const h1 = buildRecommendationPresentation(makeRec({ id: 'h1', priority: 'high', category: 'league_event' }))
    const set = buildRecommendationPresentationSet([c1, c2, h1], 'l1', 'commissioner')
    expect(set.criticalCount).toBe(2)
  })

  it('does not mutate input array', () => {
    const rp = buildRecommendationPresentation(makeRec())
    const orig = [rp]
    buildRecommendationPresentationSet(orig, 'l1', 'commissioner')
    expect(orig).toHaveLength(1)
  })
})

// ── Widget contracts ──────────────────────────────────────────────────────────

describe('buildCompactWidget', () => {
  it('produces compact widgetType', () => {
    const m = buildEngagementMetric('l1', 75, 'active', 85)
    expect(buildCompactWidget('l1', 'league', m).widgetType).toBe('compact')
  })

  it('widgetId is deterministic', () => {
    const m = buildEngagementMetric('l1', 75, 'active', 85)
    expect(buildCompactWidget('l1', 'league', m).widgetId).toBe('widget_l1_compact')
  })
})

describe('buildSidebarWidget', () => {
  it('caps topMetrics at 3', () => {
    const metrics = [1, 2, 3, 4, 5].map((i) => buildEngagementMetric(`e${i}`, 70, 'active', 80))
    const w = buildSidebarWidget('l1', 'league', { topMetrics: metrics })
    expect(w.topMetrics).toHaveLength(3)
  })
})

describe('buildPopupWidget', () => {
  it('caps topRecommendations at 3', () => {
    const recs = [1, 2, 3, 4].map((i) =>
      buildRecommendationPresentation(makeRec({ id: `r${i}`, category: i % 2 === 0 ? 'weekly_recap' : 'trade_activation' }))
    )
    const w = buildPopupWidget('l1', 'league', 75, { topRecommendations: recs })
    expect(w.topRecommendations).toHaveLength(3)
  })

  it('healthColorToken matches score', () => {
    const w = buildPopupWidget('l1', 'league', 90)
    expect(w.healthColorToken).toBe('success')
  })
})

describe('buildCommissionerWidget', () => {
  it('filters to commissioner-tier recs only', () => {
    const commRec = buildRecommendationPresentation(makeRec({ id: 'cr', tier: 'commissioner' }))
    const mgrRec = buildRecommendationPresentation(makeRec({ id: 'mr', tier: 'manager', category: 'engagement_boost' }))
    const w = buildCommissionerWidget('l1', { recommendations: [commRec, mgrRec] })
    expect(w.recommendations.every((r) => r.tier === 'commissioner')).toBe(true)
  })
})

describe('buildManagerWidget', () => {
  it('filters to manager-tier recs only', () => {
    const mgrRec = buildRecommendationPresentation(makeRec({ id: 'mr', tier: 'manager', category: 'engagement_boost' }))
    const commRec = buildRecommendationPresentation(makeRec({ id: 'cr', tier: 'commissioner' }))
    const w = buildManagerWidget('mgr1', 'l1', { recommendations: [mgrRec, commRec] })
    expect(w.recommendations.every((r) => r.tier === 'manager')).toBe(true)
  })
})

describe('buildPartnerWidget', () => {
  it('embeds white-label config', () => {
    const config = getWhiteLabelConfig('sleeper')
    const m = buildEngagementMetric('l1', 70, 'active', 80)
    const inner = buildCompactWidget('l1', 'league', m)
    const w = buildPartnerWidget('l1', config, inner)
    expect(w.widgetType).toBe('partner')
    expect(w.whiteLabelConfig.platform).toBe('sleeper')
  })
})

// ── White-label layer ─────────────────────────────────────────────────────────

describe('WHITE_LABEL_CONFIGS', () => {
  it('has a config for each named platform', () => {
    const platforms = ['sleeper', 'yahoo', 'espn', 'fantrax', 'cbs', 'draftkings', 'fanduel', 'underdog', 'default']
    for (const p of platforms) {
      expect(WHITE_LABEL_CONFIGS[p]).toBeDefined()
    }
  })

  it('all configs have colorTokenMap', () => {
    for (const config of Object.values(WHITE_LABEL_CONFIGS)) {
      expect(config.colorTokenMap).toBeDefined()
    }
  })
})

describe('getWhiteLabelConfig', () => {
  it('returns sleeper config for sleeper', () => {
    expect(getWhiteLabelConfig('sleeper').platform).toBe('sleeper')
  })

  it('falls back to default for unknown platform', () => {
    expect(getWhiteLabelConfig('unknown_platform').platform).toBe('default')
  })
})

describe('resolveColorToken', () => {
  it('resolves to licensee token when mapped', () => {
    const config = getWhiteLabelConfig('sleeper')
    expect(resolveColorToken('success', config)).toBe('sleeper-emerald')
  })

  it('falls back to IPM token when no override', () => {
    const config = getWhiteLabelConfig('default')
    expect(resolveColorToken('success', config)).toBe('success')
  })
})

describe('resolveIconToken', () => {
  it('falls back to IPM token when no override', () => {
    const config = getWhiteLabelConfig('sleeper')
    expect(resolveIconToken('trophy', config)).toBe('trophy')
  })
})

describe('isSectionVisible', () => {
  it('returns true for visible sections', () => {
    const config = getWhiteLabelConfig('sleeper')
    expect(isSectionVisible('benchmarkComparison', config)).toBe(true)
  })

  it('returns false for hidden sections', () => {
    const config = getWhiteLabelConfig('sleeper')
    expect(isSectionVisible('companyIntelligence', config)).toBe(false)
  })

  it('defaults to true for undefined sections', () => {
    const config: typeof WHITE_LABEL_CONFIGS['default'] = {
      platform: 'custom', displayName: 'Custom', colorTokenMap: {}, iconTokenMap: {},
      labelOverrides: {}, sectionVisibility: {},
    }
    expect(isSectionVisible('benchmarkComparison', config)).toBe(true)
  })
})

// ── Determinism ───────────────────────────────────────────────────────────────

describe('determinism — same input → same output', () => {
  it('buildGaugeGraph is deterministic', () => {
    expect(buildGaugeGraph('e1', 75, 'H')).toEqual(buildGaugeGraph('e1', 75, 'H'))
  })

  it('buildBenchmarkRadarGraph is deterministic', () => {
    const bm = makeBenchmarkInput()
    expect(buildBenchmarkRadarGraph('l1', bm)).toEqual(buildBenchmarkRadarGraph('l1', bm))
  })

  it('buildLeagueBadges is deterministic', () => {
    const input = { archetype: 'highly_engaged', archetypeConfidence: 0.8, benchmark: makeBenchmarkInput(), completeness: 85 }
    expect(buildLeagueBadges('l1', input)).toEqual(buildLeagueBadges('l1', input))
  })

  it('buildRecommendationPresentation is deterministic', () => {
    const rec = makeRec()
    expect(buildRecommendationPresentation(rec)).toEqual(buildRecommendationPresentation(rec))
  })

  it('buildRecommendationPresentationSet is deterministic', () => {
    const recs = [
      buildRecommendationPresentation(makeRec({ id: 'a', priority: 'high' })),
      buildRecommendationPresentation(makeRec({ id: 'b', priority: 'critical', category: 'trade_activation' })),
    ]
    const set1 = buildRecommendationPresentationSet([...recs], 'l1', 'commissioner')
    const set2 = buildRecommendationPresentationSet([...recs], 'l1', 'commissioner')
    expect(set1).toEqual(set2)
  })
})

// ── Serialization ─────────────────────────────────────────────────────────────

describe('serialization — JSON round-trip', () => {
  it('gauge graph survives JSON round-trip', () => {
    const g = buildGaugeGraph('e1', 72, 'Health')
    expect(JSON.parse(JSON.stringify(g))).toEqual(g)
  })

  it('recommendation presentation survives JSON round-trip', () => {
    const rp = buildRecommendationPresentation(makeRec())
    expect(JSON.parse(JSON.stringify(rp))).toEqual(rp)
  })

  it('sidebar widget survives JSON round-trip', () => {
    const hc = buildHealthCard('l1', 75, 'good')
    const w = buildSidebarWidget('l1', 'league', { healthCard: hc })
    expect(JSON.parse(JSON.stringify(w))).toEqual(w)
  })

  it('white-label config survives JSON round-trip', () => {
    const config = getWhiteLabelConfig('yahoo')
    expect(JSON.parse(JSON.stringify(config))).toEqual(config)
  })
})

// ── No mutation ───────────────────────────────────────────────────────────────

describe('no mutation', () => {
  it('buildBarGraph does not mutate input bars', () => {
    const bars = [{ label: 'A', value: 50, colorToken: 'accent' as const }]
    const barsCopy = JSON.parse(JSON.stringify(bars))
    buildBarGraph('e1', bars, 'T')
    expect(bars).toEqual(barsCopy)
  })

  it('buildTimelineGraph does not mutate input events', () => {
    const events = [
      { eventId: 'e1', label: 'E', startedAt: '2026-01-01', endedAt: '2026-01-07', durationDays: 6, colorToken: 'accent' as const, iconToken: 'check' as const, summary: 'S' },
    ]
    const copy = JSON.parse(JSON.stringify(events))
    buildTimelineGraph('e1', events, 'T')
    expect(events).toEqual(copy)
  })

  it('buildSparklineGraph does not mutate input values', () => {
    const vals = [10, 20, 30]
    buildSparklineGraph('e1', vals, 'S')
    expect(vals).toEqual([10, 20, 30])
  })

  it('buildRecommendationPresentationSet does not mutate input', () => {
    const recs = [buildRecommendationPresentation(makeRec())]
    const copy = [...recs]
    buildRecommendationPresentationSet(recs, 'l1', 'commissioner')
    expect(recs).toEqual(copy)
  })
})

// ── Completeness propagation ──────────────────────────────────────────────────

describe('completeness propagation', () => {
  it('health card carries input completeness', () => {
    expect(buildHealthCard('e1', 70, 'good', { completeness: 42 }).completeness).toBe(42)
  })

  it('retention card carries input completeness', () => {
    expect(buildRetentionCard('e1', 'high', [], { completeness: 33 }).completeness).toBe(33)
  })

  it('recommendation presentation carries input completeness', () => {
    expect(buildRecommendationPresentation(makeRec({ completeness: 55 })).completeness).toBe(55)
  })

  it('compact widget defaults completeness from primary metric', () => {
    const m = buildEngagementMetric('e1', 70, 'active', 67)
    expect(buildCompactWidget('e1', 'league', m).completeness).toBe(67)
  })
})

// ── Uncertainty propagation ───────────────────────────────────────────────────

describe('uncertainty propagation', () => {
  it('recommendation presentation carries input uncertainty', () => {
    const rp = buildRecommendationPresentation(makeRec({ uncertainty: ['low_confidence', 'sparse_data'] }))
    expect(rp.uncertainty).toContain('low_confidence')
    expect(rp.uncertainty).toContain('sparse_data')
  })

  it('dna card sets identity_confidence_low when confidence < 0.50', () => {
    const card = buildDnaCard('m1', {
      primaryIdentity: 'trade_seeker', confidence: 0.40,
      decisionStyle: 'decisive', transactionStyle: 'trade_dominant',
      riskTendency: 'risk_taking', engagementReliability: 'reliable',
      traits: [], derivation: [], completeness: 60,
    })
    expect(card.uncertainty).toContain('identity_confidence_low')
  })
})

// ── Sparse / empty data ───────────────────────────────────────────────────────

describe('sparse data handling', () => {
  it('buildGaugeGraph works with zero score', () => {
    const g = buildGaugeGraph('e1', 0, 'Health')
    expect(g.value).toBe(0)
    expect(g.severityToken).toBe('critical')
  })

  it('buildSparklineGraph handles single value', () => {
    const g = buildSparklineGraph('e1', [50], 'S')
    expect(g.direction).toBe('flat')
  })

  it('buildSparklineGraph handles empty array', () => {
    const g = buildSparklineGraph('e1', [], 'S')
    expect(g.direction).toBe('flat')
    expect(g.values).toHaveLength(0)
  })

  it('buildDonutGraph with no segments has totalValue 0', () => {
    expect(buildDonutGraph('e1', [], 'D').totalValue).toBe(0)
  })

  it('buildCommissionerWidget with no options produces minimal valid widget', () => {
    const w = buildCommissionerWidget('l1')
    expect(w.widgetType).toBe('commissioner')
    expect(w.recommendations).toHaveLength(0)
  })

  it('buildLeagueBadges with empty input returns empty array', () => {
    expect(buildLeagueBadges('l1', { completeness: 80 })).toHaveLength(0)
  })

  it('buildRecommendationPresentationSet with empty recs returns empty set', () => {
    const set = buildRecommendationPresentationSet([], 'l1', 'commissioner')
    expect(set.totalItems).toBe(0)
    expect(set.criticalCount).toBe(0)
  })
})

// ── Ordering invariants ───────────────────────────────────────────────────────

describe('ordering invariants', () => {
  it('recommendation set is priority-ordered (critical first)', () => {
    const recs = ['low', 'critical', 'medium', 'high'].map((priority, i) =>
      buildRecommendationPresentation(makeRec({ id: `r${i}`, priority, category: 'weekly_recap' }))
    )
    const set = buildRecommendationPresentationSet(recs, 'l1', 'commissioner')
    const priorities = set.items.map((r) => r.priority)
    expect(priorities[0]).toBe('critical')
    expect(priorities[priorities.length - 1]).toBe('low')
  })

  it('heatmap cells are not reordered (order matches input)', () => {
    const cells = [
      { dayOfWeek: 5, hour: 12, count: 3 },
      { dayOfWeek: 1, hour: 8, count: 7 },
    ]
    const g = buildHeatmapGraph('e1', cells, 'H')
    // Heatmap cells preserve order (not sorted)
    expect(g.cells).toHaveLength(2)
  })
})
