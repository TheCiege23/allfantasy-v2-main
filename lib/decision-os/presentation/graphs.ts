/**
 * Decision OS — Phase 7.0 IPM Graph Assemblers.
 *
 * Pure functions that build serializable graph data models.
 * No SVG, no D3, no Canvas, no CSS — data contracts only.
 */

import type {
  BarGraphModel, BarEntry, ReferenceLine,
  HorizontalBarGraphModel, HorizontalBarEntry,
  LineGraphModel, LineSeries,
  TrendGraphModel,
  SparklineGraphModel,
  DonutGraphModel, DonutSegment,
  GaugeGraphModel, GaugeThreshold,
  ProgressRingGraphModel,
  RadarGraphModel, RadarDimension,
  HeatmapGraphModel, HeatmapCell,
  TimelineGraphModel, TimelineEvent,
  DistributionHistogramGraphModel, HistogramBucket,
  ComparisonChartGraphModel, ComparisonEntry,
  RankingTableGraphModel, RankingEntry,
  WaterfallGraphModel, WaterfallStep,
  ActivityCalendarGraphModel, ActivityDay,
  ColorToken, SeverityToken,
} from './types'
import {
  PRESENTATION_VERSION,
  percentileToColorToken,
  scoreToColorToken,
  scoreToSeverity,
} from './tokens'

// ── Gauge ─────────────────────────────────────────────────────────────────────

export function buildGaugeGraph(
  entityId: string,
  score: number,
  title: string,
  options?: {
    subtitle?: string
    thresholds?: GaugeThreshold[]
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): GaugeGraphModel {
  const opts = options ?? {}
  const thresholds: GaugeThreshold[] = opts.thresholds ?? [
    { value: 30, label: 'Critical', colorToken: 'critical' },
    { value: 50, label: 'Poor', colorToken: 'danger' },
    { value: 70, label: 'Moderate', colorToken: 'warning' },
    { value: 85, label: 'Good', colorToken: 'positive' },
    { value: 100, label: 'Excellent', colorToken: 'success' },
  ]
  return {
    graphId: `graph_${entityId}_gauge`,
    graphType: 'gauge',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: scoreToColorToken(score),
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`score=${score} → gauge`],
    version: PRESENTATION_VERSION,
    value: Math.round(Math.max(0, Math.min(100, score))),
    min: 0,
    max: 100,
    thresholds,
    displayValue: String(Math.round(score)),
    severityToken: scoreToSeverity(score),
  }
}

// ── Progress ring ─────────────────────────────────────────────────────────────

export function buildProgressRingGraph(
  entityId: string,
  value: number,
  label: string,
  options?: {
    subtitle?: string
    severityToken?: SeverityToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): ProgressRingGraphModel {
  const opts = options ?? {}
  const clamped = Math.round(Math.max(0, Math.min(100, value)))
  return {
    graphId: `graph_${entityId}_progress_ring`,
    graphType: 'progress_ring',
    title: label,
    subtitle: opts.subtitle ?? null,
    colorToken: scoreToColorToken(clamped),
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`value=${clamped} → progress_ring`],
    version: PRESENTATION_VERSION,
    value: clamped,
    displayValue: `${clamped}%`,
    label,
    severityToken: opts.severityToken ?? scoreToSeverity(clamped),
  }
}

// ── Bar graph ─────────────────────────────────────────────────────────────────

export function buildBarGraph(
  entityId: string,
  bars: BarEntry[],
  title: string,
  options?: {
    subtitle?: string
    xAxisLabel?: string
    yAxisLabel?: string
    yAxisMin?: number
    yAxisMax?: number
    sortOrder?: BarGraphModel['sortOrder']
    referenceLines?: ReferenceLine[]
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): BarGraphModel {
  const opts = options ?? {}
  const values = bars.map((b) => b.value)
  const maxVal = values.length > 0 ? Math.max(...values) : 100
  return {
    graphId: `graph_${entityId}_bar`,
    graphType: 'bar',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? 'accent',
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`${bars.length} bars → bar`],
    version: PRESENTATION_VERSION,
    xAxisLabel: opts.xAxisLabel ?? '',
    yAxisLabel: opts.yAxisLabel ?? '',
    yAxisMin: opts.yAxisMin ?? 0,
    yAxisMax: opts.yAxisMax ?? Math.ceil(maxVal * 1.1),
    bars,
    sortOrder: opts.sortOrder ?? 'none',
    referenceLines: opts.referenceLines ?? [],
  }
}

