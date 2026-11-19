/**
 * The standings of a league that plays on AllFantasy, from its own season.
 *
 * 🛑 THE STANDINGS TAB WAS EMPTY FOR EVERY POINTS LEAGUE THAT PLAYS HERE. The route read
 * `fantasyStanding` for the records and kept only teams with a final `teamWeekResult` row. For a
 * native league the season engine (`lib/redraft/standingsEngine.ts`) writes records to
 * `RedraftRoster`; it writes `fantasyStanding` only for category and rotisserie leagues, and it writes
 * `teamWeekResult` only for rotisserie. So a points league 14 weeks in showed "Standings appear once
 * the first week is scored", and a head-to-head category league showed the same.
 *
 * This is the pure half: the table, from the season's rosters and its final games. Records, points
 * and streak are the ones the season engine stored; nothing is recomputed except all-play, which is
 * derived from the same final scores the engine counted.
 */
import { computeAllPlay, formatAllPlay, type WeekResultInput } from './seasonForm'

export type NativeSeasonRoster = {
  id: string
  ownerName: string
  teamName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  streak: string | null
  playoffSeed: number | null
}

export type NativeFinalGame = { week: number; homeRosterId: string; awayRosterId: string; homeScore: number; awayScore: number }

export type NativeStandingRow = {
  rosterId: string
  teamName: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  rank: number
  playoffSeed: number | null
  categoryWinsFor: number
  categoryLossesFor: number
  categoryTiesFor: number
  streak: string
  allPlay: string
}

const pct = (r: { wins: number; losses: number; ties: number }) => {
  const played = r.wins + r.losses + r.ties
  return played > 0 ? (r.wins + r.ties * 0.5) / played : 0
}

/**
 * One score per team per week for all-play. A team that plays several games in a week carries the same
 * weekly score into each of them, so it is counted once, not once per game.
 */
export function weeklyScoresFromGames(games: readonly NativeFinalGame[]): WeekResultInput[] {
  const seen = new Set<string>()
  const out: WeekResultInput[] = []
  const add = (week: number, rosterId: string, totalPoints: number) => {
    const key = `${week}|${rosterId}`
    if (seen.has(key)) return
    seen.add(key)
    // `computeAllPlay` skips a row with no outcome; the outcome itself is not read.
    out.push({ week, rosterId, totalPoints, winLoss: 'W' })
  }
  for (const g of games) {
    add(g.week, g.homeRosterId, g.homeScore)
    add(g.week, g.awayRosterId, g.awayScore)
  }
  return out
}

/**
 * The standings table. Empty until a game has gone final, so an unplayed season shows the screen's
 * "appear once the first week is scored" state rather than a table of 0-0 teams.
 *
 * `idFor` maps a season roster to the id the rest of the league page uses for that team; `nameFor`
 * gives its label there, falling back to the season roster's own name.
 */
export function buildNativeStandings(args: {
  rosters: readonly NativeSeasonRoster[]
  finalGames: readonly NativeFinalGame[]
  idFor: (seasonRosterId: string) => string
  nameFor: (leagueRosterId: string) => string | null | undefined
  /** Category wins already stored for a category league, keyed by the league-page roster id. */
  categoryRecord?: ReadonlyMap<string, { wins: number; losses: number; ties: number }>
  /** False for a category league: all-play on "categories won" is not a schedule-luck measure. */
  allPlay: boolean
}): { standings: NativeStandingRow[]; scoredWeeks: number } {
  const scoredWeeks = new Set(args.finalGames.map((g) => g.week)).size
  const anyRecord = args.rosters.some((r) => r.wins + r.losses + r.ties > 0)
  if (scoredWeeks === 0 && !anyRecord) return { standings: [], scoredWeeks: 0 }

  const allPlay = args.allPlay ? computeAllPlay(weeklyScoresFromGames(args.finalGames)) : new Map()
  // The season engine's own order when it has one; record, then points for, where it has not seeded yet.
  const ordered = [...args.rosters].sort(
    (a, b) =>
      (a.playoffSeed ?? Number.MAX_SAFE_INTEGER) - (b.playoffSeed ?? Number.MAX_SAFE_INTEGER) ||
      pct(b) - pct(a) ||
      b.pointsFor - a.pointsFor ||
      a.id.localeCompare(b.id),
  )
  const standings = ordered.map((r, index): NativeStandingRow => {
    const rosterId = args.idFor(r.id)
    const category = args.categoryRecord?.get(rosterId)
    return {
      rosterId,
      teamName: args.nameFor(rosterId)?.trim() || r.teamName?.trim() || r.ownerName?.trim() || 'Team',
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      rank: index + 1,
      playoffSeed: r.playoffSeed,
      categoryWinsFor: category?.wins ?? 0,
      categoryLossesFor: category?.losses ?? 0,
      categoryTiesFor: category?.ties ?? 0,
      streak: r.streak?.trim() || '—',
      allPlay: args.allPlay ? formatAllPlay(allPlay.get(r.id)) : '—',
    }
  })
  return { standings, scoredWeeks }
}
