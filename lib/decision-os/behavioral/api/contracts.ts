/**
 * Decision OS — Phase 5.5 Intelligence API Boundary Contracts (v1).
 *
 * These are the EXTERNAL types for the hosted Intelligence API.
 * They deliberately do NOT re-export internal types — the public surface is
 * a curated subset designed to expose capabilities, not implementation detail.
 *
 * Versioning: All public types carry a V1 suffix. Breaking changes require a
 * V2 file; additive non-breaking additions are added here directly.
 *
 * Architecture constraints:
 *   - No import from internal Decision OS types (self-contained external contract)
 *   - No runtime logic — types only
 *   - No internal warnings[], derivedFrom, lookbackDays, or provenance leaked
 *   - managerId in responses is always the caller's own tenant-scoped ID
 *   - Heatmap values are always UTC (documented in type comments)
 *
 * ADR: ADR_F5_5_INTELLIGENCE_API_BOUNDARY.md
 */

// ── Auth + Tenant ─────────────────────────────────────────────────────────────

/**
 * Named scopes carried by an API key.
 * Scopes are additive — a key may carry any combination.
 */
export type IntelligenceApiScope =
  | 'intelligence:platform:basic'   // Platform summary (aggregate only)
  | 'intelligence:platform:full'    // Full Platform Intelligence
  | 'intelligence:league:read'      // League Intelligence per league
  | 'intelligence:manager:read'     // Manager Intelligence per manager

/**
 * Friendly tier name that maps to a scope set.
 * Used in API key metadata and response meta for client clarity.
 */
export type IntelligenceTier = 'basic' | 'commissioner' | 'manager' | 'platform'

/** Scope sets by tier (documentation mapping — authoritative list is IntelligenceApiScope). */
export const TIER_SCOPE_MAP: Record<IntelligenceTier, IntelligenceApiScope[]> = {
  basic:         ['intelligence:platform:basic'],
  commissioner:  ['intelligence:platform:basic', 'intelligence:league:read'],
  manager:       ['intelligence:platform:basic', 'intelligence:manager:read'],
  platform:      [
    'intelligence:platform:basic',
    'intelligence:platform:full',
    'intelligence:league:read',
    'intelligence:manager:read',
  ],
}

/**
 * Metadata associated with a resolved API key.
 * Never returned to the caller — used internally by the future API route handler.
 */
export interface IntelligenceApiKeyMetadata {
  /** Opaque tenant identifier — never exposed to callers. */
  tenantId:      string
  /** Scopes this key carries. */
  scopes:        IntelligenceApiScope[]
  /** Friendly tier for display in dashboards. */
  tier:          IntelligenceTier
  /**
   * League IDs this key is authorized to query.
   * Null means unrestricted within the tenant (all leagues the tenant owns).
   */
  allowedLeagueIds: string[] | null
  /** Requests per hour allowed under this key. */
  rateLimitPerHour: number
  /** ISO 8601 expiry. Null = does not expire. */
  expiresAt:     string | null
}

// ── Common Response Envelope ──────────────────────────────────────────────────

/**
 * Standard metadata block present in every successful API response.
 */
export interface IntelligenceApiMeta {
  /** UUID generated per-request for distributed tracing. */
  requestId:    string
  /** ISO 8601 timestamp when the intelligence was last derived. */
  derivedAt:    string
  /** Data quality score for the returned intelligence (0–100). Low values mean degraded signals. */
  completeness: number
  /** API version in use. */
  version:      'v1'
  /** The effective tier at which this response was served. */
  tier:         IntelligenceTier
}

/**
 * Standard success envelope wrapping all Intelligence API responses.
 */
export interface IntelligenceApiResponse<T> {
  data: T
  meta: IntelligenceApiMeta
}

// ── Error envelope ────────────────────────────────────────────────────────────

export type IntelligenceApiErrorCode =
  | 'UNAUTHORIZED'             // missing or invalid API key
  | 'FORBIDDEN'                // valid key but insufficient scope for this endpoint
  | 'LEAGUE_NOT_IN_TENANT'     // leagueId not owned by this tenant
  | 'MANAGER_NOT_IN_TENANT'    // managerId not owned by this tenant
  | 'NOT_FOUND'                // leagueId or managerId does not exist
  | 'RATE_LIMIT_EXCEEDED'      // too many requests; Retry-After header set
  | 'INTELLIGENCE_UNAVAILABLE' // internal derivation failed; try again
  | 'INVALID_REQUEST'          // malformed request parameters
  | 'DEPRECATED_VERSION'       // endpoint version has passed its Sunset date

