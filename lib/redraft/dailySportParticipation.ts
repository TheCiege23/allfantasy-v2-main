/**
 * Why a daily-sport (NBA / NHL / MLB) starter has no game row in a week — and whether that is a real 0
 * or missing data. The daily-sport twin of `ncaafWeekParticipation.ts`.
 *
 * 🛑 THE ROLLING INSIGHTS BOX LISTS ONLY PLAYERS WHO DRESSED. A healthy scratch, a player in the minors,
 * an injured starter and a retired man still on a fantasy roster all produce NO row — and so does a game
 * the ingest never brought in. The weekly sync treated all of them as "missing", and the finalizer counts
 * a missing starter against its 80% coverage floor. Measured on production 2026-10-25 for the one live
 * NHL redraft league: 19 of its 39 starters are `INACT` in PlayerIdentityMap with no game all season,
 * and coverage sat at 0.26 with every other fix in place. The week could never seal over zeros.
 *
 * So a starter with no row in the window is:
 *   inactive      his identity is `INACT`                                         -> a real 0
 *   no_stat       every game his pro team played in the window is final, and the
 *                 ingest has rows for that team on each of those days              -> a real 0
 *   pending       a game of his team in the window is not final yet               -> missing (wait)
 *   not_ingested  a final game of his team has no ingested row for the team       -> missing (a data gap:
 *                 exactly what the coverage floor exists to catch)
 *   no_games      his team has no game in the window, or none we can see          -> missing (cannot tell)
 *   unmatched     no team, or no schedule for the sport                            -> missing
 *   no_identity   the roster id reaches no PlayerIdentityMap row                   -> missing
 *
 * ⚠ `no_games` IS MISSING, NOT A BYE, UNLIKE NCAAF. A pro team plays most weeks, so a team with no game
 * in the window is far more likely a name that did not match the schedule than a real week off, and
 * counting it a 0 would hide that. An All-Star break waits on the weekly row like any other gap.
 *
 * "Ingested" is read per team and Eastern day: some row in `player_game_stats` that day belongs to an
 * identity whose `currentTeam` is his team. The box score has no full team name, and the identity map
 * is where both sides already agree on one. Teams are matched to the schedule exactly as the lineup lock
 * matches them (`normalizeLockTeam`). Measured 2026-10-25: all 32 NHL `currentTeam` values match the 32
 * TheSportsDB team names on the slate.
 */
import type { PrismaClient } from '@prisma/client'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { readRiScheduleWindow } from '@/lib/sports-data/riScheduleCache'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { normalizeLockTeam } from './lineupLock'
import { RI_SCHEDULE_SLATE_SPORTS, readWeekGames } from './weekGames'

export type DailyNoRowVerdict = 'inactive' | 'no_stat' | 'pending' | 'not_ingested' | 'no_games' | 'unmatched' | 'no_identity'

/** Verdicts under which a starter with no game row scores a real 0 for the week. */
export const DAILY_ZERO_VERDICTS: ReadonlySet<DailyNoRowVerdict> = new Set(['inactive', 'no_stat'])

/** The daily sports this applies to. NCAAB and SOCCER have not been checked and keep waiting on a row. */
export const DAILY_NO_ROW_VERDICT_SPORTS: readonly string[] = ['NBA', 'NHL', 'MLB']

type Identity = { id: string; status: string | null; currentTeam: string | null }
type TeamGame = { day: string; status: string | null }

