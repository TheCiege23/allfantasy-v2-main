/**
 * Commissioner OS · degraded sync. T-204.
 *
 * "`SyncStatus` transitions on failure. A broken league goes read-only and
 * clearly flagged, NEVER STALE-AS-LIVE. Assume a provider goes dark mid-season."
 *
 * ─── 🛑 "NEVER STALE-AS-LIVE" IS A STATEMENT ABOUT TIME, NOT ABOUT FAILURE ───
 * The obvious implementation counts consecutive failures and flips to DEGRADED
 * at a threshold. That handles a provider returning errors. It does NOT handle
 * the case the ticket actually names — a provider going dark mid-season — and
 * the difference is the whole ticket:
 *
 *   a provider returning 503        → jobs run, jobs fail, the counter climbs,
 *                                     DEGRADED. Handled either way.
 *   a provider going dark, OR our
 *   scheduler quietly stopping      → NO JOBS RUN AT ALL. Zero failures. The
 *                                     counter never moves. `status` sits on OK
 *                                     forever while the data ages, and the
 *                                     product serves a January roster in March
 *                                     with a green badge on it.
 *
 * The second is worse and is the one a failure counter cannot see. So the status
 * a caller acts on is DERIVED — `effectiveStatus(binding, now)` — and a stored
 * OK that has not been refreshed inside the freshness window reads as DEGRADED
 * whatever the column says.
 *
 * A stored column alone can only ever describe the last thing that happened. It
 * cannot describe nothing happening.
 */

import { type DomainError, invariant } from './errors'
import { type Result, err, ok } from './result'
import type { ProviderError } from './providers'
import type { ActionKey } from './authorize'

export type SyncStatus = 'IDLE' | 'RUNNING' | 'OK' | 'DEGRADED' | 'FAILED'

// ─── Thresholds: config, not prose ───────────────────────────────────────────

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  // A malformed value falls back rather than becoming NaN. `now - NaN` is an
  // invalid date, every comparison against it is false, and the staleness check
  // would silently stop reporting anything.
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Consecutive failed jobs before a binding is DEGRADED. */
export const DEGRADE_AFTER_FAILURES = readNumber('COMMISH_SYNC_DEGRADE_AFTER', 3)

/**
 * How long a successful sync stays trustworthy.
 *
 * Generous on purpose — 6h, not 1h. A false DEGRADED on a provider having a
 * slow morning teaches operators to ignore the flag, and a flag nobody reads is
 * worse than none. The failure this defends against is measured in days.
 */
export const FRESHNESS_WINDOW_MS = readNumber('COMMISH_SYNC_FRESHNESS_HOURS', 6) * 60 * 60 * 1000

// ─── Job outcome → stored status ─────────────────────────────────────────────

export type SyncOutcome =
  | { readonly kind: 'success'; readonly at: Date; readonly cursor?: string | null }
  | { readonly kind: 'failure'; readonly at: Date; readonly error: ProviderError }

export type BindingSyncState = {
  readonly status: SyncStatus
  readonly consecutiveFailures: number
  readonly lastSyncedAt: Date | null
  readonly lastErrorAt: Date | null
  readonly lastErrorSummary: string | null
}

/**
 * Fold one job outcome into the binding's stored state.
 *
 * ⚠ A SUCCESS RESETS THE COUNTER TO ZERO, not to `count - 1`. A provider that
 * flaps — fail, fail, succeed, fail, fail — is healthy enough to use, and
 * decrementing would accumulate it into a DEGRADED that never clears.
 */
export function applyOutcome(state: BindingSyncState, outcome: SyncOutcome): BindingSyncState {
  if (outcome.kind === 'success') {
    return {
      status: 'OK',
      consecutiveFailures: 0,
      lastSyncedAt: outcome.at,
      lastErrorAt: state.lastErrorAt,
      lastErrorSummary: null,
    }
  }

  const consecutiveFailures = state.consecutiveFailures + 1
  return {
    // FAILED describes ONE job that did not finish; DEGRADED describes a league
    // in a bad state. Conflating them means a single 503 flags the league to the
    // operator, and they stop believing the flag.
    status: consecutiveFailures >= DEGRADE_AFTER_FAILURES ? 'DEGRADED' : 'FAILED',
    consecutiveFailures,
    lastSyncedAt: state.lastSyncedAt,
    lastErrorAt: outcome.at,
    // ⚠ THE SUMMARY, NEVER THE RAW ERROR. A provider error routinely embeds the
    // request URL, and the root CLAUDE.md records that Rolling Insights passes
    // its token as a query parameter. ProviderError has no field for a raw
    // message precisely so this cannot carry one.
    lastErrorSummary: outcome.error.summary,
  }
}

// ─── The derived status a caller acts on ─────────────────────────────────────

/**
 * What the binding's status ACTUALLY is right now.
 *
 * 🛑 NEVER READ `binding.status` DIRECTLY IN A DECISION. A stored column
 * describes the last thing that happened; it cannot describe nothing happening.
 * A provider that goes dark leaves `OK` in the column indefinitely.
 */