export interface IntelligenceApiError {
  code:      IntelligenceApiErrorCode
  message:   string
  requestId: string
  /** Set for RATE_LIMIT_EXCEEDED — seconds until the window resets. */
  retryAfter?: number
  /** Set for DEPRECATED_VERSION — URL of migration guide. */
  migrationUrl?: string
}

// ── Rate limit headers ────────────────────────────────────────────────────────

/**
 * Rate-limit response headers returned on every request.
 * Mirrors GitHub's X-RateLimit-* convention.
 */
export interface IntelligenceRateLimitHeaders {
  'X-RateLimit-Limit':     number  // requests allowed per window
  'X-RateLimit-Remaining': number  // requests left in current window
  'X-RateLimit-Reset':     number  // Unix epoch when window resets
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT 1: Manager Intelligence
// GET /v1/intelligence/managers/{managerId}?leagueId={leagueId}
// Required scope: intelligence:manager:read
// ─────────────────────────────────────────────────────────────────────────────

export interface ManagerIntelligenceRequest {
  /** Must belong to the caller's tenant. */
  managerId: string
  /** Context league — required; manager intelligence is league-scoped. */
  leagueId:  string
}

/**
 * Per-dimension engagement visible externally.
 * Raw event counts and internal dimension warnings are omitted.
 */
export interface ManagerEngagementDimensionsV1 {
  lineup: ManagerEngagementDimensionSummaryV1
  waiver: ManagerEngagementDimensionSummaryV1
  trade:  ManagerEngagementDimensionSummaryV1
  draft:  ManagerEngagementDimensionSummaryV1
}

export interface ManagerEngagementDimensionSummaryV1 {
  /** Engagement score for this dimension (0–100). */
  score: number
  /** Qualitative level. */
  level: 'high' | 'moderate' | 'low' | 'none'
}

/**
 * A commissioner nudge visible in the external API.
 * `signal` (machine-readable trigger) and `supportingEventIds` (internal) are omitted.
 */
export interface ManagerNudgeV1 {
  nudgeId:  string
  priority: 'critical' | 'high' | 'medium' | 'low'
  category: 'engagement' | 'roster' | 'transaction' | 'retention'
  /** Customer-facing message. Contains no internal terminology. */
  message:  string
}

/**
 * Manager Intelligence API response (v1).
 *
 * Field selection rationale:
 * - `retentionRiskReasons` included: customer-facing strings, actionable for commissioners.
 * - `engagementDimensions` included without event counts (counts = internal implementation detail).
 * - `nudges` included without `signal` / `supportingEventIds` (internal routing detail).
 * - `inactivityWarning`, `derivedFrom`, `lookbackDays`, `warnings` excluded: internal.
 */
export interface ManagerIntelligenceV1 {
  managerId:  string
  leagueId:   string

  // ── Engagement tier & risk ──────────────────────────────────────────────
  participationTier:      'elite' | 'active' | 'moderate' | 'passive' | 'inactive'
  retentionRisk:          'low' | 'medium' | 'high' | 'critical' | 'insufficient_data'
  /** Human-readable reasons driving the retention risk level. */
  retentionRiskReasons:   string[]

  // ── Composite score ─────────────────────────────────────────────────────
  /** Weighted composite engagement score (0–100). */
  overallEngagementScore: number

  // ── Per-dimension engagement ────────────────────────────────────────────
  engagementDimensions:   ManagerEngagementDimensionsV1

  // ── Inactivity ──────────────────────────────────────────────────────────
  /** Days since the most recent recorded action. Null when no events exist. */
  daysSinceLastActivity:  number | null
  /** True when inactive > 14 days or no events have ever been recorded. */
  isInactive:             boolean

  // ── Commissioner nudges ─────────────────────────────────────────────────
  /** Prioritised action list for the commissioner (critical first). */
  nudges:                 ManagerNudgeV1[]

