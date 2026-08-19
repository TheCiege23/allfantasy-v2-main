/**
 * 2H — Structured, PII-safe observability. Emits counters/events for cache reuse, misses, stale hits,
 * invalidations, single-flight ownership, coalesced waiters, stuck-run recovery, provider/orchestration
 * duration, entitlement denials, token reserve/finalize/release, retries, and success/failure. NEVER logs
 * secrets, auth material, hidden reasoning, prompts, or private league payloads.
 *
 * The observer is INJECTED. `CountingObserver` accumulates the tallies needed to answer the cost-control
 * questions (reuse rate, provider calls avoided, coalesced duplicates, per-tool cost, token
 * reserve/finalize/release balance, stuck recoveries) without any admin dashboard.
 */
export type IntelligenceEventType =
  | 'cache_hit'
  | 'cache_miss'
  | 'stale_hit'
  | 'invalidated'
  | 'single_flight_owner'
  | 'coalesced_waiter'
  | 'stuck_recovery'
  | 'orchestration'
  | 'entitlement_denied'
  | 'token_reserved'
  | 'token_finalized'
  | 'token_released'
  | 'retry'
  | 'success'
  | 'failure'

export type IntelligenceEvent = {
  type: IntelligenceEventType
  tool: string
  decisionType: string
  /** Internal user id (not PII like name/email). Never include prompts/evidence/secrets. */
  userId?: string
  correlationId?: string | null
  durationMs?: number
  ok?: boolean
  tokenCost?: number
  charged?: boolean
  denyReason?: string
  failureCategory?: string
  /** Small, non-sensitive extra context only. */
  meta?: Record<string, string | number | boolean | null>
}

export interface IntelligenceObserver {
  emit(event: IntelligenceEvent): void
}

/** Discards everything (tests that don't assert telemetry). */
export const noopObserver: IntelligenceObserver = { emit() {} }

export type IntelligenceCounters = {
  byType: Record<string, number>
  /** provider calls avoided = cache_hit + stale_hit + coalesced_waiter (no orchestration ran). */
  providerCallsAvoided: number
  orchestrationsRun: number
  coalescedWaiters: number
  stuckRecoveries: number
  tokensReserved: number
  tokensFinalized: number
  tokensReleased: number
  tokenCostReserved: number
  tokenCostReleased: number
  perToolReuse: Record<string, number>
  perToolOrchestrations: Record<string, number>
}

/** Accumulating observer — answers the cost-control questions from its `snapshot()`. */
export class CountingObserver implements IntelligenceObserver {
  private readonly c: IntelligenceCounters = {
    byType: {},
    providerCallsAvoided: 0,
    orchestrationsRun: 0,
    coalescedWaiters: 0,
    stuckRecoveries: 0,
    tokensReserved: 0,
    tokensFinalized: 0,
    tokensReleased: 0,
    tokenCostReserved: 0,
    tokenCostReleased: 0,
    perToolReuse: {},
    perToolOrchestrations: {},
  }

  emit(event: IntelligenceEvent): void {
    this.c.byType[event.type] = (this.c.byType[event.type] ?? 0) + 1
    switch (event.type) {
      case 'cache_hit':
      case 'stale_hit':
        this.c.providerCallsAvoided += 1
        this.c.perToolReuse[event.tool] = (this.c.perToolReuse[event.tool] ?? 0) + 1
        break
      case 'coalesced_waiter':
        this.c.providerCallsAvoided += 1
        this.c.coalescedWaiters += 1
        break
      case 'stuck_recovery':
        this.c.stuckRecoveries += 1
        break
      case 'orchestration':
        this.c.orchestrationsRun += 1
        this.c.perToolOrchestrations[event.tool] = (this.c.perToolOrchestrations[event.tool] ?? 0) + 1
        break
      case 'token_reserved':
        if (event.charged) {
          this.c.tokensReserved += 1
          this.c.tokenCostReserved += event.tokenCost ?? 0
        }
        break
      case 'token_finalized':
        if (event.charged) this.c.tokensFinalized += 1
        break
      case 'token_released':
        if (event.charged) {
          this.c.tokensReleased += 1
          this.c.tokenCostReleased += event.tokenCost ?? 0
        }
        break
    }
  }

  snapshot(): IntelligenceCounters {
    return JSON.parse(JSON.stringify(this.c)) as IntelligenceCounters
  }

  /** Reserved-but-never-finalized-or-released charges (should be zero in a healthy system). */
  danglingReservations(): number {
    return this.c.tokensReserved - this.c.tokensFinalized - this.c.tokensReleased
  }
}