export function effectiveStatus(state: BindingSyncState, now: Date): SyncStatus {
  // Stored DEGRADED/FAILED/RUNNING/IDLE are all honest about themselves.
  if (state.status !== 'OK') return state.status

  // Stored OK, but never actually synced. A binding that has been created and
  // never run is not healthy, it is unproven.
  if (state.lastSyncedAt === null) return 'IDLE'

  const age = now.getTime() - state.lastSyncedAt.getTime()
  return age > FRESHNESS_WINDOW_MS ? 'DEGRADED' : 'OK'
}

export function isDegraded(state: BindingSyncState, now: Date): boolean {
  return effectiveStatus(state, now) === 'DEGRADED'
}

/** Why, in words an operator can act on. Empty when healthy. */
export function degradedReason(state: BindingSyncState, now: Date): string | null {
  if (!isDegraded(state, now)) return null

  if (state.status === 'DEGRADED') {
    return state.lastErrorSummary
      ? `Sync has failed ${state.consecutiveFailures} times in a row: ${state.lastErrorSummary}`
      : `Sync has failed ${state.consecutiveFailures} times in a row.`
  }

  const hours = state.lastSyncedAt
    ? Math.floor((now.getTime() - state.lastSyncedAt.getTime()) / (60 * 60 * 1000))
    : null
  // Names STALENESS explicitly rather than reporting a generic failure — the
  // operator's next question is "did it break or did it stop", and those have
  // different answers.
  return hours === null
    ? 'This league has never synced.'
    : `This league has not synced for ${hours} hours, so its data cannot be trusted as current.`
}

// ─── Read-only enforcement ───────────────────────────────────────────────────

/**
 * Actions whose correctness depends on external state being current.
 *
 * ⚠ A DELIBERATELY SHORT LIST, AND NOT "EVERY WRITE". A degraded league must
 * stay usable for the things that do not depend on the provider — renaming it,
 * reading it, exporting it. Freezing everything would make a provider outage
 * into an outage of our own product, which is the opposite of graceful.
 *
 * What is here is what would be WRONG if the underlying data is stale: advancing
 * a phase on rosters that may have changed, and reconciling against a provider
 * we cannot currently reach.
 */
export const EXTERNALLY_DEPENDENT_ACTIONS: readonly ActionKey[] = [
  'league.phase.advance',
  'league.sync.reconcile',
]

export function dependsOnExternalState(action: ActionKey): boolean {
  return EXTERNALLY_DEPENDENT_ACTIONS.includes(action)
}

/**
 * Refuse an externally-dependent write while the binding is degraded.
 *
 * ⚠ INVARIANT rather than a new DomainError variant. A degraded integration is
 * not a phase problem, not a permission problem and not a race — it is a domain
 * rule ("do not act on data we cannot vouch for"), which is what INVARIANT is
 * for. It maps to 422, and the detail carries the operator-facing reason from
 * `degradedReason` rather than a generic string, so the refusal explains itself
 * per CLAUDE.md's "refusals that explain themselves".
 */
export function guardExternalWrite(
  action: ActionKey,
  state: BindingSyncState,
  now: Date,
): Result<void, DomainError> {
  if (!dependsOnExternalState(action)) return ok(undefined)
  if (!isDegraded(state, now)) return ok(undefined)

  return err(
    invariant(
      'sync.degraded',
      `${degradedReason(state, now)} "${action}" depends on that data, so it is refused until sync recovers. Reads and export are unaffected.`,
    ),
  )
}

// ─── The API projection ──────────────────────────────────────────────────────

export type SyncHealthView = {
  readonly bindingId: string
  readonly provider: string
  /** The DERIVED status. Never the stored column. */
  readonly status: SyncStatus
  readonly degraded: boolean
  readonly reason: string | null
  readonly lastSyncedAt: string | null
  readonly consecutiveFailures: number
  /** What the operator cannot currently do, so a UI need not re-derive it. */
  readonly blockedActions: readonly ActionKey[]
}

/**
 * The state exposed on the API. T-204's acceptance asserts on this.
 *
 * ⚠ IT REPORTS THE DERIVED STATUS, and that is the point of the whole file. A
 * projection that returned `binding.status` would show OK for a league whose
 * provider went dark in January — "stale-as-live", in exactly the words the
 * ticket forbids.
 *
 * ⚠ AND IT CARRIES NO `lastErrorSummary` VERBATIM INTO `reason` WITHOUT CONTEXT.
 * `degradedReason` wraps it, so an operator reading the API sees what it means
 * rather than a provider's own phrasing.
 */
export function syncHealthView(
  binding: { id: string; provider: string } & BindingSyncState,
  now: Date,
): SyncHealthView {
  const status = effectiveStatus(binding, now)
  const degraded = status === 'DEGRADED'
  return {
    bindingId: binding.id,
    provider: binding.provider,
    status,
    degraded,
    reason: degradedReason(binding, now),
    lastSyncedAt: binding.lastSyncedAt ? binding.lastSyncedAt.toISOString() : null,
    consecutiveFailures: binding.consecutiveFailures,
    blockedActions: degraded ? EXTERNALLY_DEPENDENT_ACTIONS : [],
  }
}
