/**
 * Decision OS — Phase 7.4 Widget SDK event contract.
 *
 * Nine telemetry event types + deterministic ordering rules + a pure event
 * builder. Telemetry only — no analytics pipeline, no network send.
 *
 * ADR: PHASE_7_4_WIDGET_SDK_ADR.md
 */

import type { SDKEvent, SDKTelemetryEventType } from './types'

export const ALL_SDK_EVENT_TYPES: readonly SDKTelemetryEventType[] = [
  'loaded', 'rendered', 'refresh', 'interaction', 'cta_click',
  'recommendation_viewed', 'recommendation_accepted', 'error', 'disposed',
]

/** Event types that terminate a widget's telemetry stream — must be last if present. */
const TERMINAL_EVENT_TYPES: readonly SDKTelemetryEventType[] = ['disposed']

// ── Deterministic tenant obfuscation ──────────────────────────────────────────

/**
 * Deterministic, non-cryptographic obfuscation of a tenant ID for telemetry.
 * Prevents accidental logging of the raw tenant ID in event payloads.
 */
export function obfuscateTenantIdForTelemetry(tenantId: string): string {
  let h = 2166136261
  for (let i = 0; i < tenantId.length; i++) {
    h ^= tenantId.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return `t_${h.toString(16).padStart(8, '0')}`
}

// ── Event builder ─────────────────────────────────────────────────────────────

/**
 * Builds a single SDKEvent. Pure — the caller supplies tenantId (raw) once;
 * this function obfuscates it before returning, so the raw value never
 * appears in the returned object.
 */
export function buildSDKEvent(
  widgetId: string,
  eventType: SDKTelemetryEventType,
  tenantId: string,
  opts: {
    payload?: Record<string, string | number | boolean | null>
    timestamp?: string
  } = {},
): SDKEvent {
  return {
    eventType,
    widgetId,
    timestamp: opts.timestamp ?? new Date().toISOString(),
    tenantIdHash: obfuscateTenantIdForTelemetry(tenantId),
    payload: opts.payload ?? {},
  }
}

// ── Ordering validation ────────────────────────────────────────────────────────

export interface EventSequenceValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Validates ordering invariants across a sequence of events for a single widget:
 *   - 'loaded' must occur before 'rendered' (if both present)
 *   - no event may follow a terminal event ('disposed')
 *   - at most one 'disposed' event
 */
export function validateEventSequence(events: SDKEvent[]): EventSequenceValidationResult {
  const errors: string[] = []

  const loadedIndex = events.findIndex(e => e.eventType === 'loaded')
  const renderedIndex = events.findIndex(e => e.eventType === 'rendered')
  if (loadedIndex !== -1 && renderedIndex !== -1 && renderedIndex < loadedIndex) {
    errors.push("'rendered' event occurred before 'loaded' event")
  }

  let disposedCount = 0
  for (let i = 0; i < events.length; i++) {
    const type = events[i].eventType
    if (TERMINAL_EVENT_TYPES.includes(type)) {
      disposedCount++
      if (i !== events.length - 1) {
        errors.push(`'${type}' event at index ${i} is not the last event in the sequence`)
      }
    }
  }
  if (disposedCount > 1) {
    errors.push(`'disposed' event occurred ${disposedCount} times; expected at most 1`)
  }

  return { valid: errors.length === 0, errors }
}