// ── Horizontal bar ────────────────────────────────────────────────────────────

export function buildHorizontalBarGraph(
  entityId: string,
  entries: HorizontalBarEntry[],
  title: string,
  options?: {
    subtitle?: string
    xAxisLabel?: string
    sortOrder?: HorizontalBarGraphModel['sortOrder']
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): HorizontalBarGraphModel {
  const opts = options ?? {}
  return {
    graphId: `graph_${entityId}_horizontal_bar`,
    graphType: 'horizontal_bar',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? 'accent',
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`${entries.length} entries → horizontal_bar`],
    version: PRESENTATION_VERSION,
    xAxisLabel: opts.xAxisLabel ?? '',
    entries,
    sortOrder: opts.sortOrder ?? 'descending',
  }
}

// ── Line graph ────────────────────────────────────────────────────────────────

export function buildLineGraph(
  entityId: string,
  series: LineSeries[],
  title: string,
  options?: {
    subtitle?: string
    xAxisLabel?: string
    yAxisLabel?: string
    yAxisMin?: number
    yAxisMax?: number
    referenceLines?: ReferenceLine[]
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): LineGraphModel {
  const opts = options ?? {}
  const allValues = series.flatMap((s) => s.points.map((p) => p.value))
  const maxVal = allValues.length > 0 ? Math.max(...allValues) : 100
  const minVal = allValues.length > 0 ? Math.min(...allValues) : 0
  return {
    graphId: `graph_${entityId}_line`,
    graphType: 'line',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? 'accent',
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`${series.length} series → line`],
    version: PRESENTATION_VERSION,
    xAxisLabel: opts.xAxisLabel ?? '',
    yAxisLabel: opts.yAxisLabel ?? '',
    yAxisMin: opts.yAxisMin ?? Math.floor(minVal * 0.9),
    yAxisMax: opts.yAxisMax ?? Math.ceil(maxVal * 1.1),
    series,
    referenceLines: opts.referenceLines ?? [],
  }
}

// ── Trend ─────────────────────────────────────────────────────────────────────

export function buildTrendGraph(
  entityId: string,
  baseValue: number,
  currentValue: number,
  title: string,
  options?: {
    subtitle?: string
    magnitudeLabel?: string
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): TrendGraphModel {
  const opts = options ?? {}
  const delta = currentValue - baseValue
  const direction: TrendGraphModel['direction'] =
    delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  const magnitude = Math.abs(delta)
  return {
    graphId: `graph_${entityId}_trend`,
    graphType: 'trend',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? (direction === 'up' ? 'success' : direction === 'down' ? 'danger' : 'neutral'),
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`base=${baseValue} current=${currentValue} delta=${delta} → trend`],
    version: PRESENTATION_VERSION,
    direction,
    magnitude,
    magnitudeLabel: opts.magnitudeLabel ?? String(Math.round(magnitude)),
    baseValue,
    currentValue,
  }
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

export function buildSparklineGraph(
  entityId: string,
  values: number[],
  title: string,
  options?: {
    subtitle?: string
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): SparklineGraphModel {
  const opts = options ?? {}
  const min = values.length > 0 ? Math.min(...values) : 0
  const max = values.length > 0 ? Math.max(...values) : 0
  const first = values[0] ?? 0
  const last = values[values.length - 1] ?? 0
  const direction: SparklineGraphModel['direction'] =
    last > first ? 'up' : last < first ? 'down' : 'flat'
  return {
    graphId: `graph_${entityId}_sparkline`,
    graphType: 'sparkline',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? (direction === 'up' ? 'success' : direction === 'down' ? 'danger' : 'neutral'),
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`${values.length} points → sparkline`],
    version: PRESENTATION_VERSION,
    values: [...values],
    min,
    max,
    direction,
  }
}

// ── Donut ─────────────────────────────────────────────────────────────────────

export function buildDonutGraph(
  entityId: string,
  segments: DonutSegment[],
  title: string,
  options?: {
    subtitle?: string
    centerLabel?: string
    centerValue?: string
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): DonutGraphModel {
  const opts = options ?? {}
  const totalValue = segments.reduce((s, seg) => s + seg.value, 0)
  return {
    graphId: `graph_${entityId}_donut`,
    graphType: 'donut',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? 'accent',
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`${segments.length} segments total=${totalValue} → donut`],
    version: PRESENTATION_VERSION,
    segments,
    totalValue,
    centerLabel: opts.centerLabel ?? null,
    centerValue: opts.centerValue ?? null,
  }
}

// ── Radar ─────────────────────────────────────────────────────────────────────

export function buildRadarGraph(
  entityId: string,
  dimensions: RadarDimension[],
  title: string,
  options?: {
    subtitle?: string
    benchmarkDimensions?: RadarDimension[]
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): RadarGraphModel {
  const opts = options ?? {}
  return {
    graphId: `graph_${entityId}_radar`,
    graphType: 'radar',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? 'accent',
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`${dimensions.length} dimensions → radar`],
    version: PRESENTATION_VERSION,
    dimensions,
    benchmarkDimensions: opts.benchmarkDimensions ?? [],
  }
}

// ── Heatmap ───────────────────────────────────────────────────────────────────

const HEATMAP_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HEATMAP_HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  const h = i % 12 || 12
  return i < 12 ? `${h}am` : `${h}pm`
})

