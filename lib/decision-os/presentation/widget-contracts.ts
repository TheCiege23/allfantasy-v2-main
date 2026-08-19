/**
 * Decision OS — Phase 7.3 Widget Contract Foundation.
 *
 * Operational contract layer for embeddable widgets. Defines configuration schemas,
 * validation rules, API-call mapping, section filtering, telemetry events, layout
 * hints, privacy restrictions, and degraded states.
 *
 * Architecture position (PHASE_7_3_WIDGET_CONTRACT_ADR.md):
 *   Phase 7.2 API (?view=presentation)
 *       ↓
 *   Phase 7.3 Widget Contracts  ◄── this module
 *       ↓
 *   Phase 7.4 Widget Runtime SDK  [not built here]
 *
 * Constraints:
 *   - Pure functions only — no IO, no DB, no network, no side effects
 *   - No React, CSS, Tailwind, HTML, SVG, browser APIs, or UI framework imports
 *   - No internal Decision OS field names in outputs (no internal leakage)
 *   - Deterministic: same config → same validation result, same sections, same API call
 *   - API key NEVER surfaced in any output — tenantId obfuscated in telemetry
 *   - Additive only — zero changes to Phase 7.0 widget assemblers or types
 *
 * ADR: PHASE_7_3_WIDGET_CONTRACT_ADR.md
 */

import type { WidgetType } from './types'
import type { IntelligenceTier, IntelligenceApiScope } from '../behavioral/api/contracts'

// ── Version ───────────────────────────────────────────────────────────────────

export const WIDGET_CONTRACT_VERSION = '7.3.0' as const

// ── Widget mode (operational alias for WidgetType) ────────────────────────────

/**
 * Operational mode of a widget embed.
 * Identical values to WidgetType — aliased for clarity at the contract boundary.
 */
export type WidgetMode = WidgetType

// ── Widget sections ───────────────────────────────────────────────────────────

/**
 * Named sections a widget can render.
 * Each section maps to one or more IPM cards/cards/metrics from Phase 7.0.
 */
export type WidgetSection =
  | 'health_score'           // League/manager health score + progress bar
  | 'retention_card'         // Retention risk + at-risk manager list
  | 'commissioner_workload'  // Commissioner workload level + action items
  | 'recommendations'        // Recommendation cards (filtered by tier)
  | 'metrics_grid'           // KPI metric cards (engagement, retention, etc.)
  | 'archetype_label'        // League archetype classification badge
  | 'benchmark_comparison'   // Platform percentile ranks + radar graph
  | 'behavioral_patterns'    // Manager behavioral sequence signals
  | 'dna_identity'           // Manager identity archetype card
  | 'activity_heatmap'       // Platform-level activity heatmap
  | 'intervention_list'      // Platform intervention opportunities
  | 'company_intelligence'   // Company/licensee intelligence card
  | 'badges'                 // Entity badge chips
  | 'graphs'                 // Chart/graph models

// ── API endpoints ─────────────────────────────────────────────────────────────

export type WidgetApiEndpoint =
  | '/api/v1/intelligence/league'
  | '/api/v1/intelligence/manager'
  | '/api/v1/intelligence/platform'

// ── Layout hints ──────────────────────────────────────────────────────────────

export interface WidgetBreakpoint {
  widthPx: number
  layoutVariant: 'full' | 'compact' | 'minimal'
}

/**
 * Pixel-based responsive hints.
 * No CSS framework references — runtimes apply these to their own layout engine.
 */
export interface WidgetLayoutHints {
  minWidthPx: number
  maxWidthPx: number | null   // null = no upper constraint
  minHeightPx: number
  maxHeightPx: number | null  // null = no upper constraint (scrollable)
  scrollable: boolean
  aspectRatio: string | null  // e.g. '4:1', null = free
  breakpoints: WidgetBreakpoint[]
}

// ── Privacy restrictions ──────────────────────────────────────────────────────

