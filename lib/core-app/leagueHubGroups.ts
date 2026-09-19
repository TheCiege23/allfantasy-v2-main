export type LeagueHub = { id: string; name: string; href?: string; members: Array<{ id: string; name: string; href: string; platform: string }> }

/** Called after filtering and urgency ranking: the first visible member owns the card. */
export function groupLeagueHubs<T extends { hub?: LeagueHub }>(leagues: T[]): T[] {
  const seen = new Set<string>()
  return leagues.filter((league) => {
    if (!league.hub) return true
    if (seen.has(league.hub.id)) return false
    seen.add(league.hub.id)
    return true
  })
}
