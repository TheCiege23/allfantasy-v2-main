/**
 * @allfantasy/sdk-contracts — Phase 7.23 package scaffolding.
 *
 * The dependency-graph ROOT package (PHASE_7_22_SDK_PACKAGING_ADR.md D2):
 * zero `@allfantasy` dependencies, consumed by every other widget-*
 * package. This file is a CURATED re-export, not a blind mirror of any
 * single existing barrel — its source of truth stays exactly where the
 * Architecture Freeze already governs it (`lib/decision-os/sdk/`,
 * `lib/decision-os/presentation/`); nothing is copied or moved, only
 * selectively re-exported.
 *
 * Two source trees, two different curation rules:
 *
 *   1. `lib/decision-os/sdk/*` — re-exported IN FULL (types + values),
 *      exactly as PHASE_7_22_SDK_PACKAGING_PLAN.md §2 already specified.
 *      This layer was purpose-built (Phase 7.4/7.19/7.20) as the
 *      client-consumable contract + pure-validator layer — its VALUE
 *      exports (validateSDKAuth, resolveSDKTheme, buildSDKError, …) are
 *      genuinely useful for a partner's own client-side pre-validation,
 *      not internal-only.
 *
 *   2. `lib/decision-os/presentation/*` — TYPES ONLY, and only the
 *      WIRE-SAFE subset. Included: every graph/card/badge/recommendation/
 *      widget/API-presentation TYPE (these are exactly what a partner's
 *      TypeScript code needs to type a `/api/v1/intelligence/*` response
 *      body) plus the Phase 7.3 widget-contract operational functions
 *      (`validateWidgetConfig`, `mapWidgetModeToApiCall`, …) which
 *      `sdk-runtime/react` etc. already call client-side, so a partner
 *      building a CUSTOM integration (not using any `sdk-runtime/*`
 *      package) needs them too.
 *
 *      Deliberately EXCLUDED, by rule, not oversight:
 *        - `IpmEngagementDimension`, `IpmManagerInput`, `IpmLeagueInput`,
 *          `IpmPlatformInput`, `IpmCompanyInput` — the presentation
 *          layer's own doc comment calls these "7.0-local structural
 *          mirrors" of Phase 6 behavioral intelligence; they are BUILDER
 *          INPUT shapes, the closest thing to "Phase 5/6 raw
 *          intelligence" that lives inside `presentation/` at all. A
 *          partner never constructs one of these — they only ever
 *          RECEIVE an already-built `LeagueApiPresentation` etc.
 *        - Every `build*` function (badges, graphs, cards,
 *          recommendations, widgets, api-presentation) — these assemble
 *          presentation objects SERVER-SIDE inside AllFantasy's own
 *          Intelligence API handlers; a partner receives their already-
 *          assembled JSON over HTTP, they never call these themselves.
 *        - The token-resolution value layer (`scoreToSeverity`,
 *          `percentileToColorToken`, `IDENTITY_DISPLAY_LABELS`, …) — same
 *          reasoning, internal-assembly-only.
 *        - `WHITE_LABEL_CONFIGS`, `resolveColorToken`, `resolveIconToken`,
 *          `getWhiteLabelConfig`, `isSectionVisible` — the Phase 7.0
 *          white-label VALUE layer hardcodes real platform names
 *          (`sleeper`, `yahoo`, `espn`, …) as config keys. "No
 *          provider-specific logic" (this ticket's own rule) forbids
 *          shipping that in a public contracts package. The `WhiteLabelConfig`
 *          TYPE itself carries no provider names (just a generic shape)
 *          and IS included — a partner may want to type their own
 *          custom branding config against it.
 *
 *   3. `sdk-runtime/*` shared types are NOT re-exported here. Every
 *      `sdk-runtime/*` package DEPENDS ON `sdk-contracts` (D2); pulling
 *      `sdk-runtime` types back into `sdk-contracts` would invert that
 *      graph. Not approved by PHASE_7_22_SDK_PACKAGING_ADR.md (which
 *      never proposes it) — explicitly declined here, not merely omitted.
 */

// ═════════════════════════════════════════════════════════════════════════════
// lib/decision-os/sdk/* — full re-export (types + values)
// ═════════════════════════════════════════════════════════════════════════════

export { SDK_VERSION } from '../../../lib/decision-os/sdk/types'
export type {
  SDKVersion,
  SDKSupportedLocale,
  SDKLocale,
  SDKThemeMode,
  SDKThemeTokens,
  SDKTheme,
  SDKAuthMethod,
  SDKAuth,
  SDKEmbedTarget,
  SDKEmbedCapabilities,
  SDKRefreshTrigger,
  SDKRefreshStrategyConfig,
  SDKCapabilities,
  SDKLifecycleState,
  SDKConfig,
  SDKWidgetInstance,
  SDKTelemetryEventType,
  SDKEvent,
  SDKTelemetry,
  SDKErrorCode,
  SDKError,
  SDKCallbacks,
  SDKExtensionPoint,
  SDKLicenseTier,
  SDKEnterpriseExtension,
} from '../../../lib/decision-os/sdk/types'

export {
  LIFECYCLE_TRANSITIONS,
  ALL_LIFECYCLE_STATES,
  TERMINAL_LIFECYCLE_STATES,
  isValidLifecycleTransition,
  nextLifecycleStates,
  isTerminalLifecycleState,
  validateLifecycleSequence,
} from '../../../lib/decision-os/sdk/lifecycle'

export { VALID_THEME_MODES, resolveSDKTheme, validateSDKTheme } from '../../../lib/decision-os/sdk/theme'

