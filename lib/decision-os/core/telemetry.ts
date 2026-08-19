/**
 * Decision OS — lightweight telemetry (Slice 1).
 *
 * No full telemetry system yet. This is a pluggable sink: by default it structured-logs in dev and
 * is a no-op in production unless a sink is registered. Architecture/health flags travel on the
 * Decision Object (DecisionTelemetryFlags); this emits lifecycle events around it.
 */
import type { DecisionTelemetryFlags } from './decision'
import { recordDecisionTelemetryDebugEvent } from './telemetryDebugStore'

export type DecisionTelemetryEventName =
  | 'decision.issued'
  | 'decision.adopted'
  | 'decision.resolved'
  // Parity taxonomy (split from the former single 'decision.parity'):
  | 'decision.shadow_parity'   // Decision OS recommendation vs legacy
  | 'decision.validator_parity' // composed validators vs each other
  // Stage 1 enrichment tracking:
  | 'decision.live_enrichment'  // LIVE path ran; enriched=true means decisionOs was added to response

export interface DecisionTelemetryEvent {
  event: DecisionTelemetryEventName
  decision_type: string
  decision_id?: string
  flags?: Partial<DecisionTelemetryFlags> & Record<string, unknown>
  at: string
}

export type DecisionTelemetrySink = (event: DecisionTelemetryEvent) => void

let sink: DecisionTelemetrySink | null = null
/** Tests/infra can register a sink (e.g., to assert emission) without a real telemetry backend. */
export function registerDecisionTelemetrySink(s: DecisionTelemetrySink | null): void {
  sink = s
}

export function emitDecisionTelemetry(
  event: DecisionTelemetryEventName,
  decision_type: string,
  flags?: DecisionTelemetryEvent['flags'],
  decision_id?: string,
): void {
  const payload: DecisionTelemetryEvent = { event, decision_type, decision_id, flags, at: new Date().toISOString() }
  try {
    recordDecisionTelemetryDebugEvent(payload)
    if (sink) sink(payload)
    // console.log (not debug) so Vercel captures these in production log drain
    else console.log('[decision-os]', JSON.stringify(payload))
  } catch {
    // telemetry must never break a decision
  }
}
