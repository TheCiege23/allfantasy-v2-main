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
import { recordDecisionOsFeed } from '@/lib/telemetry/decision-os-feed'

/**
 * The parity surface for a comparison whose two sides come from the SAME engine — the wrapper is
 * fed the legacy answer and then compared against it.
 *
 * 🛑 WHAT SUCH A SURFACE PROVES, AND WHAT IT DOES NOT. It proves the Decision OS wrapper introduces
 * no drift, which is exactly what you want before replacing a call site. It is NOT evidence that
 * the answer is good, because the same engine produced both sides. `ADR_DECISION_OS_PHASE3_
 * WHAT_COUNTS_AS_FLIP_EVIDENCE` decides this in full; §5.2 is the operative sentence — "a
 * wrap-fidelity surface reaching 50/95% licenses replacing the call site, it does not license
 * trusting the recommendation".
 *
 * ⚠ THE LABEL IS THE MECHANISM, AND THAT WAS A DELIBERATE CHOICE OVER THE ALTERNATIVE. The same
 * ADR considered teaching `flipReadiness` to refuse these surfaces and REJECTED it: that hardcodes
 * "which surfaces are tautological" — a fact about wiring — into a summariser that only reports and
 * would not be updated when the wiring changes. `flipReadiness` groups on `flags.surface` with a
 * literal `'default'` fallback, so naming the surface is what keeps weak evidence out of a strong
 * bucket. Do not add that policy to the summariser; label the emitter.
 *
 * ⚠ AND THE LABEL MUST GO ON BEFORE A SECOND SURFACE EXISTS, NOT AFTER. `manager.lineup.set` and
 * `commissioner.league.health` each had exactly one surface and emitted none, bucketing as
 * `'default'` — harmless only while the count is one. The ADR's own §7 says to label them first,
 * because a mislabelled sample cannot be re-attributed once it is fifty rows deep.
 *
 * ⚠ HISTORICAL ROWS KEEP `'default'` AND ARE NOT REWRITTEN. The ~11,000 lineup rows already
 * recorded stay where they are; new rows land here. That split is the honest outcome rather than a
 * defect — those rows were gathered under the old label and cannot be reinterpreted under this one.
 */
export const WRAP_FIDELITY_SURFACE = 'wrap_fidelity' as const

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
    const sources = entries.map(([k, o]) => `${k}:${o.servedFrom}`).join(",")
    emitDecisionTelemetry("decision.os_feed", domain, {
      served_store: by.store,
      served_live: by.live,
      served_unavailable: by.unavailable,
      // Per-source, so a domain with one hot and one cold fact kind is legible rather than
      // averaged into a single misleading hit rate.
      sources,
    })
    // The console line above is log-drain-only and unqueryable in production, and the
    // store-vs-live split is the ONLY evidence for whether `domain_os_facts` is worth
    // migrating — so a durable copy goes through the same persistent path recordLlmUsage
    // uses (ApiUsageEvent; no new table). Fire-and-forget and never throws; request paths
    // accept a lost write the same way durableParityStore documents.
    recordDecisionOsFeed({
      domain,
      servedStore: by.store,
      servedLive: by.live,
      servedUnavailable: by.unavailable,
      sources,
    })
  } catch {
    // measuring the cache must never break the request
  }
}
