/**
 * Decision OS — Phase 7.0 Intelligence Presentation Model.
 *
 * The deterministic presentation layer between Decision Intelligence (Phase 6)
 * and every frontend surface.
 *
 * Architecture: Decision OS → Behavioral Intelligence → Decision Intelligence
 *               → Intelligence Presentation Model (this module)
 *               → Dashboard / Widget / Hosted API / SDK / White-label Platform
 */

// ── Version ───────────────────────────────────────────────────────────────────
export { PRESENTATION_VERSION } from './tokens'

// ── All types ─────────────────────────────────────────────────────────────────
export type {
  // Token types
  ColorToken,
  IconToken,
  SeverityToken,
  AnimationToken,
  SeverityDefinition,

  // Badge
  Badge,

  // Metric
  MetricPresentation,

  // Graph types
  GraphType,
  GraphModel,
  BarEntry,
  ReferenceLine,
  BarGraphModel,
  HorizontalBarEntry,
  HorizontalBarGraphModel,
  LinePoint,
  LineSeries,
  LineGraphModel,
  TrendGraphModel,
  SparklineGraphModel,
  DonutSegment,
  DonutGraphModel,
  GaugeThreshold,
  GaugeGraphModel,
  ProgressRingGraphModel,
  RadarDimension,
  RadarGraphModel,
  HeatmapCell,
  HeatmapGraphModel,
  TimelineEvent,
  TimelineGraphModel,
  HistogramBucket,
  DistributionHistogramGraphModel,
  ComparisonEntry,
  ComparisonChartGraphModel,
  RankingEntry,
  RankingTableGraphModel,
  WaterfallStep,
  WaterfallGraphModel,
  ActivityDay,
  ActivityCalendarGraphModel,

  // Card types
  CardType,
  CardModel,
  ScoreDeduction,
  HealthCard,
  RecommendationCard,
  InsightCard,
  RetentionCard,
  CommissionerCard,
  ManagerCard,
  DnaTrait,
  DnaCard,
  LeagueArchetypeCard,
  BenchmarkDimensionPresentation,
  PlatformBenchmarkCard,
  CompanyIntelligenceCard,

  // Recommendation presentation
  RecommendationDifficulty,
  RecommendationTimeEstimate,
  RecommendationCompletionStatus,
  RecommendationPresentation,
  RecommendationPresentationSet,

  // Widget types
  WidgetType,
  WidgetContract,
  CompactWidget,
  SidebarWidget,
  FullDashboardWidget,
  PopupWidget,
  CommissionerWidget,
  ManagerWidget,
  MobileWidget,
  PartnerWidget,
  WhiteLabelConfig,

  // API presentation
  ManagerApiPresentation,
  LeagueApiPresentation,
  PlatformApiPresentation,
  CompanyApiPresentation,

  // Top-level result types
  ManagerPresentationResult,
  LeaguePresentationResult,
  CommissionerPresentationResult,
  PlatformPresentationResult,
  CompanyPresentationResult,

  // Input slices (7.0-local structural mirrors)
  IpmEngagementDimension,
  IpmManagerInput,
  IpmLeagueInput,
  IpmPlatformInput,
  IpmCompanyInput,
} from './types'

// ── Token system ──────────────────────────────────────────────────────────────
export {
  SEVERITY_DEFINITIONS,
  severityDefinition,
  scoreToSeverity,
  percentileToSeverity,
  engagementTierToSeverity,
  retentionRiskToSeverity,
  workloadToSeverity,
  recommendationPriorityToSeverity,
  archetypeToSeverity,
  healthTierToSeverity,
  percentileToColorToken,
  archetypeToColorToken,
  identityToColorToken,
  retentionRiskToColorToken,
  scoreToColorToken,
  identityToIconToken,
  archetypeToIconToken,
  IDENTITY_DISPLAY_LABELS,
  IDENTITY_DESCRIPTIONS,
  ARCHETYPE_DISPLAY_LABELS,
  ARCHETYPE_DESCRIPTIONS,
} from './tokens'

// ── Badge system ──────────────────────────────────────────────────────────────
export {
  buildManagerBadges,
  buildLeagueBadges,
  buildCommissionerBadges,
  buildPlatformBadges,
} from './badges'

// ── Graph assemblers ──────────────────────────────────────────────────────────
export {
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
} from './graphs'

// ── Card assemblers ───────────────────────────────────────────────────────────
export {
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
} from './cards'

// ── Recommendation presentation ───────────────────────────────────────────────
export {
  buildRecommendationPresentation,
  buildRecommendationPresentations,
  buildRecommendationPresentationSet,
} from './recommendations'

// ── Widget assemblers ─────────────────────────────────────────────────────────
export {
  buildCompactWidget,
  buildSidebarWidget,
  buildFullDashboardWidget,
  buildPopupWidget,
  buildCommissionerWidget,
  buildManagerWidget,
  buildMobileWidget,
  buildPartnerWidget,
} from './widgets'

// ── API presentation ──────────────────────────────────────────────────────────
export {
  buildManagerApiPresentation,
  buildLeagueApiPresentation,
  buildPlatformApiPresentation,
  buildCompanyApiPresentation,
} from './api-presentation'

// ── White-label layer ─────────────────────────────────────────────────────────
export {
  WHITE_LABEL_CONFIGS,
  resolveColorToken,
  resolveIconToken,
  getWhiteLabelConfig,
  isSectionVisible,
} from './white-label'

// ── Widget contract foundation (Phase 7.3) ────────────────────────────────────
export { WIDGET_CONTRACT_VERSION } from './widget-contracts'
export type {
  WidgetMode,
  WidgetSection,
  WidgetApiEndpoint,
  WidgetBreakpoint,
  WidgetLayoutHints,
  WidgetPrivacyRestrictions,
  WidgetFeatureFlags,
  WidgetTenantConfig,
  WidgetConfig,
  WidgetApiCall,
  WidgetValidationResult,
  WidgetTelemetryEventType,
  WidgetTelemetryEvent,
  WidgetDegradedReason,
  WidgetDegradedState,
} from './widget-contracts'
export {
  validateWidgetConfig,
  mapWidgetModeToApiCall,
  resolveAllowedSections,
  filterSectionsByTier,
  resolveWidgetLayoutHints,
  resolveWidgetPrivacyRestrictions,
  buildWidgetDegradedState,
  buildWidgetTelemetryEvent,
} from './widget-contracts'
