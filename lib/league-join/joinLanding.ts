/**
 * Where a successful `/join?code=` lands. An imported league is joined as a member (no team is
 * taken — see POST /api/leagues/join), and what that member came for is the league's conversation, so
 * they land IN it. A league created here keeps landing on its home, where the new team is.
 */
export function joinLandingHref(data: { leagueId: string; memberOnly?: boolean }): string {
  return data.memberOnly ? `/league/${data.leagueId}?openChat=league` : `/league/${data.leagueId}`
}

/** Back to this same invite after signing in, set to join at once — one tap, not a second visit. */
export function joinCallbackUrl(code: string): string {
  return `/join?code=${encodeURIComponent(code)}&go=1`
}