export { AUTH_METHOD_REQUIREMENTS, ALL_AUTH_METHODS, validateSDKAuth, isPublicAuthMethod } from '../../../lib/decision-os/sdk/auth'
export type { SDKAuthValidationResult } from '../../../lib/decision-os/sdk/auth'

export { EMBED_CAPABILITIES, ALL_EMBED_TARGETS, getEmbedCapabilities, isFullyIsolatedEmbed } from '../../../lib/decision-os/sdk/embed'

export {
  ALL_SDK_EVENT_TYPES,
  obfuscateTenantIdForTelemetry,
  buildSDKEvent,
  validateEventSequence,
} from '../../../lib/decision-os/sdk/events'
export type { EventSequenceValidationResult } from '../../../lib/decision-os/sdk/events'

export { SDK_ERROR_SPECS, ALL_SDK_ERROR_CODES, buildSDKError, isRetryableErrorCode } from '../../../lib/decision-os/sdk/errors'

export {
  REFRESH_DEFAULTS,
  ALL_REFRESH_TRIGGERS,
  resolveRefreshStrategy,
  validateRefreshStrategy,
} from '../../../lib/decision-os/sdk/refresh'
export type { RefreshValidationResult } from '../../../lib/decision-os/sdk/refresh'

export {
  INTERNAL_FIELD_DENYLIST,
  INTERNAL_TERMINOLOGY_DENYLIST,
  stripInternalFields,
  findInternalLeakage,
  hasInternalLeakage,
} from '../../../lib/decision-os/sdk/privacy'

export { validateSDKConfig, EXTENSION_POINT_MIN_TIER, isExtensionPointAllowed, buildEnterpriseExtension } from '../../../lib/decision-os/sdk/config'
export type { SDKConfigValidationResult } from '../../../lib/decision-os/sdk/config'

export { PARTNER_ONBOARDING_VERSION, ALL_PARTNER_STATUSES } from '../../../lib/decision-os/sdk/partner-types'
export type {
  PartnerStatus,
  PartnerProfile,
  PartnerAllowedOrigins,
  PartnerApiKeyEnvironment,
  PartnerApiKeyStatus,
  PartnerApiKeyMetadata,
  PartnerEmbedPermissions,
  PartnerPrivacyPreferences,
  PartnerBrandingConfig,
  PartnerTenantConfig,
} from '../../../lib/decision-os/sdk/partner-types'

export {
  ALL_LICENSE_TIERS,
  isValidPartnerOriginFormat,
  isValidApiKeyPrefixFormat,
  validatePartnerProfile,
  validateApiKeyMetadata,
  validatePartnerTenantConfig,
} from '../../../lib/decision-os/sdk/partner-validation'
export type { PartnerValidationResult } from '../../../lib/decision-os/sdk/partner-validation'

export {
  WIDGET_MODE_MIN_TIER,
  isWidgetModeAllowedForTier,
  isWidgetModeAllowedForPartner,
  isEmbedTargetAllowedForPartner,
  resolveDefaultWidgetCatalog,
  RATE_LIMIT_PER_MINUTE_BY_TIER,
  resolveRateLimitPerMinute,
  resolveEffectivePartnerPrivacySettings,
} from '../../../lib/decision-os/sdk/partner-permissions'

export { normalizePartnerBranding } from '../../../lib/decision-os/sdk/partner-theme'
export type { PartnerThemeNormalizationResult } from '../../../lib/decision-os/sdk/partner-theme'

export { SANDBOX_PARTNER_TENANT_CONFIG, ENTERPRISE_PARTNER_TENANT_CONFIG } from '../../../lib/decision-os/sdk/partner-fixtures'

// Note: lib/decision-os/sdk/partner-sandbox-handlers.ts (Phase 7.20) is
// deliberately NOT re-exported — it is server-side HTTP handler business
// logic, not a contract.

// ═════════════════════════════════════════════════════════════════════════════
// lib/decision-os/presentation/* — curated, WIRE-SAFE subset (types + a few
// operational values). See the file header above for the exact inclusion/
// exclusion rule.
// ═════════════════════════════════════════════════════════════════════════════

export { PRESENTATION_VERSION } from '../../../lib/decision-os/presentation/tokens'

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

  // API presentation (the wire shapes a partner's fetch() response actually is)
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
} from '../../../lib/decision-os/presentation/types'

// Deliberately NOT re-exported from './types': IpmEngagementDimension,
// IpmManagerInput, IpmLeagueInput, IpmPlatformInput, IpmCompanyInput — see
// the file header.

export { WIDGET_CONTRACT_VERSION } from '../../../lib/decision-os/presentation/widget-contracts'
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
} from '../../../lib/decision-os/presentation/widget-contracts'
export {
  validateWidgetConfig,
  mapWidgetModeToApiCall,
  resolveAllowedSections,
  filterSectionsByTier,
  resolveWidgetLayoutHints,
  resolveWidgetPrivacyRestrictions,
  buildWidgetDegradedState,
  buildWidgetTelemetryEvent,
} from '../../../lib/decision-os/presentation/widget-contracts'

// Deliberately NOT re-exported from anywhere in presentation/: any build*
// assembler (badges.ts, graphs.ts, cards.ts, recommendations.ts,
// widgets.ts, api-presentation.ts), the token-resolution value layer
// (tokens.ts's scoreToSeverity/percentileToColorToken/etc.), and the
// white-label VALUE layer (white-label.ts's WHITE_LABEL_CONFIGS/
// resolveColorToken/resolveIconToken/getWhiteLabelConfig/isSectionVisible
// — hardcodes real platform names, forbidden by "no provider-specific
// logic"). See the file header for the full rationale.
