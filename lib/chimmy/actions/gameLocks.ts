import 'server-only'

import { prisma } from '@/lib/prisma'
import { getFantasyDayWindowUTC } from '@/lib/time-engine/windows'
import { sameNflTeam } from '@/lib/sports/teamRef'

/**
 * Has this player's game already started? Asked of every player a Chimmy lineup move would touch.
 *
 * ── 🛑 WHY THIS EXISTS WHEN THE ENGINE HAS A LOCK CHECK ─────────────────────────────────────────
 * `persistRosterLineupWithEngine` refuses a GLOBALLY locked lineup (the weekly / daily policy, a
 * commissioner lock, a specialty phase) — but its per-player kickoff locks are computed and STORED,
 * never enforced. So a save that benches a player whose game kicked off an hour ago goes through.
 * The Roster tab stops that in the UI; a Chimmy card has no such UI, so the check lives here and
 * runs at proposal time AND again at confirm.
 *
 * Two independent signals, either of which locks a player:
 *   1. the `gameTime` stored on the player's own lineup row (what the Roster tab greys out on);
 *   2. the league sport's schedule in `SportsGame` — a game for his team that has started inside the
 *      current scoring window (this week's games for football, today's Eastern day for daily sports).
 *
 * ⚠ "COULD NOT CHECK" IS REPORTED, NEVER READ AS "NOT STARTED". A player with no team on file, or a
 * sport whose schedule we hold nothing for, comes back `unverified`, and the card says so in words.
 */

export type LockCandidate = {
  playerId: string
  name: string
  team: string | null
  gameTime: string | null
}

export type LockCheck = {
  /** playerId → why he is locked. */
  started: Map<string, string>
  /** Players whose kickoff could not be checked either way. */
  unverified: string[]
}

type GameRow = {
  homeTeam: string | null
  awayTeam: string | null
  homeTeamId: string | null
  awayTeamId: string | null
  startTime: Date | null
  status: string | null
}

const SPORT_ALIASES: Record<string, string[]> = {
  NCAAB: ['NCAAB', 'NCAABB'],
  NCAAF: ['NCAAF', 'NCAAFB'],
}

const FOOTBALL = new Set(['NFL', 'NCAAF'])
const DAILY = new Set(['NBA', 'NCAAB', 'MLB', 'NHL'])

const norm = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase()

function teamMatches(sport: string, playerTeam: string, row: GameRow): boolean {
  if (sport === 'NFL') return sameNflTeam(playerTeam, row.homeTeam) || sameNflTeam(playerTeam, row.awayTeam)
  const t = norm(playerTeam)
  if (!t) return false
  return [row.homeTeam, row.awayTeam, row.homeTeamId, row.awayTeamId].some((v) => norm(v) === t)
}

/**
 * When the current scoring window opened, for the schedule read.
 *
 * ⚠ BY THE CLOCK, NOT BY `week`. A league's own week number need not match the real sport's
 * (a league that started in week 2 is always one behind), so filtering games on the league's week
 * would silently miss the games that matter — the dangerous direction. Football weeks turn over
 * early in the week (NFL: Tuesday; college: Monday), so a game from last week never locks this one.
 */
export function windowStart(sport: string, now: Date): Date {
  if (DAILY.has(sport)) return getFantasyDayWindowUTC('America/New_York', now).windowStartUTC
  if (FOOTBALL.has(sport)) {
    const turnover = sport === 'NFL' ? 2 : 1 // Tuesday / Monday, as a UTC day index
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 10, 0, 0))
    let back = (d.getUTCDay() - turnover + 7) % 7
    if (back === 0 && d.getTime() > now.getTime()) back = 7
    return new Date(d.getTime() - back * 24 * 3600 * 1000)
  }
  return new Date(now.getTime() - 3 * 24 * 3600 * 1000)
}

export async function checkStartedGames(args: {
  sport: string
  season: number
  week: number
  players: LockCandidate[]
  now?: Date
}): Promise<LockCheck> {
  const now = args.now ?? new Date()
  const sport = norm(args.sport)
  const started = new Map<string, string>()
  const needSchedule: LockCandidate[] = []

  for (const p of args.players) {
    const t = p.gameTime ? Date.parse(p.gameTime) : NaN
    if (Number.isFinite(t) && t <= now.getTime()) {
      started.set(p.playerId, `${p.name}'s game has already started`)
      continue
    }
    needSchedule.push(p)
  }
  if (needSchedule.length === 0) return { started, unverified: [] }

  const sports = SPORT_ALIASES[sport] ?? [sport]
  const from = windowStart(sport, now)
  /*
   * ⚠ THE READ SPANS THE NEXT EIGHT DAYS TOO, AND THAT IS WHAT MAKES "NO MATCH" MEAN SOMETHING.
   * Team spellings differ by provider ("LAL" vs "Los Angeles Lakers"), and outside the NFL there is
   * no certified matcher. A player whose team matches NO game in the whole window is therefore not
   * "not started" — it is "could not be checked", and he is reported unverified. Only a team we can
   * see on the schedule, with no game begun yet, reads as clear.
   */
  let rows: GameRow[] = []
  let readFailed = false
  try {
    rows = (await prisma.sportsGame.findMany({
      where: { sport: { in: sports }, startTime: { gte: from, lte: new Date(now.getTime() + 8 * 24 * 3600 * 1000) } },
      select: { homeTeam: true, awayTeam: true, homeTeamId: true, awayTeamId: true, startTime: true, status: true },
      orderBy: { startTime: 'asc' },
      take: 3000,
    })) as GameRow[]
  } catch {
    readFailed = true
  }

  const unverified: string[] = []
  for (const p of needSchedule) {
    const futureRowTime = p.gameTime ? Date.parse(p.gameTime) : NaN
    const rowSaysLater = Number.isFinite(futureRowTime) && futureRowTime > now.getTime()
    if (!p.team || readFailed) {
      if (!rowSaysLater) unverified.push(p.playerId)
      continue
    }
    const teamGames = rows.filter((r) => teamMatches(sport, p.team!, r))
    const begun = teamGames.find((r) => r.startTime instanceof Date && r.startTime.getTime() <= now.getTime())
    if (begun) {
      started.set(p.playerId, `${p.name}'s game (${begun.awayTeam ?? '?'} at ${begun.homeTeam ?? '?'}) has already started`)
    } else if (teamGames.length === 0 && !rowSaysLater) {
      unverified.push(p.playerId)
    }
  }
  return { started, unverified }
}
