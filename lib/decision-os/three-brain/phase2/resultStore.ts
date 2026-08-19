/**
 * 2B + 2D — Durable result store + single-flight lock contract. The DATABASE is the authority: reuse lookups,
 * ownership claims, and status transitions all go through this interface. The single-flight lock is a durable
 * row keyed by the canonical identity (unique), guarded by an owner token + lease so it works across multiple
 * application instances — not an in-process map. A crashed/abandoned owner's lease expires and a later request
 * can safely take over; a stale owner can never clobber a newer run because every mutation is owner-token gated.
 *
 * The concrete implementation is INJECTED. The production impl is Prisma-backed (`prismaResultStore.ts`); tests
 * use an in-memory implementation of this exact interface. An in-memory map is NEVER the production lock.
 */
import type { ThreeBrainDecisionResult } from '../types'
import type { IntelligenceRequestIdentity, IntelligenceRunRecord } from './types'

/** Result of attempting to claim single-flight ownership of an identity key. */
export type ClaimResult =
  /** This caller owns execution — run the orchestration, then complete()/fail() with `ownerToken`. */
  | { outcome: 'owner'; run: IntelligenceRunRecord; ownerToken: string }
  /** Someone else holds a live lease — this caller must wait/coalesce, not run providers. */
  | { outcome: 'busy'; run: IntelligenceRunRecord }
  /** A reusable (fresh success) or terminal (non-retryable failure) row already exists — do not run. */
  | { outcome: 'exists'; run: IntelligenceRunRecord }

export type ClaimInput = {
  identity: IntelligenceRequestIdentity
  tool: string
  decisionType: string
  sport: string | null
  platform: string | null
  connectedGroupId: string | null
  ownerToken: string
  leaseMs: number
  now: Date
  maxAttempts: number
}

export type CompleteInput = {
  identityKey: string
  userId: string
  ownerToken: string
  result: ThreeBrainDecisionResult
  requestSnapshot: Record<string, unknown>
  providerParticipation: Record<string, string>
  entitlementMode: string
  tokenLedgerId: string | null
  tokenReservationKey: string | null
  expiresAt: Date | null
  now: Date
}

export type FailInput = {
  identityKey: string
  userId: string
  ownerToken: string
  category: string
  retryable: boolean
  message: string
  now: Date
}

export interface IntelligenceResultStore {
  /** Tenant-scoped lookup — returns a run ONLY when it belongs to `userId` (guards against cross-user reuse). */
  findByIdentity(input: { identityKey: string; userId: string }): Promise<IntelligenceRunRecord | null>

  /**
   * Atomically become the single-flight owner, or report the durable state. Creates a `running` row (owner
   * token + lease) on first claim; takes over a stuck (expired-lease) run or a retryable failure with attempts
   * remaining; reports `busy` for a live lease and `exists` for a fresh success or terminal failure.
   */
  claim(input: ClaimInput): Promise<ClaimResult>

  /** Persist a validated success. Owner-token gated — a superseded owner cannot overwrite a newer run. */
  complete(input: CompleteInput): Promise<IntelligenceRunRecord>

  /** Record a failure with category + retryability. Owner-token gated. Never stored as a reusable success. */
  fail(input: FailInput): Promise<void>

  /** Owner-driven UNKNOWN: the owner lost its lease / hit its deadline and could NOT confirm cancellation of an
   *  in-flight provider request (it hung past grace, rejected ambiguously, or completed but could not be settled).
   *  Transition the run to `unknown` (retryable=false) so a finite lease/claim expiry can NEVER permit automatic
   *  re-execution. Owner-token + `status:'running'` gated (a superseded owner is fenced; the successor's takeover
   *  guard records UNKNOWN instead). The provider-exec marker is PRESERVED. Returns whether this owner recorded it. */
  markUnknown(input: {
    identityKey: string
    userId: string
    ownerToken: string
    failureCategory: string
    now: Date
  }): Promise<{ recorded: boolean }>

  /** Durably mark that an EXTERNAL provider request is about to begin for this owner (sets
   *  `provider_exec_started_at`). Owner-token gated. If the owner then crashes before complete()/fail() clears it,
   *  a takeover observes the marker and transitions the run to `unknown` instead of re-executing. */
  markProviderExecStarted(input: { identityKey: string; userId: string; ownerToken: string; now: Date }): Promise<void>

  /** Bump `lastAccessedAt` for reuse observability (best-effort). */
  touch(input: { identityKey: string; userId: string; now: Date }): Promise<void>

  /** Extend the freshness (expiry) of an existing SUCCEEDED result WITHOUT changing the result — the
   *  "unchanged-evidence refresh" path (no provider spend). Returns true if a succeeded row was extended. */
  extendFreshness(input: { identityKey: string; userId: string; expiresAt: Date | null; now: Date }): Promise<boolean>
}