  // ── Data quality ────────────────────────────────────────────────────────
  /** Data quality score for this manager's intelligence (0–100). */
  completeness:           number
  /** ISO 8601 when this intelligence was derived. */
  derivedAt:              string
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT 2: League Intelligence
// GET /v1/intelligence/leagues/{leagueId}
// Required scope: intelligence:league:read
// ─────────────────────────────────────────────────────────────────────────────

export interface LeagueIntelligenceRequest {
  /** Must belong to the caller's tenant. */
  leagueId: string
}

/**
 * Activity dimension in the external API.
 * Raw `count` is omitted (internal); `perManagerRate` is the meaningful signal.
 */
export interface LeagueActivityDimensionV1 {
  /** Overall tier derived from per-manager rate. */
  tier:           'high' | 'moderate' | 'low' | 'none'
  /** Events per manager in the lookback window. */
  perManagerRate: number
}

/**
 * Commissioner recommendation in the external API.
 * `signal` (machine-readable trigger key) is omitted — callers use `recommendationId`
 * to identify action types in their own systems.
 */
export interface LeagueRecommendationV1 {
  recommendationId: string
  priority:         'critical' | 'high' | 'medium' | 'low'
  category:         'retention' | 'engagement' | 'activity' | 'moderation'
  /** Customer-facing action guidance. No internal terminology. */
  message:          string
}

/**
 * Phase 3.3 — the "future AI layer" fields this file's own original comment
 * anticipated exposing later. Already computed by `deriveLeagueBehavioralIntelligence`
 * (`LeagueHealthNarrativeInputs`); this is a straight pass-through of those same
 * 3 structured fields, not a new derivation. Structured on purpose (3 typed
 * fields, not one freeform paragraph) rather than presentation-ready text —
 * matching how the rest of this API separates facts from presentation.
 */
export interface LeagueHealthNarrativeV1 {
  /** Structured summary of manager participation. */
  engagementSummary: string
  /** Most urgent signal for the commissioner to address. Null when no concerns. */
  topConcern: string | null
  /** Most positive signal to highlight. Null when no standout signals. */
  standoutSignal: string | null
}

/**
 * League Intelligence API response (v1).
 *
 * Field selection rationale:
 * - `healthNarrative` (Phase 3.3, additive): the `healthNarrativeInputs` this file's
 *   own comment originally flagged as "for future AI layer" — now exposed.
 * - `commissionerWorkloadItems` excluded: internal implementation strings.
 * - `retentionRiskReasons` excluded: internal; callers receive `retentionRisk` tier only.
 * - `tradeActivity.count` excluded: raw counts without context invite misuse.
 * - `warnings`, `derivedFrom`, `lookbackDays`, `managerCount` excluded: internal.
 */
export interface LeagueIntelligenceV1 {
  leagueId: string

  // ── Engagement ──────────────────────────────────────────────────────────
  leagueEngagementScore: number  // 0-100
  leagueEngagementTier:  'elite' | 'active' | 'moderate' | 'passive' | 'dormant'

  // ── Manager participation ───────────────────────────────────────────────
  participationDistribution: {
    totalManagers:    number
    activeManagers:   number
    inactiveManagers: number
    /** Percent of managers who are active (0–100). */
    activePercent:    number
    /** Percent of managers who are inactive (0–100). */
    inactivePercent:  number
  }

  // ── Activity dimensions ─────────────────────────────────────────────────
  tradeActivity:  LeagueActivityDimensionV1
  waiverActivity: LeagueActivityDimensionV1
  draftActivity:  LeagueActivityDimensionV1

  // ── Risk & workload ─────────────────────────────────────────────────────
  retentionRisk:        'low' | 'medium' | 'high' | 'critical' | 'insufficient_data'
  commissionerWorkload: 'light' | 'moderate' | 'heavy' | 'critical'

  // ── Recommendations ─────────────────────────────────────────────────────
  recommendations: LeagueRecommendationV1[]

  // ── Narrative driver signals (Phase 3.3, additive) ──────────────────────
  healthNarrative: LeagueHealthNarrativeV1

