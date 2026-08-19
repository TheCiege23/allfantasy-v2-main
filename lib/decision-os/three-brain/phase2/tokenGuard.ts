/**
 * 2F — Token safety, expressed as a reserve/finalize/release contract.
 *
 * The repo's ledger (`TokenSpendService`) is CHARGE-THEN-REFUND with a unique `idempotencyKey`, not a true
 * pending-reservation ledger. Rather than invent a second ledger, this contract MAPS onto it:
 *   - reserve  → idempotent charge keyed on the canonical run key (concurrent/duplicate callers dedupe to one
 *                charge; a retry/refresh reuses the same key and never double-charges),
 *   - finalize → no-op after a persisted success (the charge already stands),
 *   - release  → refund/reverse on failure, cancellation, timeout, invalid output, or persistence failure.
 * Net effect is identical to reserve/finalize: a failed run costs the user nothing, and reuse of an
 * already-paid result never charges again (the DB-first hit returns before reserve is ever called).
 *
 * The concrete implementation is INJECTED; this module holds only the contract + a no-charge default.
 */
export type TokenReservation = {
  /** Canonical run key — the idempotency key; identical requests reserve exactly once. */
  reservationKey: string
  /** The spend ledger entry id, or null when the run is subscription-covered (no charge). */
  ledgerId: string | null
  /** Whether a real charge occurred (false for subscription-covered runs). */
  charged: boolean
  tokenCost: number
}

export type TokenAuthorization =
  | { ok: true; reservation: TokenReservation }
  | { ok: false; denyReason: 'token_purchase_required' }

export type TokenReserveInput = {
  userId: string
  userEmail?: string | null
  entitlementMode: 'subscription' | 'tokens'
  tokenRuleCode?: string
  /** Canonical run key — used verbatim as the reservation idempotency key. */
  reservationKey: string
  /** The durable run id this reservation belongs to (linkage/audit). */
  intelligenceRunId?: string | null
  sourceType: string
  sourceId: string
  description?: string
  metadata?: Record<string, unknown>
}

export interface IntelligenceTokenGuard {
  /** Authorize + (if tokens are required) atomically RESERVE a hold — spendable balance drops but nothing is
   *  finalized. Idempotent on `reservationKey`; concurrent duplicates share one hold. Returns a no-charge
   *  reservation when covered by subscription. Insufficient spendable balance → token_purchase_required. */
  reserve(input: TokenReserveInput): Promise<TokenAuthorization>
  /** FINALIZE the reservation into a settled charge — called ONLY after a validated result is persisted. */
  finalize(input: { userId: string; userEmail?: string | null; reservation: TokenReservation }): Promise<void>
  /** RELEASE the reservation (return the hold; no charge). Idempotent — safe once per run in a finally/catch. */
  release(input: {
    userId: string
    userEmail?: string | null
    reservation: TokenReservation
    reason: string
  }): Promise<void>
}

/** A guard that never charges — for surfaces that are always subscription-covered or free. */
export const subscriptionOnlyTokenGuard: IntelligenceTokenGuard = {
  async reserve(input) {
    return {
      ok: true,
      reservation: { reservationKey: input.reservationKey, ledgerId: null, charged: false, tokenCost: 0 },
    }
  },
  async finalize() {
    /* no charge to finalize */
  },
  async release() {
    /* no charge to release */
  },
}

/** Durable refresh scheduler — enqueues at most ONE refresh per canonical key using a repository-backed job
 *  mechanism (never a fire-and-forget in-process promise as the production implementation). */
export interface IntelligenceRefreshScheduler {
  enqueue(task: {
    /** Canonical identity key — the refresh idempotency key (one refresh per key). */
    identityKey: string
    /** Non-sensitive labels for the durable job row. */
    tool: string
    decisionType: string
    userId: string
    leagueId: string | null
    /** The non-billable refresh work. The durable runner invokes it at most once per key. */
    run: () => Promise<void>
  }): Promise<{ refreshInProgress: boolean }>
}