/**
 * Per-mode privacy constraints.
 * Runtimes MUST enforce these before rendering.
 */
export interface WidgetPrivacyRestrictions {
  anonymizeManagerIds: boolean       // replace manager ids with hashed tokens
  anonymizeLeagueIds: boolean        // replace league ids with hashed tokens
  suppressAbsoluteEventCounts: boolean  // show rates/percentages, not raw counts
  requireConsentBanner: boolean      // show a consent banner before rendering
  maxEntitiesExposed: number | null  // null = unrestricted; numeric = hard cap
}

// ── Tenant configuration ──────────────────────────────────────────────────────

export interface WidgetFeatureFlags {
  enableBenchmarkComparison: boolean
  enableArchetypeLabel: boolean
  enableBehavioralPatterns: boolean
  enableCompanyIntelligence: boolean
}

/**
 * Operator-level tenant configuration.
 * apiKey is stored here but MUST NEVER be included in any output (logs, telemetry, etc.).
 * Use tenantId only for identification; hash it for telemetry.
 */
export interface WidgetTenantConfig {
  tenantId: string
  apiKey: string          // NEVER surfaced in outputs — validation strips this field
  allowedOrigins: string[]
  rateLimitPerMinute: number
  featureFlags: WidgetFeatureFlags
  whiteLabelPlatform: string | null  // e.g. 'sleeper', 'yahoo'; null = AllFantasy
}

// ── Widget configuration (the operational contract) ───────────────────────────

/**
 * Complete widget configuration. Validated by validateWidgetConfig() before use.
 */
export interface WidgetConfig {
  mode: WidgetMode
  entityId: string
  entityType: 'manager' | 'league' | 'platform' | 'company'
  tenantConfig: WidgetTenantConfig
  presentationVersion: string  // expected version, e.g. '7.0.0'
}

// ── API call spec ─────────────────────────────────────────────────────────────

/**
 * The API call required for this widget config.
 * Returned by mapWidgetModeToApiCall().
 */
export interface WidgetApiCall {
  endpoint: WidgetApiEndpoint
  queryParams: Record<string, string>
  requiredScopes: IntelligenceApiScope[]
  view: 'presentation'
}

// ── Validation result ─────────────────────────────────────────────────────────

/**
 * Result of validateWidgetConfig().
 * Note: apiKey is NEVER present in this output.
 */
export interface WidgetValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  resolvedMode: WidgetMode
  resolvedEntityType: 'manager' | 'league' | 'platform' | 'company'
  allowedSections: WidgetSection[]
  requiredScopes: IntelligenceApiScope[]
}

// ── Telemetry events ──────────────────────────────────────────────────────────

export type WidgetTelemetryEventType =
  | 'impression'
  | 'interaction'
  | 'error'
  | 'degraded'
  | 'upgrade_prompt'

/**
 * A single telemetry event emitted by a widget runtime.
 * tenantIdHash is a deterministic obfuscation of tenantConfig.tenantId —
 * never the raw tenantId, and never the apiKey.
 */
export interface WidgetTelemetryEvent {
  eventType: WidgetTelemetryEventType
  widgetId: string        // `widget_${entityId}_${mode}`
  widgetMode: WidgetMode
  entityType: 'manager' | 'league' | 'platform' | 'company'
  tenantIdHash: string    // deterministic hash of tenantId, not the raw value
  timestamp: string       // ISO 8601
  completeness: number    // 0-100
  sectionsRendered: WidgetSection[]
  contractVersion: string
  errorCode: string | null
  interactionTarget: string | null  // e.g. 'recommendations', 'health_score'
}

// ── Degraded state ────────────────────────────────────────────────────────────

export type WidgetDegradedReason =
  | 'insufficient_data'
  | 'unauthorized'
  | 'unavailable'
  | 'rate_limited'
  | 'config_invalid'
  | 'version_mismatch'