export function buildHeatmapGraph(
  entityId: string,
  rawCells: Array<{ dayOfWeek: number; hour: number; count: number }>,
  title: string,
  options?: {
    subtitle?: string
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): HeatmapGraphModel {
  const opts = options ?? {}
  const maxCount = rawCells.length > 0 ? Math.max(...rawCells.map((c) => c.count)) : 1
  const totalValue = rawCells.reduce((s, c) => s + c.count, 0)

  const cells: HeatmapCell[] = rawCells.map((c) => {
    const normalized = maxCount > 0 ? c.count / maxCount : 0
    let colorToken: ColorToken = 'surface'
    if (normalized >= 0.75) colorToken = 'accent'
    else if (normalized >= 0.50) colorToken = 'positive'
    else if (normalized >= 0.25) colorToken = 'healthy'
    else if (normalized > 0) colorToken = 'muted'
    return { x: c.dayOfWeek, y: c.hour, value: c.count, normalizedValue: normalized, colorToken }
  })

  const peak = rawCells.length > 0
    ? rawCells.reduce((best, c) => (c.count > best.count ? c : best))
    : null

  return {
    graphId: `graph_${entityId}_heatmap`,
    graphType: 'heatmap',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? 'accent',
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`${rawCells.length} cells totalEvents=${totalValue} → heatmap`],
    version: PRESENTATION_VERSION,
    xLabels: HEATMAP_DAY_LABELS,
    yLabels: HEATMAP_HOUR_LABELS,
    cells,
    peakCell: peak ? { x: peak.dayOfWeek, y: peak.hour, value: peak.count } : null,
    totalValue,
  }
}

// ── Timeline ──────────────────────────────────────────────────────────────────

export function buildTimelineGraph(
  entityId: string,
  events: TimelineEvent[],
  title: string,
  options?: {
    subtitle?: string
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): TimelineGraphModel {
  const opts = options ?? {}
  const sorted = [...events].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const earliest = sorted[0]?.startedAt ?? null
  const latest = sorted[sorted.length - 1]?.endedAt ?? null
  return {
    graphId: `graph_${entityId}_timeline`,
    graphType: 'timeline',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? 'accent',
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`${events.length} events → timeline`],
    version: PRESENTATION_VERSION,
    events: sorted,
    earliestAt: earliest,
    latestAt: latest,
  }
}

// ── Distribution histogram ────────────────────────────────────────────────────

