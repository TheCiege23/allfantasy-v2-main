/**
 * Per-resource fetch status — IMP-04.
 *
 * 🛑 AN EMPTY ARRAY ANSWERS TWO COMPLETELY DIFFERENT QUESTIONS, AND EVERY WRITER AND READER
 * DOWNSTREAM HAS BEEN GUESSING WHICH ONE IT GOT. Yahoo fetched team rosters with
 * `Promise.allSettled` and substituted empty player/starter/reserve arrays for a rejection;
 * Fleaflicker catches a failed roster fetch and substitutes an empty response. Both are
 * indistinguishable from a genuinely empty roster, so a transient timeout on one team of
 * twelve silently cleared a real roster and the league still reported itself fully current.
 *
 * The repair is to stop asking "is this list empty" and start asking "was this list
 * OBSERVED". Only an observation may replace stored data.
 */

/**
 * What actually happened when we asked the provider for one resource.
 *
 * ⚠ THE TWO AUTHORITATIVE STATES ARE SEPARATE FOR A REASON. `fetched_empty` is a real
 * observation — the provider was asked, answered, and the answer was "nobody". A pre-draft
 * league genuinely has empty rosters, and refusing to write that would freeze every league
 * at its import-day state. `fetched` and `fetched_empty` differ only so a reader can tell a
 * populated observation from an empty one without re-deriving it from array length.
 */
export type ResourceFetchStatus =
  /** Asked, answered, content returned. Authoritative. */
  | 'fetched'
  /** Asked, answered, genuinely nothing there. Authoritative. */
  | 'fetched_empty'
  /** Never requested on this run — out of scope, budgeted out, or short-circuited. */
  | 'not_fetched'
  /** The credential was rejected (401/403). Distinct from `failed`: a human must reconnect. */
  | 'unauthorized'
  /** Requested and errored — timeout, 5xx, throttle, malformed response. */
  | 'failed'
  /** A composite resource where some children were observed and some were not. */
  | 'partial'

/** The states that represent a real observation of the provider's current truth. */
const AUTHORITATIVE: ReadonlySet<ResourceFetchStatus> = new Set(['fetched', 'fetched_empty'])

/**
 * May data carrying this status REPLACE previously stored data?
 *
 * 🛑 THIS IS THE WHOLE RULE, AND IT IS DELIBERATELY THE ONLY PLACE IT IS WRITTEN. Every
 * writer that consumes a `NormalizedRoster` must ask this rather than re-deriving its own
 * version — the bug being fixed here is exactly what happens when several writers each
 * decide independently what an empty array means.
 *
 * ⚠ ABSENT MEANS AUTHORITATIVE, and that is a compatibility choice, not an oversight.
 * Adapters with no partial-failure mode do not set a status, and defaulting the other way
 * would make every one of them look unreliable — which trains readers to ignore the field,
 * which is how a guard stops guarding.
 */
export function isAuthoritativeStatus(status: ResourceFetchStatus | null | undefined): boolean {
  if (status == null) return true
  return AUTHORITATIVE.has(status)
}

/**
 * Is this resource's content KNOWN, whatever it turned out to be?
 *
 * The inverse of "incomplete". A surface that must distinguish "this manager has no players"
 * from "we could not read this manager's roster" asks this — never `player_ids.length === 0`.
 */
export function isKnownStatus(status: ResourceFetchStatus | null | undefined): boolean {
  return isAuthoritativeStatus(status)
}

/**
 * Short, non-identifying explanation for an operator or a UI badge.
 *
 * ⚠ NEVER INTERPOLATE PROVIDER DETAIL INTO THESE. They reach `lastError`, telemetry rows and
 * user-visible surfaces; a league name, manager identity or credential must not ride along.
 */
export function describeStatus(status: ResourceFetchStatus | null | undefined): string {
  switch (status) {
    case 'fetched':
      return 'Current as of the last successful read.'
    case 'fetched_empty':
      return 'Read successfully and confirmed empty.'
    case 'not_fetched':
      return 'Not requested on the last run.'
    case 'unauthorized':
      return 'The stored connection was rejected — reconnect required.'
    case 'failed':
      return 'The last read failed; showing the most recent good data.'
    case 'partial':
      return 'Partly read; some of this is the most recent good data.'
    default:
      return 'Current as of the last successful read.'
  }
}

/**
 * Roll a set of child statuses into the parent's.
 *
 * Order matters: any unobserved child makes a fully-observed-looking parent `partial`, and a
 * parent with NO observed children is not `partial` but the failure itself — reporting
 * "partly read" when nothing was read is the same false-green in miniature.
 */
export function rollUpStatus(children: readonly ResourceFetchStatus[]): ResourceFetchStatus {
  if (children.length === 0) return 'not_fetched'

  const authoritative = children.filter((c) => AUTHORITATIVE.has(c))
  if (authoritative.length === children.length) {
    return children.every((c) => c === 'fetched_empty') ? 'fetched_empty' : 'fetched'
  }
  if (authoritative.length === 0) {
    /* Nothing was observed. Surface the most actionable reason rather than "partial". */
    if (children.some((c) => c === 'unauthorized')) return 'unauthorized'
    if (children.some((c) => c === 'failed')) return 'failed'
    return 'not_fetched'
  }
  return 'partial'
}

/**
 * Provenance for one observed (or unobserved) resource.
 *
 * ⚠ NO MIGRATION IS REQUIRED TO PERSIST THIS. `Roster.playerData` is a `Json` column, so the
 * observation record rides inside the payload the writers already store. A dedicated column
 * would be nicer to query and is worth proposing later; it is not worth blocking a
 * correctness fix on a schema change.
 */
export interface ResourceObservation {
  status: ResourceFetchStatus
  /** When this status was determined — ISO 8601. */
  observedAt: string
  /**
   * When the data currently stored was last actually observed. Equals `observedAt` for an
   * authoritative read; on a preserved write it stays at the older successful read, which is
   * precisely the number a "last updated" badge must show rather than "now".
   */
  lastGoodAt?: string | null
}

export function buildObservation(
  status: ResourceFetchStatus,
  now: Date,
  previousLastGoodAt?: string | null,
): ResourceObservation {
  const iso = now.toISOString()
  return {
    status,
    observedAt: iso,
    lastGoodAt: isAuthoritativeStatus(status) ? iso : (previousLastGoodAt ?? null),
  }
}
