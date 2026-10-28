/**
 * Every team's future draft picks on one screen (phase 6 of the self-running dynasty plan, 2026-10-27).
 *
 * The data already existed for every team — the Trade Center offers any team's picks — but the only
 * view was the viewer's own list (`/dynasty-hub`). A dynasty manager plans a trade by asking "who holds
 * the 2027 firsts?", and that answer was nowhere.
 *
 * Pure: the loader (`./leaguePickBoardService.ts`) reads the league's pick inventory — the same one
 * the Trade Center and the next rookie draft use — and this groups it by team and draft year.
 */
import { roundOrdinal } from '@/lib/league-trade-engine/futurePickInventory'

/** One pick, in `Roster.id` space. An original team with no roster here keeps the provider id. */
export type BoardPickInput = { season: number; round: number; ownerRosterId: string; originalRosterId: string }

/**
 * `complete`: every pick in the upcoming drafts is listed.
 * `traded_only`: the league's rookie-draft size is unknown, so only picks that changed hands are.
 */
export type PickBoardCoverage = 'complete' | 'traded_only'

export type BoardPick = {
  season: number
  round: number
  label: string
  /** The team it came from, when it is not this team's own pick. */
  fromTeam: string | null
}

export type BoardTeam = {
  rosterId: string
  name: string
  isViewer: boolean
  /** Picks this team holds, by season, earliest round first. */
  bySeason: Record<number, BoardPick[]>
  /** This team's own picks another team now holds, by season. */
  tradedAwayBySeason: Record<number, Array<{ round: number; label: string; toTeam: string }>>
  total: number
  firsts: number
}

export type LeaguePickBoard = {
  seasons: number[]
  rounds: number | null
  coverage: PickBoardCoverage
  teams: BoardTeam[]
}

export function buildLeaguePickBoard(args: {
  teams: ReadonlyArray<{ rosterId: string; name: string }>
  picks: readonly BoardPickInput[]
  seasons: readonly number[]
  rounds: number | null
  coverage: PickBoardCoverage
  viewerRosterId: string | null
}): LeaguePickBoard {
  const nameOf = new Map(args.teams.map((t) => [t.rosterId, t.name]))
  const seasons = [...args.seasons].sort((a, b) => a - b)
  const inWindow = new Set(seasons)
  const teams: BoardTeam[] = args.teams.map((t) => ({
    rosterId: t.rosterId,
    name: t.name,
    isViewer: t.rosterId === args.viewerRosterId,
    bySeason: Object.fromEntries(seasons.map((s) => [s, [] as BoardPick[]])),
    tradedAwayBySeason: Object.fromEntries(seasons.map((s) => [s, [] as Array<{ round: number; label: string; toTeam: string }>])),
    total: 0,
    firsts: 0,
  }))
  const byId = new Map(teams.map((t) => [t.rosterId, t]))

  for (const p of args.picks) {
    if (!inWindow.has(p.season)) continue
    const holder = byId.get(p.ownerRosterId)
    if (!holder) continue
    const own = p.originalRosterId === p.ownerRosterId
    holder.bySeason[p.season]!.push({
      season: p.season,
      round: p.round,
      label: roundOrdinal(p.round),
      fromTeam: own ? null : nameOf.get(p.originalRosterId) ?? 'another team',
    })
    holder.total += 1
    if (p.round === 1) holder.firsts += 1
    const origin = own ? null : byId.get(p.originalRosterId)
    origin?.tradedAwayBySeason[p.season]!.push({ round: p.round, label: roundOrdinal(p.round), toTeam: holder.name })
  }
  for (const t of teams) {
    for (const s of seasons) {
      t.bySeason[s]!.sort((a, b) => a.round - b.round || (a.fromTeam ?? '').localeCompare(b.fromTeam ?? ''))
      t.tradedAwayBySeason[s]!.sort((a, b) => a.round - b.round)
    }
  }
  // The viewer first, then by most picks, so the teams loaded with capital stand out.
  teams.sort((a, b) => Number(b.isViewer) - Number(a.isViewer) || b.firsts - a.firsts || b.total - a.total || a.name.localeCompare(b.name))
  return { seasons, rounds: args.rounds, coverage: args.coverage, teams }
}
