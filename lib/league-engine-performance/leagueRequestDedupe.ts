/**
 * League-scoped in-flight deduplication for API routes (same process).
 * Delegates to `dedupeInFlight` — concurrent identical keys share one backend call.
 *
 * Use for: waiver POST bursts, matchup-center polling storms, commissioner double-clicks.
 * For cross-process exclusivity use PostgreSQL advisory locks + idempotency keys.
 */

import 'server-only'

import { dedupeInFlight } from '@/lib/api-performance/dedupe'

function leagueRequestDedupeKey(parts: {
  leagueId: string
  surface: string
  /** e.g. season, week, userId — omit when not part of cache identity */
  fragments?: (string | number | null | undefined)[]
}): string {
  const tail = (parts.fragments ?? [])
    .map((x) => (x == null || x === '' ? '-' : String(x)))
    .join(':')
  return `leagueReq:${parts.leagueId}:${parts.surface}:${tail}`
}

export async function dedupeLeagueRequest<T>(
  parts: Parameters<typeof leagueRequestDedupeKey>[0],
  fn: () => Promise<T>,
): Promise<T> {
  return dedupeInFlight(leagueRequestDedupeKey(parts), fn)
}
