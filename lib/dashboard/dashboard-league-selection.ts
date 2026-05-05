/**
 * Merge dashboard URL/query league selection with optional route-provided active league id.
 * Route prop wins only when URL has no valid league param (e.g. embedded shells).
 */
export function mergeDashboardActiveLeagueId(args: {
  /** `searchParams.get('leagueId')` trimmed, or null */
  leagueIdFromUrl: string | null
  /** Leagues the user can access — invalid URL ids are ignored */
  validLeagueIds: ReadonlySet<string>
  /** Optional id from parent route (e.g. future /dashboard hybrid); usually null on /dashboard */
  routeActiveLeagueId?: string | null
}): string | null {
  const raw = args.leagueIdFromUrl?.trim() ?? ''
  if (raw && args.validLeagueIds.has(raw)) return raw
  const route = args.routeActiveLeagueId?.trim() ?? ''
  if (route && args.validLeagueIds.has(route)) return route
  return null
}
