/** Use the canonical production host for shared links; retain the origin on staging. */
export function bracketInviteUrl(origin: string, leagueId: string, code?: string | null): string {
  const source = new URL(origin)
  const targetOrigin = source.hostname === "www.allfantasy.ai" || source.hostname === "allfantasy.ai"
    ? "https://www.allfantasy.ai"
    : source.origin
  const url = new URL(`/brackets/leagues/${encodeURIComponent(leagueId)}`, targetOrigin)
  if (code) url.searchParams.set("code", code)
  return url.toString()
}