export function buildDistributionHistogramGraph(
  entityId: string,
  values: number[],
  title: string,
  options?: {
    subtitle?: string
    bucketCount?: number
    highlightValue?: number
    xAxisLabel?: string
    yAxisLabel?: string
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): DistributionHistogramGraphModel {
  const opts = options ?? {}
  const bucketCount = opts.bucketCount ?? 10

  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0] ?? 0
  const max = sorted[sorted.length - 1] ?? 100
  const range = max - min || 1
  const bucketWidth = range / bucketCount

  const buckets: HistogramBucket[] = Array.from({ length: bucketCount }, (_, i) => {
    const bucketMin = min + i * bucketWidth
    const bucketMax = i < bucketCount - 1 ? min + (i + 1) * bucketWidth : max + 0.001
    const count = sorted.filter((v) => v >= bucketMin && v < bucketMax).length
    const fraction = sorted.length > 0 ? count / sorted.length : 0
    const highlight = opts.highlightValue !== undefined &&
      opts.highlightValue >= bucketMin && opts.highlightValue < bucketMax
    return {
      bucketId: `bucket_${i}`,
      rangeLabel: `${Math.round(bucketMin)}–${Math.round(bucketMax)}`,
      min: bucketMin,
      max: bucketMax,
      count,
      fraction,
      colorToken: highlight ? 'accent' : 'neutral',
      highlight,
    }
  })

  const sum = sorted.reduce((s, v) => s + v, 0)
  const mean = sorted.length > 0 ? sum / sorted.length : 0
  const midIdx = Math.floor(sorted.length / 2)
  const median = sorted.length > 0
    ? sorted.length % 2 === 0
      ? ((sorted[midIdx - 1] ?? 0) + (sorted[midIdx] ?? 0)) / 2
      : (sorted[midIdx] ?? 0)
    : 0

  const highlightBucketId = opts.highlightValue !== undefined
    ? (buckets.find((b) => b.highlight)?.bucketId ?? null)
    : null

  return {
    graphId: `graph_${entityId}_distribution_histogram`,
    graphType: 'distribution_histogram',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? 'neutral',
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`${values.length} values → distribution_histogram`],
    version: PRESENTATION_VERSION,
    xAxisLabel: opts.xAxisLabel ?? '',
    yAxisLabel: opts.yAxisLabel ?? 'Count',
    buckets,
    highlightBucketId,
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
  }
}

// ── Comparison chart ──────────────────────────────────────────────────────────

export function buildComparisonChartGraph(
  entityId: string,
  entries: ComparisonEntry[],
  title: string,
  options?: {
    subtitle?: string
    xAxisLabel?: string
    referenceLines?: ReferenceLine[]
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): ComparisonChartGraphModel {
  const opts = options ?? {}
  return {
    graphId: `graph_${entityId}_comparison_chart`,
    graphType: 'comparison_chart',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? 'accent',
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`${entries.length} entries → comparison_chart`],
    version: PRESENTATION_VERSION,
    xAxisLabel: opts.xAxisLabel ?? '',
    entries,
    referenceLines: opts.referenceLines ?? [],
  }
}

// ── Ranking table ─────────────────────────────────────────────────────────────

export function buildRankingTableGraph(
  entityId: string,
  entries: RankingEntry[],
  title: string,
  options?: {
    subtitle?: string
    columnLabel?: string
    totalEntries?: number
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): RankingTableGraphModel {
  const opts = options ?? {}
  const sorted = [...entries].sort((a, b) => a.rank - b.rank)
  return {
    graphId: `graph_${entityId}_ranking_table`,
    graphType: 'ranking_table',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? 'neutral',
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`${entries.length} entries → ranking_table`],
    version: PRESENTATION_VERSION,
    columnLabel: opts.columnLabel ?? 'Score',
    entries: sorted,
    totalEntries: opts.totalEntries ?? entries.length,
  }
}

// ── Waterfall ─────────────────────────────────────────────────────────────────

export function buildWaterfallGraph(
  entityId: string,
  baseValue: number,
  steps: Array<{ label: string; delta: number; colorToken?: ColorToken }>,
  title: string,
  options?: {
    subtitle?: string
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): WaterfallGraphModel {
  const opts = options ?? {}
  let running = baseValue
  const waterfallSteps: WaterfallStep[] = [
    {
      stepId: 'base',
      label: 'Starting Value',
      delta: 0,
      runningTotal: baseValue,
      colorToken: 'neutral',
      isBase: true,
      isFinal: false,
    },
    ...steps.map((s, i): WaterfallStep => {
      running += s.delta
      return {
        stepId: `step_${i}`,
        label: s.label,
        delta: s.delta,
        runningTotal: Math.max(0, running),
        colorToken: s.colorToken ?? (s.delta >= 0 ? 'success' : 'danger'),
        isBase: false,
        isFinal: false,
      }
    }),
  ]
  const finalValue = Math.round(Math.max(0, running))
  waterfallSteps.push({
    stepId: 'final',
    label: 'Final Score',
    delta: 0,
    runningTotal: finalValue,
    colorToken: scoreToColorToken(finalValue),
    isBase: false,
    isFinal: true,
  })

  return {
    graphId: `graph_${entityId}_waterfall`,
    graphType: 'waterfall',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? scoreToColorToken(finalValue),
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`base=${baseValue} ${steps.length} steps final=${finalValue} → waterfall`],
    version: PRESENTATION_VERSION,
    baseValue,
    finalValue,
    steps: waterfallSteps,
  }
}

