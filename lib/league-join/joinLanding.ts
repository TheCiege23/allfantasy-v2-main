/**
 * Where a successful `/join?code=` lands. An imported league is joined as a member (no team is
 * taken — see POST /api/leagues/join), and what that member came for is the league's conversation, so
 * they land IN it. A league created here keeps landing on its home, where the new team is.
 */
export function joinLandingHref(data: { leagueId: string; memberOnly?: boolean }): string {
  return data.memberOnly ? `/league/${data.leagueId}?openChat=league` : `/league/${data.leagueId}`
}

/**
 * Back to this same invite after signing in, set to join at once — one tap, not a second visit.
 * `src` (e.g. `recap`) rides along so the join is still counted against where the link came from.
 */
export function joinCallbackUrl(code: string, src?: string | null): string {
  const tag = inviteSource(src) ? `&src=${src}` : ''
  return `/join?code=${encodeURIComponent(code)}&go=1${tag}`
}

/** The `src` of an invite link, if it is a plain tag; anything else is dropped rather than recorded. */
export function inviteSource(raw: string | null | undefined): string | null {
  return raw && /^[a-z0-9_-]{1,32}$/i.test(raw) ? raw : null
}