  // ── Data quality ────────────────────────────────────────────────────────
  completeness: number
  derivedAt:    string
}

/**
 * Phase 3.3 — public manager listing (`GET /v1/intelligence/league/managers`).
 * Deliberately lighter than `ManagerIntelligenceV1` (the single-manager
 * endpoint): this is a list payload for an overview/highlights use case,
 * not a per-manager deep dive, so per-dimension engagement breakdowns and
 * nudges are left to the single-manager endpoint. No `managerName` —
 * Decision OS's behavioral layer is deliberately identity-light (keyed by
 * an opaque `managerId` only, consistent with `ManagerBehavioralIntelligence`
 * everywhere else in this API); resolving a display name is the caller's
 * own concern (e.g. via whatever roster/user store it already has).
 */
export interface ManagerSummaryV1 {
  managerId:              string
  participationTier:      'elite' | 'active' | 'moderate' | 'passive' | 'inactive'
  retentionRisk:          'low' | 'medium' | 'high' | 'critical' | 'insufficient_data'
  retentionRiskReasons:   string[]
  overallEngagementScore: number
  daysSinceLastActivity:  number | null
  isInactive:             boolean
  inactivityWarning:      string | null
  completeness:           number
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT 5: League Trend (Phase 3.3)
// GET /v1/intelligence/league/trend
// Required scope: intelligence:league:read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Real comparison between the 2 most recent `intelligence_league_snapshot_history`
 * rows. `available: false` is the honest, expected state until a league has
 * accumulated at least 2 captures — never fabricated.
 */
export type LeagueTrendV1 =
  | {
      available: true
      direction: 'up' | 'down' | 'flat'
      magnitude: number
      scoreDelta: number
      previousScore: number
      currentScore: number
      capturedAt: string
      comparedToCapturedAt: string
    }
  | {
      available: false
      reason: 'insufficient_historical_data'
      snapshotCount: number
    }

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT 6: League Deadlines (Phase 3.3)
// GET /v1/intelligence/league/deadlines
// Required scope: intelligence:league:read
// ─────────────────────────────────────────────────────────────────────────────

export interface WeekMilestoneV1 {
  label: 'trade_deadline' | 'playoffs_start'
  week: number
  weeksAway: number
  hasPassed: boolean
}

export interface TimeMilestoneV1 {
  label: 'draft' | 'next_waiver_processing'
  at: string
  hasPassed: boolean
}

/**
 * Deterministic league scheduling facts — no placeholder dates. Every field
 * traces to a real stored value (`League.tradeDeadlineWeek`/`playoffStartWeek`,
 * `LeagueSettings.draftDateUtc`, `League.waiverProcessTime`) compared against
 * the league's real current week (reusing this app's own existing
 * `resolveCurrentWeek`, not a new derivation).
 */
export interface LeagueDeadlineV1 {
  leagueId: string
  season: number
  currentWeek: number
  tradeDeadline: WeekMilestoneV1 | null
  playoffsStart: WeekMilestoneV1 | null
  draft: TimeMilestoneV1 | null
  nextWaiverProcessing: TimeMilestoneV1 | null
  nextActionableEvent: (WeekMilestoneV1 | TimeMilestoneV1) | null
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT 3A: Platform Intelligence — Basic tier
// GET /v1/intelligence/platform
// Required scope: intelligence:platform:basic
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformIntelligenceRequest {
  /**
   * Optional: restrict to a subset of your tenant's leagues.
   * Omit to include all leagues in the tenant.
   * All IDs must belong to the caller's tenant; unknown IDs are silently excluded.
   */
  leagueIds?: string[]
}

/**
 * Platform Intelligence response at the `basic` tier.
 *
 * Provides only aggregate signals — no per-league or per-manager data.
 * Safe to display in public dashboards or embed in widgets.
 *
 * Note: `leagueHealthSummary` omits absolute counts to avoid revealing
 * platform scale to external consumers on the basic tier.
 */
export interface PlatformIntelligenceBasicV1 {
  platformEngagementScore: number  // 0-100
  platformEngagementTier:  'thriving' | 'healthy' | 'moderate' | 'struggling' | 'inactive'