export async function loadDailyWindowParticipation(
  db: Pick<PrismaClient, 'playerIdentityMap' | 'playerGameStat' | 'sportsGame' | 'sportsDataCache'>,
  args: {
    sport: string
    sportKeys: string[]
    season: number
    week: number
    window: { start: Date; end: Date }
    /** The identity (game-log) ids of the starters with no row. */
    identityIds: string[]
    now?: Date
  },
): Promise<(identityId: string | null | undefined) => DailyNoRowVerdict> {
  const sport = args.sport.toUpperCase()
  const identities = args.identityIds.length
    ? ((await db.playerIdentityMap.findMany({
        where: { id: { in: args.identityIds }, sport: { in: args.sportKeys } },
        select: { id: true, status: true, currentTeam: true },
      })) as Identity[])
    : []
  const byId = new Map(identities.map((i) => [i.id, i]))
  const isInactive = (i: Identity) => String(i.status ?? '').trim().toUpperCase() === 'INACT'

  // The schedule and the ingest evidence are read only for teams someone is actually waiting on.
  const teams = [...new Set(identities.filter((i) => !isInactive(i) && i.currentTeam).map((i) => String(i.currentTeam)))]
  const gamesByTeam = new Map<string, TeamGame[]>()
  let scheduleKnown = false
  const ingested = new Set<string>()
  if (teams.length > 0) {
    const addGame = (team: string | null | undefined, game: TeamGame) => {
      const key = normalizeLockTeam(sport, team)
      if (key) gamesByTeam.set(key, [...(gamesByTeam.get(key) ?? []), game])
    }
    if (RI_SCHEDULE_SLATE_SPORTS.includes(sport)) {
      const games = await readRiScheduleWindow(db as never, { sport, season: args.season, window: args.window })
      scheduleKnown = games != null
      for (const g of games ?? []) {
        if (g.seasonType != null && g.seasonType !== 'regular') continue
        addGame(g.homeTeam, { day: g.day, status: g.status })
        addGame(g.awayTeam, { day: g.day, status: g.status })
      }
    } else {
      const rows = await readWeekGames(db as never, {
        sport,
        season: args.season,
        week: args.week,
        seasonType: 'regular',
        now: args.now,
        dateWindow: args.window,
      })
      scheduleKnown = true
      for (const g of rows) {
        const day = easternCalendarDay(g.startTime)
        if (!day) continue
        const game = { day: day.toISOString().slice(0, 10), status: g.status }
        addGame(g.homeTeam, game)
        addGame(g.awayTeam, game)
      }
    }

    const teammates = (await db.playerIdentityMap.findMany({
      where: { sport: { in: args.sportKeys }, currentTeam: { in: teams } },
      select: { id: true, currentTeam: true },
    })) as Array<{ id: string; currentTeam: string | null }>
    const teamOf = new Map(teammates.map((t) => [t.id, normalizeLockTeam(sport, t.currentTeam)]))
    if (teamOf.size > 0) {
      const rows = (await db.playerGameStat.findMany({
        where: {
          playerId: { in: [...teamOf.keys()] },
          sportType: { in: args.sportKeys },
          gameDate: { gte: args.window.start, lt: args.window.end },
        },
        distinct: ['playerId', 'gameDate'],
        select: { playerId: true, gameDate: true },
      })) as Array<{ playerId: string; gameDate: Date | null }>
      for (const r of rows) {
        const team = teamOf.get(r.playerId)
        if (team && r.gameDate) ingested.add(`${team}|${r.gameDate.toISOString().slice(0, 10)}`)
      }
    }
  }

  return (identityId) => {
    const identity = identityId ? byId.get(identityId) : undefined
    if (!identity) return 'no_identity'
    if (isInactive(identity)) return 'inactive'
    const team = normalizeLockTeam(sport, identity.currentTeam)
    if (!team || !scheduleKnown) return 'unmatched'
    // A called-off game is a blank (the finalizer's own rule), and RI re-lists a moved MLB or soccer
    // game under a new id, marking the old one `replaced`.
    const played = (gamesByTeam.get(team) ?? []).filter((g) => {
      const s = normalizeGameStatus(g.status)
      return s !== 'cancelled' && s !== 'postponed' && String(g.status ?? '').trim().toLowerCase() !== 'replaced'
    })
    if (played.length === 0) return 'no_games'
    if (played.some((g) => normalizeGameStatus(g.status) !== 'final')) return 'pending'
    return played.every((g) => ingested.has(`${team}|${g.day}`)) ? 'no_stat' : 'not_ingested'
  }
}
