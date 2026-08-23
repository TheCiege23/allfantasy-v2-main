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

/**
 * Domain-OS feed outcomes for one request or sweep tick.
 *
 * WHY THIS IS THE POINT OF WIRING THE FEED AT ALL. The feed serves a fact from the store when
 * one is fresh and derives it live otherwise, and the ONLY way to know which is happening is to
 * count it. Signal facts carry a 30-minute TTL by design (a stale injury status is a wrong
 * answer delivered confidently), so the store only pays on repeat requests inside that window --
 * which is a property of real traffic, not of this code. If `store` stays at zero here, the
 * cache is overhead and the backing table is not worth creating.
 *
 * NOT persisted: it is not a parity comparison and the flip gate does not read it.
 * Never throws -- telemetry must not be able to fail the decision it is measuring.
 */
export function emitFeedOutcomes(
  domain: string,
  outcomes: Record<string, { servedFrom: string; ageMs: number | null }>,
): void {
  try {
    const entries = Object.entries(outcomes)
    if (entries.length === 0) return
    const by = { store: 0, live: 0, unavailable: 0 } as Record<string, number>
    for (const [, o] of entries) by[o.servedFrom] = (by[o.servedFrom] ?? 0) + 1
    emitDecisionTelemetry("decision.os_feed", domain, {
      served_store: by.store,
      served_live: by.live,
      served_unavailable: by.unavailable,
      // Per-source, so a domain with one hot and one cold fact kind is legible rather than
      // averaged into a single misleading hit rate.
      sources: entries.map(([k, o]) => `${k}:${o.servedFrom}`).join(","),
    })
  } catch {
    // measuring the cache must never break the request
  }
}
