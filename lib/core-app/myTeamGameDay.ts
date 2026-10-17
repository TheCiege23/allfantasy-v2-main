import 'server-only'

import { prisma } from '@/lib/prisma'

import { starterGameStates, type StarterGameState } from './matchupGameState'
import type { SportsWeek } from './sportsWeek'

/**
 * Where each player's game stands this week, and what he has scored so far.
 *
 * 🛑 WHY. My Team rendered every row as if its game were still to come. On Friday 2026-10-02
 * three of one manager's starters had played the Thursday game (PIT @ CLE): the board said
 * "3 starters past kickoff", while the league view showed the same three with projections, a
 * 79° forecast and "Thu 8:15p ET" — a past game indistinguishable from next Thursday's — and
 * the weekly total still counted their projections.
 *
 * The rules are the Matchup screen's, not new ones:
 *  - Game state comes from `starterGameStates`: only a final status proves a game finished, and a
 *    live status counts only while its row is fresh. A kickoff alone is "started", never "final".
 *  - Points are `LeaguePlayerWeeklyScore`, the platform's own scoring (Sleeper today), kept
 *    current by the live points sync. Nothing here re-scores a stat line.
 *  - A score is shown only once the player's game has kicked off. Sleeper writes a 0 for every
 *    starter the moment the week opens, so a 0 on an unplayed game is a placeholder, not a bust.
 */

export type PlayerGameDay = {
  /** `started` = past kickoff, but no fresh live or final status to say which. */
  state: 'upcoming' | 'started' | 'live' | 'final'
  /** Platform-scored points this week. Null when not started, or no row is held. */
  points: number | null
}

export type StarterGameDaySummary = {
  final: number
  live: number
  /** Past kickoff with no fresh status — counted as played-or-playing, never as finished. */
  started: number
  upcoming: number
  /** Sum of `points` over starters whose game has kicked off. Null when no score row is held. */
  scored: number | null
  /** Starters that contributed to `scored`. */
  scoredCount: number
}

type Player = { team: string | null; kickoff: Date | null }

/** Pure: combine a provider game state, a kickoff and a score row into one row state. */
export function playerGameDay(
  provider: StarterGameState | undefined,
  kickoff: Date | null,
  points: number | undefined,
  now: Date,
): PlayerGameDay {
  const kickedOff = kickoff != null && !Number.isNaN(kickoff.getTime()) && kickoff.getTime() <= now.getTime()
  let state: PlayerGameDay['state']
  if (provider === 'final') state = 'final'
  else if (provider === 'live') state = 'live'
  // An "upcoming" status that disagrees with a passed kickoff is a stale row; the clock wins.
  else state = kickedOff ? 'started' : 'upcoming'
  return { state, points: state === 'upcoming' || points == null ? null : points }
}

/** Pure: roll the starters' row states into the game-day line. */
export function summariseStarterGameDay(rows: PlayerGameDay[]): StarterGameDaySummary {
  const out: StarterGameDaySummary = { final: 0, live: 0, started: 0, upcoming: 0, scored: null, scoredCount: 0 }
  for (const row of rows) {
    out[row.state]++
    if (row.points != null) {
      out.scored = (out.scored ?? 0) + row.points
      out.scoredCount++
    }
  }
  if (out.scored != null) out.scored = Math.round(out.scored * 100) / 100
  return out
}

/**
 * Read the week's game rows and this league's score rows, and return a row state per roster id.
 * Fails soft: any read error leaves the affected half empty, which renders as "no state known"
 * rather than as a claim.
 */
export async function readLineupGameDay(opts: {
  sport: string
  week: SportsWeek | null
  /** The PLATFORM's league id — `LeaguePlayerWeeklyScore.leagueId`, not our league id. */
  platformLeagueId: string | null
  players: ReadonlyMap<string, Player>
  now?: Date
}): Promise<Map<string, PlayerGameDay>> {
  const now = opts.now ?? new Date()
  const ids = [...opts.players.keys()]
  if (!opts.week || ids.length === 0) return new Map()
  const { season, week, seasonType } = opts.week

  const [games, scores] = await Promise.all([
    prisma.sportsGame
      .findMany({
        // Untyped rows are the live-score writer's; `starterGameStates` only trusts the ones that
        // match a typed fixture's clubs and kickoff, so they cannot leak a preseason status in.
        where: { sport: opts.sport, season, week, OR: [{ seasonType }, { seasonType: null }] },
        select: { homeTeam: true, awayTeam: true, status: true, startTime: true, fetchedAt: true, seasonType: true },
        take: 400,
      })
      .catch(() => []),
    opts.platformLeagueId
      ? prisma.leaguePlayerWeeklyScore
          .findMany({
            where: { leagueId: opts.platformLeagueId, seasonYear: season, week, playerId: { in: ids } },
            select: { playerId: true, points: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
  ])

  const states = starterGameStates(opts.players, games, now)
  const pointsBy = new Map(scores.map((s) => [s.playerId, s.points]))
  return new Map(
    [...opts.players].map(([id, p]) => [id, playerGameDay(states.get(id), p.kickoff, pointsBy.get(id), now)]),
  )
}
