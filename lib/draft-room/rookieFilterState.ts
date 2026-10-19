/**
 * Whether a "rookies only" draft session's board filter could actually be applied.
 *
 * Pure and client-safe: the pool resolver computes it on the server, and the draft room reads it
 * back off the `/draft/pool` response to explain a rookies-only board that shows veterans.
 *
 * - `applied` — the session is rookies-only and at least one entry is flagged a rookie, so the
 *   board was narrowed to rookies.
 * - `fallback_no_rookie_data` — the session is rookies-only but NO entry carries a rookie flag
 *   (common for MLB/NBA/NHL today), so the full pool is kept rather than an empty board.
 * - `not_requested` — the session's pool is not rookies-only.
 */
export type RookieFilterState = 'applied' | 'fallback_no_rookie_data' | 'not_requested'

const ROOKIE_FILTER_STATES: ReadonlySet<string> = new Set<RookieFilterState>([
  'applied',
  'fallback_no_rookie_data',
  'not_requested',
])

export function resolveRookieFilterState(
  entries: ReadonlyArray<{ isRookie?: boolean | null }>,
  session: { playerPool?: string | null } | null | undefined,
): RookieFilterState {
  if (String(session?.playerPool ?? '').toLowerCase() !== 'rookies_only') return 'not_requested'
  return entries.some((e) => e.isRookie === true) ? 'applied' : 'fallback_no_rookie_data'
}

/** Read the field off an API payload; anything unrecognised (including an old cached payload) is `undefined`. */
export function parseRookieFilterState(value: unknown): RookieFilterState | undefined {
  return typeof value === 'string' && ROOKIE_FILTER_STATES.has(value) ? (value as RookieFilterState) : undefined
}