export interface WidgetDegradedState {
  isDegraded: boolean
  reason: WidgetDegradedReason | null
  fallbackMessage: string
  suggestedAction: string | null
  completeness: number
  retryable: boolean
}

// ═════════════════════════════════════════════════════════════════════════════
// Internal lookup tables (pure data — no functions)
// ═════════════════════════════════════════════════════════════════════════════

// Sections allowed per widget mode
const SECTION_MODE_MAP: Record<WidgetMode, readonly WidgetSection[]> = {
  compact: [
    'health_score',
    'badges',
  ],
  sidebar: [
    'health_score',
    'retention_card',
    'recommendations',
    'metrics_grid',
    'badges',
  ],
  full_dashboard: [
    'health_score',
    'retention_card',
    'commissioner_workload',
    'recommendations',
    'metrics_grid',
    'archetype_label',
    'benchmark_comparison',
    'behavioral_patterns',
    'dna_identity',
    'activity_heatmap',
    'intervention_list',
    'company_intelligence',
    'badges',
    'graphs',
  ],
  popup: [
    'health_score',
    'recommendations',
    'badges',
  ],
  commissioner: [
    'health_score',
    'retention_card',
    'commissioner_workload',
    'recommendations',
    'metrics_grid',
    'archetype_label',
    'badges',
    'graphs',
  ],
  manager: [
    'health_score',
    'recommendations',
    'metrics_grid',
    'behavioral_patterns',
    'dna_identity',
    'badges',
    'graphs',
  ],
  mobile: [
    'health_score',
    'recommendations',
    'badges',
  ],
  // partner: sections from the inner content widget (compact|sidebar|popup)
  partner: [
    'health_score',
    'retention_card',
    'recommendations',
    'metrics_grid',
    'badges',
  ],
}

// Minimum tier required to render a section.
// Using a Set of allowed tiers (not a single minimum) because commissioner and
// manager are peer tiers rather than a strict hierarchy.
const SECTION_ALLOWED_TIERS: Record<WidgetSection, ReadonlySet<IntelligenceTier>> = {
  health_score:          new Set<IntelligenceTier>(['basic', 'commissioner', 'manager', 'platform']),
  badges:                new Set<IntelligenceTier>(['basic', 'commissioner', 'manager', 'platform']),
  retention_card:        new Set<IntelligenceTier>(['commissioner', 'platform']),
  commissioner_workload: new Set<IntelligenceTier>(['commissioner', 'platform']),
  recommendations:       new Set<IntelligenceTier>(['commissioner', 'manager', 'platform']),
  metrics_grid:          new Set<IntelligenceTier>(['commissioner', 'manager', 'platform']),
  archetype_label:       new Set<IntelligenceTier>(['commissioner', 'platform']),
  graphs:                new Set<IntelligenceTier>(['commissioner', 'manager', 'platform']),
  behavioral_patterns:   new Set<IntelligenceTier>(['manager', 'platform']),
  dna_identity:          new Set<IntelligenceTier>(['manager', 'platform']),
  benchmark_comparison:  new Set<IntelligenceTier>(['platform']),
  activity_heatmap:      new Set<IntelligenceTier>(['platform']),
  intervention_list:     new Set<IntelligenceTier>(['platform']),
  company_intelligence:  new Set<IntelligenceTier>(['platform']),
}

