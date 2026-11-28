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
 * `src` (e.g. `recap`) rides along so the join is still counted against where the link came from, and
 * `team` (a seat-specific link) so signing in does not lose which team the person was invited to take.
 */
export function joinCallbackUrl(code: string, src?: string | null, team?: string | null): string {
  const tag = inviteSource(src) ? `&src=${src}` : ''
  const seat = inviteSeat(team) ? `&team=${team}` : ''
  return `/join?code=${encodeURIComponent(code)}&go=1${tag}${seat}`
}

/** The `src` of an invite link, if it is a plain tag; anything else is dropped rather than recorded. */
export function inviteSource(raw: string | null | undefined): string | null {
  return raw && /^[a-z0-9_-]{1,32}$/i.test(raw) ? raw : null
}

/**
 * The `team` of a seat-specific invite link (a `Roster.id`, uuid or cuid), if it looks like one; anything else is
 * dropped, and the join falls back to the league's ordinary team assignment.
 */
export function inviteSeat(raw: string | null | undefined): string | null {
  return raw && /^[a-z0-9_-]{8,64}$/i.test(raw) ? raw : null
}

/** A link that invites someone to take one specific open team: the league's invite link plus `team=<Roster.id>`. */
export function seatInviteUrl(leagueInviteUrl: string, rosterId: string): string {
  const separator = leagueInviteUrl.includes('?') ? '&' : '?'
  return `${leagueInviteUrl}${separator}team=${encodeURIComponent(rosterId)}`
}