  leagueHealthSummary: {
    /** Percent of leagues in 'elite' or 'active' engagement tier. */
    healthyPercent: number
    /** Percent of leagues in 'passive' or 'dormant' engagement tier. */
    atRiskPercent:  number
  }

  /** Qualitative platform momentum from the last 7 days vs total events. */
  momentumSignal:  'accelerating' | 'steady' | 'decelerating' | 'dormant' | 'insufficient_data'
  trendConfidence: 'high' | 'medium' | 'low' | 'insufficient'

  completeness: number
  derivedAt:    string
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT 3B: Platform Intelligence — Full tier
// GET /v1/intelligence/platform
// Required scope: intelligence:platform:full
// (Same endpoint; tier determines which response shape is returned)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ecosystem health for a single transaction dimension (trade / waiver / draft)
 * at the platform level.
 */
export interface PlatformEcosystemDimensionV1 {
  /** Overall tier derived from active-league percentage. */
  tier:                'high' | 'moderate' | 'low' | 'none'
  /** Percent of platform leagues with at least one event in this dimension (0–100). */
  activeLeaguePercent: number
  /** Total events / total leagues (2 decimal places). */
  perLeagueRate:       number
  /** Total events / total managers (2 decimal places). */
  perManagerRate:      number
}

/**
 * A single non-zero activity heatmap cell.
 * All time values are UTC — callers should apply local-time offset for display.
 */
export interface PlatformHeatmapCellV1 {
  /** 0 = Sunday, 6 = Saturday, UTC. */
  dayOfWeek: number
  /** 0–23, UTC. */
  hour:      number
  /** Number of platform behavioral events in this day-of-week / hour slot. */
  count:     number
}

/**
 * An actionable intervention opportunity surfaced at the platform level.
 * Listed in priority order (critical before high).
 * `managerId` is the caller's own tenant-scoped ID — never a cross-tenant value.
 */
export interface PlatformInterventionV1 {
  opportunityId: string
  scope:         'league' | 'manager'
  priority:      'critical' | 'high' | 'medium'
  leagueId:      string
  /** Present only when `scope === 'manager'`. Tenant-scoped manager identifier. */
  managerId?:    string
  /** Machine-readable trigger signal (safe to use for client-side routing). */
  signal:        string
  /** Customer-facing guidance message. No internal terminology. */
  message:       string
}

/**
 * Platform Intelligence response at the `platform` (full) tier.
 *
 * Contains all aggregate distributions, ecosystem rates, the activity heatmap,
 * engagement trends with counts, and the full intervention list.
 *
 * Fields excluded from external API vs. internal PlatformBehavioralIntelligence:
 * - `warnings[]` (internal implementation notes)
 * - `provenance` (internal input counts)
 * - `leagueHealthDistribution.totalLeagues` is included here (full tier callers
 *   are operators who already know their league count)
 */
export interface PlatformIntelligenceV1 {
  // ── Top-level engagement ────────────────────────────────────────────────
  platformEngagementScore: number
  platformEngagementTier:  'thriving' | 'healthy' | 'moderate' | 'struggling' | 'inactive'
  /** How confident to be in the intelligence, driven by completeness and league count. */
  uncertainty:             'low' | 'medium' | 'high' | 'very_high'

  // ── League health distribution ──────────────────────────────────────────
  leagueHealthDistribution: {
    elite:          number
    active:         number
    moderate:       number
    passive:        number
    dormant:        number
    totalLeagues:   number
    healthyPercent: number
    atRiskPercent:  number
  }

  // ── Commissioner quality distribution ───────────────────────────────────
  commissionerQualityDistribution: {
    light:             number
    moderate:          number
    heavy:             number
    critical:          number
    totalLeagues:      number
    /** Percent of leagues where commissioner workload is 'light' or 'moderate'. */
    managedPercent:    number
    /** Percent of leagues where commissioner workload is 'heavy' or 'critical'. */
    overloadedPercent: number
  }