// Layout hints per mode
const MODE_LAYOUT_HINTS: Record<WidgetMode, WidgetLayoutHints> = {
  compact: {
    minWidthPx: 120, maxWidthPx: 320,
    minHeightPx: 80, maxHeightPx: 200,
    scrollable: false,
    aspectRatio: '4:1',
    breakpoints: [
      { widthPx: 200, layoutVariant: 'minimal' },
      { widthPx: 280, layoutVariant: 'compact' },
      { widthPx: 320, layoutVariant: 'full' },
    ],
  },
  sidebar: {
    minWidthPx: 240, maxWidthPx: 360,
    minHeightPx: 400, maxHeightPx: null,
    scrollable: true,
    aspectRatio: null,
    breakpoints: [
      { widthPx: 280, layoutVariant: 'compact' },
      { widthPx: 360, layoutVariant: 'full' },
    ],
  },
  full_dashboard: {
    minWidthPx: 600, maxWidthPx: null,
    minHeightPx: 600, maxHeightPx: null,
    scrollable: true,
    aspectRatio: null,
    breakpoints: [
      { widthPx: 768, layoutVariant: 'compact' },
      { widthPx: 1024, layoutVariant: 'full' },
    ],
  },
  popup: {
    minWidthPx: 320, maxWidthPx: 480,
    minHeightPx: 400, maxHeightPx: 600,
    scrollable: false,
    aspectRatio: '4:6',
    breakpoints: [
      { widthPx: 360, layoutVariant: 'compact' },
      { widthPx: 480, layoutVariant: 'full' },
    ],
  },
  commissioner: {
    minWidthPx: 400, maxWidthPx: 800,
    minHeightPx: 600, maxHeightPx: null,
    scrollable: true,
    aspectRatio: null,
    breakpoints: [
      { widthPx: 600, layoutVariant: 'compact' },
      { widthPx: 800, layoutVariant: 'full' },
    ],
  },
  manager: {
    minWidthPx: 300, maxWidthPx: 600,
    minHeightPx: 500, maxHeightPx: null,
    scrollable: true,
    aspectRatio: null,
    breakpoints: [
      { widthPx: 420, layoutVariant: 'compact' },
      { widthPx: 600, layoutVariant: 'full' },
    ],
  },
  mobile: {
    minWidthPx: 320, maxWidthPx: 420,
    minHeightPx: 200, maxHeightPx: 400,
    scrollable: false,
    aspectRatio: null,
    breakpoints: [
      { widthPx: 375, layoutVariant: 'compact' },
      { widthPx: 420, layoutVariant: 'full' },
    ],
  },
  partner: {
    minWidthPx: 120, maxWidthPx: 480,
    minHeightPx: 80, maxHeightPx: 600,
    scrollable: false,
    aspectRatio: null,
    breakpoints: [
      { widthPx: 280, layoutVariant: 'compact' },
      { widthPx: 480, layoutVariant: 'full' },
    ],
  },
}

// Privacy restrictions per mode
const MODE_PRIVACY: Record<WidgetMode, WidgetPrivacyRestrictions> = {
  compact: {
    anonymizeManagerIds: true,
    anonymizeLeagueIds: false,
    suppressAbsoluteEventCounts: true,
    requireConsentBanner: false,
    maxEntitiesExposed: 1,
  },
  sidebar: {
    anonymizeManagerIds: true,
    anonymizeLeagueIds: false,
    suppressAbsoluteEventCounts: true,
    requireConsentBanner: false,
    maxEntitiesExposed: 5,
  },
  full_dashboard: {
    anonymizeManagerIds: false,
    anonymizeLeagueIds: false,
    suppressAbsoluteEventCounts: false,
    requireConsentBanner: false,
    maxEntitiesExposed: null,
  },
  popup: {
    anonymizeManagerIds: true,
    anonymizeLeagueIds: false,
    suppressAbsoluteEventCounts: true,
    requireConsentBanner: false,
    maxEntitiesExposed: 1,
  },
  commissioner: {
    anonymizeManagerIds: false,  // commissioner sees their own league
    anonymizeLeagueIds: false,
    suppressAbsoluteEventCounts: false,
    requireConsentBanner: false,
    maxEntitiesExposed: null,
  },
  manager: {
    anonymizeManagerIds: false,  // manager sees their own identity
    anonymizeLeagueIds: false,
    suppressAbsoluteEventCounts: false,
    requireConsentBanner: false,
    maxEntitiesExposed: 1,
  },
  mobile: {
    anonymizeManagerIds: true,
    anonymizeLeagueIds: false,
    suppressAbsoluteEventCounts: true,
    requireConsentBanner: false,
    maxEntitiesExposed: 1,
  },
  partner: {
    anonymizeManagerIds: true,
    anonymizeLeagueIds: true,   // third-party context: anonymize by default
    suppressAbsoluteEventCounts: true,
    requireConsentBanner: true,
    maxEntitiesExposed: 1,
  },
}

