type SearchableGame = {
  status?: string | null
  statusDetail?: string | null
  home: { name: string; abbrev: string }
  away: { name: string; abbrev: string }
  topPerformer?: { name?: string | null } | null
  tieIns: Array<{ playerName: string; leagueName: string }>
}

export function matchesLiveGameQuery(game: SearchableGame, query: string): boolean {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return true
  const values = [
    game.home.name,
    game.home.abbrev,
    game.away.name,
    game.away.abbrev,
    game.status,
    game.statusDetail,
    game.topPerformer?.name,
    ...game.tieIns.flatMap((tie) => [tie.playerName, tie.leagueName]),
  ]
  return values.some((value) => String(value ?? '').toLocaleLowerCase().includes(term))
}
