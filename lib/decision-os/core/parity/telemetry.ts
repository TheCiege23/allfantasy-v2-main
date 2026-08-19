/**
 * Decision OS core — standardized parity telemetry emitters.
 *
 * Every slice emits the SAME parity event taxonomy so dashboards can query across domains:
 *   - decision.shadow_parity    → Decision OS recommendation vs legacy (wrapper-drift / equivalence)
 *   - decision.validator_parity → composed validators agree on shared scope + retirement-safety
 * These thin wrappers guarantee the event name is consistent; the flag payload stays per-slice.
 */
import { emitDecisionTelemetry, type DecisionTelemetryEvent } from '@/lib/decision-os/core/telemetry'

export function emitShadowParity(
  decisionType: string,
  flags: DecisionTelemetryEvent['flags'],
  decisionId?: string,
): void {
  emitDecisionTelemetry('decision.shadow_parity', decisionType, flags, decisionId)
}

export function emitValidatorParity(
  decisionType: string,
  flags: DecisionTelemetryEvent['flags'],
  decisionId?: string,
): void {
  emitDecisionTelemetry('decision.validator_parity', decisionType, flags, decisionId)
}

/**
 * Emitted by each Stage 1 LIVE block after it runs.
 * `enriched: true`  → decisionOs was built and will be in the response.
 * `enriched: false` → decisionOs is absent (inputs unavailable / ran=false / exception).
 * `latency_ms`      → wall-clock time for the entire LIVE path (useful for p95/p99 tracking).
 */
export function emitLiveTelemetry(
  decisionType: string,
  flags: DecisionTelemetryEvent['flags'],
  decisionId?: string,
): void {
  emitDecisionTelemetry('decision.live_enrichment', decisionType, flags, decisionId)
}