// Valid entity types per mode
const MODE_VALID_ENTITY_TYPES: Record<WidgetMode, ReadonlySet<string>> = {
  compact:        new Set(['manager', 'league', 'platform']),
  sidebar:        new Set(['league']),
  full_dashboard: new Set(['league', 'platform']),
  popup:          new Set(['league']),
  commissioner:   new Set(['league']),
  manager:        new Set(['manager']),
  mobile:         new Set(['league', 'manager']),
  partner:        new Set(['manager', 'league', 'platform']),
}

// Required scopes per mode (intersected with entity type)
const MODE_REQUIRED_SCOPES: Record<WidgetMode, IntelligenceApiScope[]> = {
  compact:        ['intelligence:platform:basic'],  // entity-type-dependent; basic is minimum
  sidebar:        ['intelligence:league:read'],
  full_dashboard: ['intelligence:league:read'],
  popup:          ['intelligence:league:read'],
  commissioner:   ['intelligence:league:read'],
  manager:        ['intelligence:manager:read'],
  mobile:         ['intelligence:platform:basic'],
  partner:        ['intelligence:platform:basic'],
}

// Degraded state messages (deterministic by reason)
const DEGRADED_MESSAGES: Record<WidgetDegradedReason, { fallback: string; action: string | null; retryable: boolean }> = {
  insufficient_data: {
    fallback:  'Intelligence data is not available yet.',
    action:    'Check back after the next scoring period.',
    retryable: true,
  },
  unauthorized: {
    fallback:  'Your API key does not have the required scope to render this widget.',
    action:    'Upgrade your intelligence tier or contact support.',
    retryable: false,
  },
  unavailable: {
    fallback:  'Intelligence service is temporarily unavailable.',
    action:    'Retry in a few minutes.',
    retryable: true,
  },
  rate_limited: {
    fallback:  'Request rate limit reached.',
    action:    'Reduce request frequency or upgrade your plan.',
    retryable: true,
  },
  config_invalid: {
    fallback:  'Widget configuration is invalid.',
    action:    'Review widget configuration and fix validation errors.',
    retryable: false,
  },
  version_mismatch: {
    fallback:  'Widget presentation contract version mismatch.',
    action:    'Update the widget to use a compatible presentation version.',
    retryable: false,
  },
}

// ═════════════════════════════════════════════════════════════════════════════
// Internal utilities (pure, not exported)
// ═════════════════════════════════════════════════════════════════════════════

function deriveScopeForConfig(config: WidgetConfig): IntelligenceApiScope[] {
  const base = MODE_REQUIRED_SCOPES[config.mode]
  // compact and mobile: entityType determines scope
  if (config.mode === 'compact' || config.mode === 'mobile') {
    if (config.entityType === 'manager') return ['intelligence:manager:read']
    if (config.entityType === 'platform') return ['intelligence:platform:basic']
    if (config.entityType === 'league') return ['intelligence:league:read']
  }
  if (config.mode === 'partner') {
    if (config.entityType === 'manager') return ['intelligence:manager:read']
    if (config.entityType === 'league') return ['intelligence:league:read']
  }
  return base
}

function deriveEndpoint(config: WidgetConfig): WidgetApiEndpoint {
  const { mode, entityType } = config
  if (mode === 'manager') return '/api/v1/intelligence/manager'
  if (mode === 'compact' || mode === 'mobile' || mode === 'partner') {
    if (entityType === 'manager') return '/api/v1/intelligence/manager'
    if (entityType === 'platform') return '/api/v1/intelligence/platform'
    return '/api/v1/intelligence/league'
  }
  if (mode === 'full_dashboard' && entityType === 'platform') return '/api/v1/intelligence/platform'
  return '/api/v1/intelligence/league'
}

