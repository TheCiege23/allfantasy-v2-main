import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { isRegularSeason } from './sportsWeek'

/**
 * Which weeks your players are on bye, and where they stack up.
 *
 * The single most common unforced error in fantasy is starting a player whose
 * team is not playing. It is entirely preventable and nothing on this screen
 * warned about it. The second most common is discovering in week 6 that four
 * starters share a week 7 bye, at which point the waiver wire has already been
 * picked over.
 *
 * ⚠ A BYE IS AN ABSENCE, AND ABSENCE OF EVIDENCE IS NOT IT. A team with no row
 * for week 7 is on bye ONLY IF the schedule for week 7 is otherwise complete.
 * If ingestion is partial, "no game found" means we did not look hard enough,
 * and telling someone their RB1 is on bye when he is playing is worse than
 * saying nothing. So this refuses to answer unless the week it is judging
 * carries a plausible full slate.
 */

/** An NFL week is 13-16 fixtures; byes reduce it, never below about 13. */
const MIN_PLAUSIBLE_SLATE = 12

export type ByeInfo = {
  /** Week -> the roster's players (by sleeperId) who are off that week. */
  byWeek: Map<number, string[]>
  /** Weeks the schedule could actually be judged. */
  weeksCovered: number[]
  season: number
}

export async function getByeWeeks(args: {
  sport: string
  season: number
  /** sleeperId -> team abbreviation, for the players we care about. */
  playerTeams: Map<string, string | null>
  /** Only look at this week and later; earlier byes are history. */
  fromWeek: number
  /** How many weeks ahead to consider. */
  horizon?: number
}): Promise<ByeInfo | null> {
  const { sport, season, playerTeams, fromWeek } = args
  const horizon = args.horizon ?? 6

  const teams = new Set<string>()
  for (const t of playerTeams.values()) {
    const n = normalizeTeamAbbrev(t)
    if (n) teams.add(n)
  }
  if (teams.size === 0) return null

  const games = await prisma.sportsGame
    .findMany({
      where: {
        sport,
        season,
        week: { gte: fromWeek, lte: fromWeek + horizon },
      },
      select: { homeTeam: true, awayTeam: true, week: true, seasonType: true },
    })
    .catch(() => [])

  if (games.length === 0) return null

  /** week -> set of teams playing, counting distinct fixtures for the gate. */
  const playing = new Map<number, Set<string>>()
  const fixtureKeys = new Map<number, Set<string>>()

  for (const g of games) {
    // Preseason byes are meaningless — everybody sits somebody.
    if (!isRegularSeason(g.seasonType)) continue
    if (g.week == null) continue
    const home = normalizeTeamAbbrev(g.homeTeam)
    const away = normalizeTeamAbbrev(g.awayTeam)
    if (!home || !away) continue

    let set = playing.get(g.week)
    if (!set) {
      set = new Set()
      playing.set(g.week, set)
    }
    set.add(home)
    set.add(away)

    // The same fixture arrives once per provider; dedupe before counting the
    // slate, or a four-source week looks twice as complete as it is.
    let keys = fixtureKeys.get(g.week)
    if (!keys) {
      keys = new Set()
      fixtureKeys.set(g.week, keys)
    }
    keys.add([home, away].sort().join('@'))
  }

  const byWeek = new Map<number, string[]>()
  const weeksCovered: number[] = []

  for (const [week, teamsPlaying] of [...playing.entries()].sort((a, b) => a[0] - b[0])) {
    /*
     * ⚠ THE COMPLETENESS GATE. Without it, a partially ingested week reports
     * every unlisted team as on bye — which on this repo's schedule data would
     * have flagged most of a roster.
     */
    if ((fixtureKeys.get(week)?.size ?? 0) < MIN_PLAUSIBLE_SLATE) continue
    weeksCovered.push(week)

    const off: string[] = []
    for (const [sleeperId, team] of playerTeams) {
      const n = normalizeTeamAbbrev(team)
      if (!n) continue
      if (!teamsPlaying.has(n)) off.push(sleeperId)
    }
    if (off.length > 0) byWeek.set(week, off)
  }

  if (weeksCovered.length === 0) return null
  return { byWeek, weeksCovered, season }
}
