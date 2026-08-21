/**
 * Decision OS core — standardized parity telemetry emitters.
 *
 * Every slice emits the SAME parity event taxonomy so dashboards can query across domains:
 *   - decision.shadow_parity    → Decision OS recommendation vs legacy (wrapper-drift / equivalence)
 *   - decision.validator_parity → composed validators agree on shared scope + retirement-safety
 * These thin wrappers guarantee the event name is consistent; the flag payload stays per-slice.
 *
 * They are ALSO where parity evidence is persisted, because this module is the one thing every
 * parity emitter already routes through. The flip gate needs >=50 real comparisons and reads a
 * per-invocation in-memory array, so without a durable copy it can never reach its own threshold.
 *
 * ⚠ Persisting here rather than via a registered telemetry sink is deliberate and was settled by
 * production evidence, not preference — see the header of `durableParityStore.ts`. A sink
 * registered from `instrumentation.ts` never reaches the route's copy of `core/telemetry.ts`
 * (separate Next.js bundles do not share module state), and registering one also silently mutes
 * every non-parity event, because `emitDecisionTelemetry` treats a sink as having handled the
 * event and skips its console.log fallback.
 */
import { emitDecisionTelemetry, type DecisionTelemetryEvent } from '@/lib/decision-os/core/telemetry'
import { persistParityEvent } from './durableParityStore'

/**
 * Emit, then durably record. Never throws: `persistParityEvent` swallows its own failures and does
 * not await the write, so a parity emitter costs the same as before plus one synchronous call.
 */
function emitAndPersist(
  event: 'decision.shadow_parity' | 'decision.validator_parity',
  decisionType: string,
  flags: DecisionTelemetryEvent['flags'],
  decisionId?: string,
): void {
  emitDecisionTelemetry(event, decisionType, flags, decisionId)
  persistParityEvent({
    event,
    decision_type: decisionType,
    decision_id: decisionId,
    flags,
    at: new Date().toISOString(),
  })
}

export function emitShadowParity(
  decisionType: string,
  flags: DecisionTelemetryEvent['flags'],
  decisionId?: string,
): void {
  emitAndPersist('decision.shadow_parity', decisionType, flags, decisionId)
}

export function emitValidatorParity(
  decisionType: string,
  flags: DecisionTelemetryEvent['flags'],
  decisionId?: string,
): void {
  emitAndPersist('decision.validator_parity', decisionType, flags, decisionId)
}

/**
 * Emitted by each Stage 1 LIVE block after it runs.
 * `enriched: true`  → decisionOs was built and will be in the response.
 * `enriched: false` → decisionOs is absent (inputs unavailable / ran=false / exception).
 * `latency_ms`      → wall-clock time for the entire LIVE path (useful for p95/p99 tracking).
 *
 * NOT persisted: it is not a comparison and the flip gate does not read it.
 */
export function emitLiveTelemetry(
  decisionType: string,
  flags: DecisionTelemetryEvent['flags'],
  decisionId?: string,
): void {
  emitDecisionTelemetry('decision.live_enrichment', decisionType, flags, decisionId)
}