function deriveQueryParams(config: WidgetConfig): Record<string, string> {
  const { mode, entityId, entityType } = config
  const params: Record<string, string> = { view: 'presentation' }
  if (mode === 'manager' || (entityType === 'manager' && (mode === 'compact' || mode === 'mobile' || mode === 'partner'))) {
    params['managerId'] = entityId
    // leagueId is required by the manager endpoint — use entityId as placeholder if not available
    // Runtime MUST supply leagueId separately
  } else if (entityType !== 'platform' && mode !== 'full_dashboard') {
    params['leagueId'] = entityId
  } else if (entityType === 'platform') {
    // Platform endpoint has no required query params
  } else {
    params['leagueId'] = entityId
  }
  return params
}

/**
 * Deterministic obfuscation of a tenant ID for telemetry output.
 * NOT cryptographic — purely for preventing accidental logging of raw tenant IDs.
 */
function obfuscateTenantId(tenantId: string): string {
  let h = 2166136261
  for (let i = 0; i < tenantId.length; i++) {
    h ^= tenantId.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return `t_${h.toString(16).padStart(8, '0')}`
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Validates a widget configuration.
 *
 * Returns errors when the config is structurally invalid (missing fields,
 * incompatible mode/entityType combos, empty tenant IDs).
 * Returns warnings for non-fatal configuration concerns.
 *
 * NOTE: apiKey is never present in the output.
 */
export function validateWidgetConfig(config: WidgetConfig): WidgetValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!config.entityId || config.entityId.trim() === '') {
    errors.push('entityId is required')
  }
  if (!config.tenantConfig.tenantId || config.tenantConfig.tenantId.trim() === '') {
    errors.push('tenantConfig.tenantId is required')
  }
  if (!config.tenantConfig.apiKey || config.tenantConfig.apiKey.trim() === '') {
    errors.push('tenantConfig.apiKey is required')
  }
  if (config.tenantConfig.rateLimitPerMinute < 1) {
    errors.push('tenantConfig.rateLimitPerMinute must be >= 1')
  }

  const validModes: WidgetMode[] = ['compact', 'sidebar', 'full_dashboard', 'popup', 'commissioner', 'manager', 'mobile', 'partner']
  if (!validModes.includes(config.mode)) {
    errors.push(`mode '${config.mode}' is not a valid widget mode`)
  }

  const allowedEntityTypes = MODE_VALID_ENTITY_TYPES[config.mode]
  if (allowedEntityTypes && !allowedEntityTypes.has(config.entityType)) {
    errors.push(`entityType '${config.entityType}' is not valid for mode '${config.mode}' (allowed: ${[...allowedEntityTypes].join(', ')})`)
  }

  if (config.mode === 'partner' && !config.tenantConfig.whiteLabelPlatform) {
    warnings.push('partner mode without whiteLabelPlatform will use AllFantasy default branding')
  }

  if (config.presentationVersion && config.presentationVersion !== '7.0.0') {
    warnings.push(`presentationVersion '${config.presentationVersion}' differs from current '7.0.0'`)
  }

  const allowedSections = resolveAllowedSections(config.mode, config.entityType)
  const requiredScopes = deriveScopeForConfig(config)

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    resolvedMode: config.mode,
    resolvedEntityType: config.entityType,
    allowedSections,
    requiredScopes,
  }
}

/**
 * Maps a widget config to the exact API call needed to fetch its presentation data.
 *
 * Returns null when the config is invalid (call validateWidgetConfig first).
 * The returned queryParams include all required params the widget contract can
 * determine deterministically; runtimes may need to supplement (e.g. managerId
 * for manager-entity compact widgets requires the manager's ID at render time).
 */
