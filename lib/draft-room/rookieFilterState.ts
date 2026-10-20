/**
 * Whether a "rookies only" draft session's board filter could actually be applied.
 *
 * Pure and client-safe: the pool resolver computes it on the server, and the draft room reads it
 * back off the `/draft/pool` response to explain a rookies-only board that shows veterans.
 *
 * - `applied` — the session is rookies-only and the pool's rookie data covers the board, so it was
 *   narrowed to rookies.
 * - `partial_rookie_data` — MLB/NBA/NHL only: some players are proven NOT rookies by our stored
 *   season stats and were removed (and are refused at pick time), but most players' status is
 *   unknown, so they stay on the board unchecked. The draft room says so.
 * - `fallback_no_rookie_data` — the session is rookies-only but NO entry carries rookie data, so
 *   the full pool is kept rather than an empty board.
 * - `not_requested` — the session's pool is not rookies-only.
 */
export type RookieFilterState = 'applied' | 'partial_rookie_data' | 'fallback_no_rookie_data' | 'not_requested'

const ROOKIE_FILTER_STATES: ReadonlySet<string> = new Set<RookieFilterState>([
  'applied',
  'partial_rookie_data',
  'fallback_no_rookie_data',
  'not_requested',
])

/** Set by the pool resolver from stored season stats (`seasonStatsRookieStatus.ts`), MLB/NBA/NHL only. */
export type EntryRookieVerdict = 'rookie' | 'not_rookie' | 'unknown'

export type RookieFilterEntryLike = { isRookie?: boolean | null; rookieVerdict?: EntryRookieVerdict | null }

/**
 * True when the pool carries three-state verdicts. Then an entry WITHOUT a rookie flag is
 * `unknown`, not a veteran. Every other pool keeps the old two-state reading, where a missing flag
 * means "not a rookie" (an NFL pool flags every rookie it knows of from Sleeper's `years_exp`).
 */
export function hasRookieVerdicts(entries: ReadonlyArray<RookieFilterEntryLike>): boolean {
  return entries.some((e) => e.rookieVerdict != null)
}

/** A verdict-pool entry's status: its own verdict, else a rookie flag from elsewhere (devy), else unknown. */
export function entryRookieVerdict(entry: RookieFilterEntryLike): EntryRookieVerdict {
  if (entry.rookieVerdict === 'rookie' || entry.rookieVerdict === 'not_rookie') return entry.rookieVerdict
  return entry.isRookie === true ? 'rookie' : 'unknown'
}

export function resolveRookieFilterState(
  entries: ReadonlyArray<RookieFilterEntryLike>,
  session: { playerPool?: string | null } | null | undefined,
): RookieFilterState {
  if (String(session?.playerPool ?? '').toLowerCase() !== 'rookies_only') return 'not_requested'
  if (!hasRookieVerdicts(entries)) {
    return entries.some((e) => e.isRookie === true) ? 'applied' : 'fallback_no_rookie_data'
  }
  let known = 0
  let unknown = 0
  for (const e of entries) {
    if (entryRookieVerdict(e) === 'unknown') unknown += 1
    else known += 1
  }
  if (known === 0) return 'fallback_no_rookie_data'
  return unknown === 0 ? 'applied' : 'partial_rookie_data'
}

/** Read the field off an API payload; anything unrecognised (including an old cached payload) is `undefined`. */
export function parseRookieFilterState(value: unknown): RookieFilterState | undefined {
  return typeof value === 'string' && ROOKIE_FILTER_STATES.has(value) ? (value as RookieFilterState) : undefined
}
