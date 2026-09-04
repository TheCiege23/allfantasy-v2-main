import type {
  CommissionerConfidenceLevel,
  CommissionerErrorAttributableId,
  CommissionerErrorCategory,
  CommissionerErrorContract,
  CommissionerEvidenceMetadata,
  CommissionerModuleId,
  CommissionerNotificationSeverity,
  CommissionerRecommendationContract,
} from '../contracts'
import type { SeverityTier } from '../tokens/colors'

const VALID_CONFIDENCE_LEVELS: readonly CommissionerConfidenceLevel[] = ['developing_signal', 'moderate', 'high', 'very_high']
const VALID_SEVERITY_TIERS: readonly SeverityTier[] = ['critical', 'elevated', 'standard', 'advisory', 'positive']
const VALID_EVENT_SEVERITIES: readonly CommissionerNotificationSeverity[] = ['informational', 'success', 'warning', 'critical']
const VALID_ERROR_CATEGORIES: readonly CommissionerErrorCategory[] = [
  'validation',
  'not_found',
  'unauthorized',
  'forbidden',
  'conflict',
  'upstream_unavailable',
  'unknown',
]

/**
 * Every normalizer here guards against a Decision OS implementation
 * (chiefly a future live backend, which returns untyped JSON over the
 * wire) sending something that doesn't match its compile-time type.
 * Today's stub/demo fixtures are already valid TypeScript literals, so
 * these are forward-looking defensive guarantees, not workarounds for an
 * observed bug — they make the adapter's "translate Decision OS outputs
 * into Platform Contracts" responsibility real rather than assumed.
 */
export function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value
  return new Date().toISOString()
}

export function isValidConfidence(value: unknown): value is CommissionerConfidenceLevel {
  return typeof value === 'string' && (VALID_CONFIDENCE_LEVELS as readonly string[]).includes(value)
}

export function normalizeConfidence(value: unknown, fallback: CommissionerConfidenceLevel = 'moderate'): CommissionerConfidenceLevel {
  return isValidConfidence(value) ? value : fallback
}

export function isValidSeverity(value: unknown): value is SeverityTier {
  return typeof value === 'string' && (VALID_SEVERITY_TIERS as readonly string[]).includes(value)
}

export function normalizeSeverity(value: unknown, fallback: SeverityTier = 'standard'): SeverityTier {
  return isValidSeverity(value) ? value : fallback
}

export function isValidEventSeverity(value: unknown): value is CommissionerNotificationSeverity {
  return typeof value === 'string' && (VALID_EVENT_SEVERITIES as readonly string[]).includes(value)
}

/**
 * The separate event-severity vocabulary Notifications and Activity Stream
 * both use (`CommissionerNotificationSeverity` — informational/success/
 * warning/critical), distinct from `SeverityTier`'s condition vocabulary
 * above. Added during the Phase 2 production-hardening adapter audit: both
 * namespaces' demo/stub data always already satisfies this type (built via
 * an exhaustive `conditionToEventSeverity()` switch), so this had no
 * practical effect until now — but a real live backend returning untyped
 * JSON over the wire has no such guarantee, and every other enum-like
 * field in this file already gets this defensive treatment.
 */
export function normalizeEventSeverity(value: unknown, fallback: CommissionerNotificationSeverity = 'informational'): CommissionerNotificationSeverity {
  return isValidEventSeverity(value) ? value : fallback
}

function isValidErrorCategory(value: unknown): value is CommissionerErrorCategory {
  return typeof value === 'string' && (VALID_ERROR_CATEGORIES as readonly string[]).includes(value)
}

/** Ensures a returned error is always well-formed — never a partial or malformed object reaching the UI. */
export function normalizeErrorContract(
  error: CommissionerErrorContract | null | undefined,
  moduleId: CommissionerErrorAttributableId
): CommissionerErrorContract | null {
  if (!error) return null
  return {
    category: isValidErrorCategory(error.category) ? error.category : 'unknown',
    message: typeof error.message === 'string' && error.message.length > 0 ? error.message : 'An unspecified error occurred.',
    moduleId: error.moduleId ?? moduleId,
    retryable: typeof error.retryable === 'boolean' ? error.retryable : false,
    timestamp: normalizeTimestamp(error.timestamp),
  }
}

/**
 * The honest-placeholder contract in code: if a client implementation
 * throws (rather than returning a typed error, which every current
 * stub/demo/live implementation is careful to avoid) the adapter still
 * never lets a raw Error or string escape to a UI module. Category is
 * always 'upstream_unavailable' — an unexpected throw is definitionally
 * an upstream problem from the adapter's vantage point, never the
 * caller's fault.
 */
export function errorFromException(err: unknown, moduleId: CommissionerErrorAttributableId): CommissionerErrorContract {
  const message = err instanceof Error ? err.message : 'An unexpected error occurred while contacting Decision OS.'
  return {
    category: 'upstream_unavailable',
    message,
    moduleId,
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

/** Defensive empty-array guarantee — a list field should never be undefined downstream of the adapter. */
export function normalizeList<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

export interface EvidencePointLike {
  label: string
  detail: string
}

/** Trims whitespace and drops any evidence point missing its label or detail — never a blank card downstream. */
export function normalizeEvidencePoints<T extends EvidencePointLike>(value: T[] | null | undefined): T[] {
  return normalizeList(value)
    .map((point) => ({ ...point, label: point.label?.trim() ?? '', detail: point.detail?.trim() ?? '' }))
    .filter((point) => point.label.length > 0 && point.detail.length > 0)
}

/**
 * Normalizes the shared evidence-metadata shape (Platform Contracts'
 * `CommissionerEvidenceMetadata`). No current module attaches this yet —
 * it exists in Platform Contracts ahead of its first consumer — so this
 * is exercised by tests and ready for the next module that surfaces
 * evidence with confidence/recency attached (e.g. Workspace's related-
 * evidence links), not retrofitted onto today's four modules' shapes.
 */
export function normalizeEvidenceMetadata(
  value: Partial<CommissionerEvidenceMetadata> | null | undefined,
  moduleId: CommissionerModuleId
): CommissionerEvidenceMetadata {
  return {
    confidence: normalizeConfidence(value?.confidence),
    asOf: normalizeTimestamp(value?.asOf),
    sourceModuleId: value?.sourceModuleId ?? moduleId,
  }
}

/** Applied to any recommendation payload — League Health's health-scoped recommendations and Recommendations Center's queue alike. */
export function normalizeRecommendation(rec: CommissionerRecommendationContract): CommissionerRecommendationContract {
  return {
    ...rec,
    severity: normalizeSeverity(rec.severity),
    confidence: normalizeConfidence(rec.confidence),
    createdAt: normalizeTimestamp(rec.createdAt),
  }
}

export function normalizeRecommendationList(value: CommissionerRecommendationContract[] | null | undefined): CommissionerRecommendationContract[] {
  return normalizeList(value).map(normalizeRecommendation)
}