export function mapWidgetModeToApiCall(config: WidgetConfig): WidgetApiCall | null {
  const validation = validateWidgetConfig(config)
  if (!validation.valid) return null

  const endpoint = deriveEndpoint(config)
  const queryParams = deriveQueryParams(config)
  const requiredScopes = deriveScopeForConfig(config)

  return {
    endpoint,
    queryParams,
    requiredScopes,
    view: 'presentation',
  }
}

/**
 * Returns the ordered list of sections a given widget mode can render.
 *
 * entityType is used to resolve ambiguous modes (compact, mobile, partner).
 * Returns a stable, deterministic array ordered by visual priority.
 */
export function resolveAllowedSections(
  mode: WidgetMode,
  entityType?: string,
): WidgetSection[] {
  const base = [...SECTION_MODE_MAP[mode]]

  // Partner mode inherits sections from its inner content type.
  // compact/mobile sections vary by entityType — compact with platform has no retention_card.
  if (entityType === 'platform' && (mode === 'compact' || mode === 'mobile')) {
    return base.filter(s => s !== 'retention_card')
  }

  return base
}

/**
 * Filters an ordered section list to sections allowed for the given tier.
 *
 * Call after resolveAllowedSections() to apply tenant/API-key tier constraints.
 * Returns a stable, deterministic array (preserves input order).
 */
export function filterSectionsByTier(
  sections: WidgetSection[],
  tier: IntelligenceTier,
): WidgetSection[] {
  return sections.filter(s => SECTION_ALLOWED_TIERS[s].has(tier))
}

/**
 * Returns the layout hints for a given widget mode.
 * Pure — no config state needed.
 */
export function resolveWidgetLayoutHints(mode: WidgetMode): WidgetLayoutHints {
  return MODE_LAYOUT_HINTS[mode]
}

/**
 * Returns the privacy restrictions for a given widget mode.
 * Pure — no config state needed.
 */
export function resolveWidgetPrivacyRestrictions(mode: WidgetMode): WidgetPrivacyRestrictions {
  return MODE_PRIVACY[mode]
}

/**
 * Builds a degraded state object for the given reason and completeness score.
 *
 * Runtimes render this when intelligence data is unavailable, incomplete, or
 * when the widget config is invalid. Always isDegraded=true except for the
 * null reason sentinel (used only as a typed empty state for runtime DX).
 */
export function buildWidgetDegradedState(
  reason: WidgetDegradedReason,
  completeness: number,
): WidgetDegradedState {
  const spec = DEGRADED_MESSAGES[reason]
  return {
    isDegraded: true,
    reason,
    fallbackMessage: spec.fallback,
    suggestedAction: spec.action,
    completeness: Math.max(0, Math.min(100, completeness)),
    retryable: spec.retryable,
  }
}

/**
 * Builds a telemetry event for a widget.
 *
 * tenantIdHash is a deterministic obfuscation of tenantId — never the raw value.
 * apiKey is never included.
 * timestamp defaults to current ISO 8601 if not supplied.
 */
export function buildWidgetTelemetryEvent(
  config: WidgetConfig,
  eventType: WidgetTelemetryEventType,
  opts: {
    sectionsRendered?: WidgetSection[]
    completeness?: number
    errorCode?: string
    interactionTarget?: string
    timestamp?: string
  } = {},
): WidgetTelemetryEvent {
  const widgetId = `widget_${config.entityId}_${config.mode}`
  const tenantIdHash = obfuscateTenantId(config.tenantConfig.tenantId)

  return {
    eventType,
    widgetId,
    widgetMode: config.mode,
    entityType: config.entityType,
    tenantIdHash,
    timestamp: opts.timestamp ?? new Date().toISOString(),
    completeness: Math.max(0, Math.min(100, opts.completeness ?? 0)),
    sectionsRendered: opts.sectionsRendered ?? [],
    contractVersion: WIDGET_CONTRACT_VERSION,
    errorCode: opts.errorCode ?? null,
    interactionTarget: opts.interactionTarget ?? null,
  }
}