  // ── Retention distribution ──────────────────────────────────────────────
  retentionDistribution: {
    managersByCriticalRisk:     number
    managersByHighRisk:         number
    managersByMediumRisk:       number
    managersByLowRisk:          number
    totalManagers:              number
    managerCriticalRiskPercent: number
    /** Percent of managers at 'critical' or 'high' retention risk. */
    managerAtRiskPercent:       number
    leaguesByCriticalRisk:      number
    leaguesByHighRisk:          number
    leaguesByMediumRisk:        number
    leaguesByLowRisk:           number
    totalLeagues:               number
    leagueCriticalRiskPercent:  number
    /** Percent of leagues at 'critical' or 'high' retention risk. */
    leagueAtRiskPercent:        number
  }

  // ── Ecosystem health ────────────────────────────────────────────────────
  tradeEcosystem:    PlatformEcosystemDimensionV1
  waiverEcosystem:   PlatformEcosystemDimensionV1
  draftParticipation: PlatformEcosystemDimensionV1

  // ── Engagement trends ───────────────────────────────────────────────────
  engagementTrends: {
    sevenDayEventCount:           number
    thirtyDayEventCount:          number
    /** Ratio of last-7-day events to total events. Null when no events. */
    recentActivityRatio:          number | null
    /** Percent of managers with at least one event in the last 7 days. Null when no managers. */
    recentlyActiveManagerPercent: number | null
    /** Recency-based platform momentum signal. */
    momentumSignal:               'accelerating' | 'steady' | 'decelerating' | 'dormant' | 'insufficient_data'
    /**
     * How much to trust the trend signal.
     * Low when fewer than 10 events or fewer than 3 leagues.
     */
    trendConfidence:              'high' | 'medium' | 'low' | 'insufficient'
  }

  // ── Activity heatmap ────────────────────────────────────────────────────
  activityHeatmap: {
    /**
     * Sparse cells — only non-zero slots are included.
     * All times are UTC. Apply local timezone offset for display.
     */
    cells:               PlatformHeatmapCellV1[]
    /** Key of the busiest slot: "${dayOfWeek}-${hour}", e.g. "2-19" (Tue 7pm UTC). */
    peakCellKey:         string | null
    peakDayOfWeek:       number | null  // 0=Sunday, 6=Saturday, UTC
    peakHour:            number | null  // 0-23, UTC
    peakCount:           number
    totalEventsAnalyzed: number
  }

  // ── Intervention opportunities ──────────────────────────────────────────
  /**
   * Prioritised list (critical before high) of leagues and managers needing
   * platform-level attention. Capped at 20 per request.
   */
  interventionOpportunities: PlatformInterventionV1[]

  // ── Data quality ────────────────────────────────────────────────────────
  completeness: number
  derivedAt:    string
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier-gated response union
// Used by the future API route handler to return the correct shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discriminated union over the two platform intelligence shapes.
 * The API route selects the shape based on the caller's effective tier.
 */
export type PlatformIntelligenceResponseData =
  | ({ tier: 'basic' } & PlatformIntelligenceBasicV1)
  | ({ tier: 'platform' } & PlatformIntelligenceV1)

// ─────────────────────────────────────────────────────────────────────────────
// Rate limit tiers (documentation constants)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default rate limits by tier. The future API route enforces these via
 * sliding-window counters keyed by API key hash.
 * These are the defaults — individual keys may be overridden in the key store.
 */
export const RATE_LIMITS_BY_TIER: Record<IntelligenceTier, number> = {
  basic:        1_000,   // requests per hour
  commissioner:   500,
  manager:        500,
  platform:       100,   // expensive compute path
}

// ─────────────────────────────────────────────────────────────────────────────
// Telemetry event shape (for the future API middleware)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emitted by the API route on every request (success or error).
 * No PII — tenantId and leagueId/managerId are hashed before logging.
 */
export interface IntelligenceApiTelemetryEvent {
  requestId:        string
  /** SHA-256 of the raw tenantId — never the raw value. */
  tenantIdHash:     string
  endpoint:         '/v1/intelligence/platform' | '/v1/intelligence/leagues' | '/v1/intelligence/managers'
  tier:             IntelligenceTier
  statusCode:       number
  latencyMs:        number
  completeness:     number
  /** SHA-256 of leagueId when present, null otherwise. */
  leagueIdHash:     string | null
  /** SHA-256 of managerId when present, null otherwise. */
  managerIdHash:    string | null
  rateLimitHit:     boolean
  timestamp:        string  // ISO 8601
}
