/** Validate provider bracket wiring before assigning any CFP game to an AllFantasy slot. */
export function mapOfficialCfpGames(payload: unknown): Array<{ seriesNumber: number; startsAt: string; label: string; venue: string; location: string }> | null {
  const rounds = (payload as { rounds?: unknown } | null)?.rounds
  if (!Array.isArray(rounds)) return null
  type Slot = { seed?: number | null; source?: { matchupId?: number | null } | null }
  type Game = { id?: number; startDate?: string; bowlName?: string | null; slots?: Slot[]; game?: { venue?: string | null } | null }
  const rows = new Map<string, Game[]>()
  for (const round of rounds as Array<{ code?: string; matchups?: Game[] }>) {
    if (!round.code || rows.has(round.code) || !Array.isArray(round.matchups)) return null
    rows.set(round.code, round.matchups)
  }
  const first = rows.get("first_round"), quarters = rows.get("quarterfinal"), semis = rows.get("semifinal"), final = rows.get("championship")
  if (first?.length !== 4 || quarters?.length !== 4 || semis?.length !== 2 || final?.length !== 1) return null
  const all = [...first, ...quarters, ...semis, ...final]
  if (all.some(g => !Number.isInteger(g.id) || !Array.isArray(g.slots) || g.slots.length !== 2) || new Set(all.map(g => g.id)).size !== 11) return null
  const same = (a: number[], b: number[]) => a.length === b.length && a.slice().sort((x, y) => x-y).every((n, i) => n === b.slice().sort((x, y) => x-y)[i])
  const matching = (games: Game[], predicate: (game: Game) => boolean): Game | undefined => {
    const found = games.filter(predicate)
    return found.length === 1 ? found[0] : undefined
  }
  const seeds = (game: Game) => game.slots!.map(s => s.seed).filter((x): x is number => Number.isInteger(x))
  const sources = (game: Game) => game.slots!.map(s => s.source?.matchupId).filter((x): x is number => Number.isInteger(x))
  const ordered: Array<Game | undefined> = [[8,9],[5,12],[7,10],[6,11]].map(pair => matching(first, game => same(seeds(game), pair) && sources(game).length === 0))
  if (ordered.some(g => !g)) return null
  for (const [index, bye] of [1,4,2,3].entries()) {
    const source = ordered[index]!.id!
    ordered.push(matching(quarters, game => same(seeds(game), [bye]) && same(sources(game), [source])))
  }
  if (ordered.some(g => !g)) return null
  ordered.push(matching(semis, game => seeds(game).length === 0 && same(sources(game), [ordered[4]!.id!, ordered[5]!.id!])))
  ordered.push(matching(semis, game => seeds(game).length === 0 && same(sources(game), [ordered[6]!.id!, ordered[7]!.id!])))
  if (ordered.some(g => !g)) return null
  ordered.push(matching(final, game => seeds(game).length === 0 && same(sources(game), [ordered[8]!.id!, ordered[9]!.id!])))
  if (ordered.some(g => !g) || new Set(ordered.map(g => g!.id)).size !== 11) return null
  const result = ordered.map((game, i) => {
    const startsAt = game!.startDate || ""
    const label = game!.bowlName?.trim() || (i < 4 ? "CFP First Round" : i < 8 ? "CFP Quarterfinal" : i < 10 ? "CFP Semifinal" : "CFP National Championship")
    return { seriesNumber: i + 1, startsAt, label, venue: game!.game?.venue?.trim() || "Venue TBA", location: "Location TBA" }
  })
  if (result.some(game => !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(game.startsAt) || !Number.isFinite(Date.parse(game.startsAt)))) return null
  return result
}