// ── Activity calendar ─────────────────────────────────────────────────────────

export function buildActivityCalendarGraph(
  entityId: string,
  days: Array<{ date: string; count: number }>,
  title: string,
  options?: {
    subtitle?: string
    colorToken?: ColorToken
    completeness?: number
    derivation?: string[]
    uncertainty?: string[]
  },
): ActivityCalendarGraphModel {
  const opts = options ?? {}
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const maxCount = sorted.length > 0 ? Math.max(...sorted.map((d) => d.count)) : 1
  const totalCount = sorted.reduce((s, d) => s + d.count, 0)

  const calDays: ActivityDay[] = sorted.map((d) => {
    const normalized = maxCount > 0 ? d.count / maxCount : 0
    let colorToken: ColorToken = 'surface'
    if (normalized >= 0.75) colorToken = 'success'
    else if (normalized >= 0.50) colorToken = 'positive'
    else if (normalized >= 0.25) colorToken = 'healthy'
    else if (normalized > 0) colorToken = 'muted'
    return { date: d.date, count: d.count, normalizedValue: normalized, colorToken }
  })

  return {
    graphId: `graph_${entityId}_activity_calendar`,
    graphType: 'activity_calendar',
    title,
    subtitle: opts.subtitle ?? null,
    colorToken: opts.colorToken ?? 'success',
    completeness: opts.completeness ?? 100,
    uncertainty: opts.uncertainty ?? [],
    derivation: opts.derivation ?? [`${days.length} days totalCount=${totalCount} → activity_calendar`],
    version: PRESENTATION_VERSION,
    days: calDays,
    earliestDate: sorted[0]?.date ?? null,
    latestDate: sorted[sorted.length - 1]?.date ?? null,
    maxCount,
    totalCount,
  }
}

// ── Benchmark radar for league ─────────────────────────────────────────────────

export function buildBenchmarkRadarGraph(
  leagueId: string,
  benchmark: {
    engagement: { percentile: number }
    retentionSafety: { percentile: number }
    tradeActivity: { percentile: number }
    waiverActivity: { percentile: number }
    commissionerEfficiency: { percentile: number }
  },
  options?: { completeness?: number; uncertainty?: string[] },
): RadarGraphModel {
  const dims: RadarDimension[] = [
    { dimensionId: 'engagement', label: 'Engagement', value: benchmark.engagement.percentile / 100, rawValue: `p${benchmark.engagement.percentile}`, colorToken: percentileToColorToken(benchmark.engagement.percentile) },
    { dimensionId: 'retention_safety', label: 'Retention Safety', value: benchmark.retentionSafety.percentile / 100, rawValue: `p${benchmark.retentionSafety.percentile}`, colorToken: percentileToColorToken(benchmark.retentionSafety.percentile) },
    { dimensionId: 'trade_activity', label: 'Trade Activity', value: benchmark.tradeActivity.percentile / 100, rawValue: `p${benchmark.tradeActivity.percentile}`, colorToken: percentileToColorToken(benchmark.tradeActivity.percentile) },
    { dimensionId: 'waiver_activity', label: 'Waiver Activity', value: benchmark.waiverActivity.percentile / 100, rawValue: `p${benchmark.waiverActivity.percentile}`, colorToken: percentileToColorToken(benchmark.waiverActivity.percentile) },
    { dimensionId: 'commissioner_efficiency', label: 'Commissioner Efficiency', value: benchmark.commissionerEfficiency.percentile / 100, rawValue: `p${benchmark.commissionerEfficiency.percentile}`, colorToken: percentileToColorToken(benchmark.commissionerEfficiency.percentile) },
  ]
  const benchmarkDims: RadarDimension[] = dims.map((d) => ({
    ...d,
    dimensionId: `bench_${d.dimensionId}`,
    value: 0.50,
    rawValue: 'p50',
    colorToken: 'neutral' as ColorToken,
  }))
  return buildRadarGraph(leagueId, dims, 'Platform Benchmark Profile', {
    subtitle: 'Percentile ranks vs. platform median (p50)',
    benchmarkDimensions: benchmarkDims,
    completeness: options?.completeness,
    uncertainty: options?.uncertainty,
    derivation: ['benchmark.engagement/retentionSafety/trade/waiver/commissionerEfficiency percentiles → radar'],
  })
}
