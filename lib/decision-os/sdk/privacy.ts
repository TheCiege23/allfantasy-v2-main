/**
 * Decision OS — Phase 7.4 Widget SDK privacy layer.
 *
 * Hard denylist of internal Decision OS field names and terminology that must
 * never cross the SDK boundary into a host application. Pure, deterministic,
 * non-mutating.
 *
 * ADR: PHASE_7_4_WIDGET_SDK_ADR.md
 */

/**
 * Object keys that must never appear in any value returned across the SDK
 * boundary. Distinct from Phase 7.3's telemetry denylist — this is broader,
 * covering the full internal object-field surface.
 */
export const INTERNAL_FIELD_DENYLIST: readonly string[] = [
  'decisionId',
  'warnings',
  'provenance',
  'completenessInternal',
  'behavioralEvent',
  'behavioralEvents',
  'rawIntelligence',
  'derivedFrom',
  'lookbackDays',
  'sourceModels',
  'providerName',
  'apiKey',
  'internalScore',
  'internalScores',
  'ruleVerdicts',
  'decisionObject',
]

/**
 * Terminology substrings that must never appear in any serialized SDK output
 * (event payloads, error messages, widget content). Checked case-sensitively
 * against internal naming conventions used throughout Decision OS.
 */
export const INTERNAL_TERMINOLOGY_DENYLIST: readonly string[] = [
  'Decision OS',
  'decision-os',
  'Canonical World',
  'canonicalWorld',
  'behavioralIntelligence',
  'BehavioralIntelligence',
  'Phase 5',
  'Phase 6',
  'Phase5',
  'Phase6',
  'DCO',
  'shadowValidation',
  'ARCHITECTURE_FREEZE',
]

/**
 * Recursively removes denylisted keys from an object or array. Pure —
 * returns a new structure, never mutates the input. Primitives pass through
 * unchanged.
 */
export function stripInternalFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(v => stripInternalFields(v)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (INTERNAL_FIELD_DENYLIST.includes(key)) continue
      result[key] = stripInternalFields(val)
    }
    return result as unknown as T
  }
  return value
}

/**
 * Scans a serialized string (e.g. `JSON.stringify(output)`) for banned
 * internal terminology. Returns the list of matched terms (empty = clean).
 */
export function findInternalLeakage(serialized: string): string[] {
  return INTERNAL_TERMINOLOGY_DENYLIST.filter(term => serialized.includes(term))
}

/** Convenience boolean wrapper around findInternalLeakage. */
export function hasInternalLeakage(serialized: string): boolean {
  return findInternalLeakage(serialized).length > 0
}
