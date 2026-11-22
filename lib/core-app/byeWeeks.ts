import 'server-only'

import { prisma } from '@/lib/prisma'
import { getTeamInfo, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { resolveCollegeTeam } from '@/lib/sport-teams/collegeTeamIdentity'
import { loadCollegeTeamIndex } from '@/lib/sport-teams/collegeTeamIndexStore'
import { resolveFantraxCollegeTeam } from '@/lib/sport-teams/fantraxCollegeTeam'
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
 *
 * 🛑 AND A NAME THE SCHEDULE DOES NOT RECOGNISE IS NOT A TEAM THAT IS OFF.
 * Both sides used to go through `normalizeTeamAbbrev`, which is NFL-only: for
 * anything else it returns the input uppercased. Measured 2026-10-30 on the one
 * college league (Fantrax): the roster carried "University of South Florida",
 * the week's rows carried "South Florida" (cfbd, thesportsdb) and "SOUTH
 * FLORIDA" (api_sports) for USF vs UAB on Oct 31 — and with ~150 college
 * fixtures the 12-game gate passed trivially, so every starter whose spelling
 * differed from the feed's was told to bench a player who had a game. Two rules
 * now hold:
 *
 *   1. College football folds both sides through the CFBD directory (the same
 *      join `collegeNextGame.ts` uses). No directory, no answer.
 *   2. A player's team is only judged once the schedule has shown it knows that
 *      team — a canonical NFL club, or seen playing in some covered week. An
 *      unrecognised spelling stays silent instead of reading as a bye.
 */

/** An NFL week is 13-16 fixtures; byes reduce it, never below about 13. */
export const MIN_PLAUSIBLE_SLATE = 12

/**
 * A college Saturday is ~60 FBS fixtures and more with FCS, so the NFL's twelve
 * would call a sliver of an ingested week complete.
 */
export const MIN_PLAUSIBLE_COLLEGE_SLATE = 40

const COLLEGE_FOOTBALL = new Set(['NCAAF', 'NCAAFB', 'CFB'])

export type ByeInfo = {
  /** Week -> the roster's players (by sleeperId) who are off that week. */
  byWeek: Map<number, string[]>
  /** Weeks the schedule could actually be judged. */
  weeksCovered: number[]
  season: number
}

type Fold = {
  /** A roster's team string -> the key the schedule is compared on. */
  player: (team: string | null | undefined) => string | null
  /** A schedule row's team string -> the same key space. */
  feed: (team: string | null | undefined) => string | null
  /** Whether a key names a team without having to see it on the schedule. */
  canonical: (key: string) => boolean
  minSlate: number
}

async function foldFor(sport: string): Promise<Fold | null> {
  if (COLLEGE_FOOTBALL.has(sport.trim().toUpperCase())) {
    const index = await loadCollegeTeamIndex().catch(() => null)
    if (!index) return null
    return {
      // Fantrax's short codes are scoped to the roster side on purpose — see fantraxCollegeTeam.ts.
      player: (team) => (team ? resolveFantraxCollegeTeam(team, index)?.school ?? null : null),
      feed: (team) => resolveCollegeTeam(team, index)?.school ?? null,
      canonical: () => false,
      minSlate: MIN_PLAUSIBLE_COLLEGE_SLATE,
    }
  }
  return {
    player: normalizeTeamAbbrev,
    feed: normalizeTeamAbbrev,
    canonical: (key) => getTeamInfo(key) != null,
    minSlate: MIN_PLAUSIBLE_SLATE,
  }
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

  const fold = await foldFor(sport)
  if (!fold) return null

  const teams = new Set<string>()
  for (const t of playerTeams.values()) {
    const n = fold.player(t)
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
    const home = fold.feed(g.homeTeam)
    const away = fold.feed(g.awayTeam)
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
  const covered: Array<[number, Set<string>]> = []

  for (const [week, teamsPlaying] of [...playing.entries()].sort((a, b) => a[0] - b[0])) {
    /*
     * ⚠ THE COMPLETENESS GATE. Without it, a partially ingested week reports
     * every unlisted team as on bye — which on this repo's schedule data would
     * have flagged most of a roster.
     */
    if ((fixtureKeys.get(week)?.size ?? 0) < fold.minSlate) continue
    weeksCovered.push(week)
    covered.push([week, teamsPlaying])
  }

  if (weeksCovered.length === 0) return null

  // Every team the judged schedule shows playing at least once — see rule 2 above.
  const seen = new Set<string>()
  for (const [, teamsPlaying] of covered) for (const t of teamsPlaying) seen.add(t)

  for (const [week, teamsPlaying] of covered) {
    const off: string[] = []
    for (const [sleeperId, team] of playerTeams) {
      const n = fold.player(team)
      if (!n) continue
      if (!seen.has(n) && !fold.canonical(n)) continue
      if (!teamsPlaying.has(n)) off.push(sleeperId)
    }
    if (off.length > 0) byWeek.set(week, off)
  }

  return { byWeek, weeksCovered, season }
}
