/**
 * How many leagues an account has connected, for the Chimmy card's zero-league state.
 *
 * ⚠ A PLAIN MODULE ON PURPOSE. This lived in `Dashboard3A.tsx`, which is `'use client'`, and the
 * server component `HomeCards` called it — Next.js turns every export of a client module into a
 * client reference, so the call threw "Attempted to call connectedLeagueCount() from the server" on
 * every Core home render and the Chimmy card never drew. A pure helper both sides need lives here.
 */
/**
 * 0 only when the account has nothing connected: no current league AND no past season imported.
 * `dash34` returns `totalLeagues: 0` whenever no league has a unified record, even for an account
 * holding past seasons (`legacyCount`) — that account is not "no leagues connected".
 */
export function connectedLeagueCount(
  d: { totalLeagues?: number | null; legacyCount?: number | null } | null | undefined,
): number | null {
  if (!d || d.totalLeagues == null) return null
  return d.totalLeagues + Math.max(0, d.legacyCount ?? 0)
}
