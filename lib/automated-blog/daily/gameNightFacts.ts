/**
 * Game-night facts — the ONLY material a daily blog draft may use.
 *
 * Everything here is read from our own Postgres (DB-first: no provider call). The box-score lines
 * come from `player_game_stats` (the Rolling Insights live feed), and each game is cross-checked
 * against the final score in `SportsGame` before a single line of it is trusted.
 *
 * WHY THE CROSS-CHECK. The live rows carry a `gameFinal` flag that is not reliable (measured
 * 2026-11-15: 0 of ~900 NBA rows flagged final, every one of them a finished game), and a live feed
 * can stop polling before the last possession. So a game is used only when the players' points
 * (NBA) or goals (NHL) add up EXACTLY to the final score recorded for that game id by the SAME
 * source, with status `completed`. Those two numbers come from different rows of the provider's
 * payload, so the comparison is independent; a game that does not add up is dropped, never patched.
 * (An NHL shootout adds a goal to the score that no skater is credited with, so those games drop
 * out too. That is a lost game, not a wrong one.)
 *
 * NCAAB has lines but no same-source game rows to check them against, so it is not offered here.
 */

import { prisma } from "@/lib/prisma"

export type GameNightSport = "NBA" | "NHL"
export const GAME_NIGHT_SPORTS: readonly GameNightSport[] = ["NBA", "NHL"]

/** The source whose game rows share ids with the box-score lines (see the header). */
const GAME_SOURCE = "rolling_insights"

export interface RawLine {
  gameId: string
  team: string | null
  opponent: string | null
  playerName: string | null
  position: string | null
  group: string | null
  stats: Record<string, unknown>
}

export interface RawGame {
  externalId: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string | null
}

export interface VerifiedGame {
  gameId: string
  home: string
  away: string
  homeScore: number
  awayScore: number
}

export interface Performer {
  name: string
  team: string
  opponent: string
  /** What the post may say about this player, e.g. "43 PTS, 12 REB, 5 AST". */
  line: string
  /** Internal ordering only. Never printed (it is not anyone's league scoring). */
  rank: number
  kind: "skater" | "goalie" | "player"
}

export interface GameNightFacts {
  sport: GameNightSport
  /** ET calendar date of the slate, YYYY-MM-DD. */
  date: string
  /** "November 14, 2026". */
  dateLabel: string
  games: VerifiedGame[]
  /** Games found but dropped because the box score did not add up to the final. */
  droppedGames: number
  performers: Performer[]
  goalies: Performer[]
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}

/** A line's game id without the NHL `:skaters` / `:goalies` group suffix. */
export function baseGameId(gameId: string): string {
  const i = gameId.indexOf(":")
  return i === -1 ? gameId : gameId.slice(0, i)
}

/** Points (NBA) or goals (NHL, skaters plus any goalie goal) one line contributes to its team's score. */
function scoringContribution(sport: GameNightSport, line: RawLine): number {
  if (sport === "NBA") return num(line.stats.points)
  return line.group === "goalies" ? num(line.stats.goalie_goals) : num(line.stats.goals)
}

/**
 * Keep only completed games whose lines sum to the final score for BOTH teams.
 * Pure, so the rule is tested without a database.
 */
export function verifyGames(
  sport: GameNightSport,
  games: RawGame[],
  lines: RawLine[],
): { verified: VerifiedGame[]; dropped: number } {
  const totals = new Map<string, Map<string, number>>()
  for (const line of lines) {
    if (!line.team) continue
    const id = baseGameId(line.gameId)
    const byTeam = totals.get(id) ?? new Map<string, number>()
    byTeam.set(line.team, (byTeam.get(line.team) ?? 0) + scoringContribution(sport, line))
    totals.set(id, byTeam)
  }

  const verified: VerifiedGame[] = []
  let dropped = 0
  for (const g of games) {
    const byTeam = totals.get(g.externalId)
    if (!byTeam) continue // no lines for this game at all: not "dropped", just not ours to talk about
    const completed = (g.status ?? "").toLowerCase() === "completed"
    const ok =
      completed &&
      g.homeScore != null &&
      g.awayScore != null &&
      byTeam.get(g.homeTeam) === g.homeScore &&
      byTeam.get(g.awayTeam) === g.awayScore
    if (ok) {
      verified.push({ gameId: g.externalId, home: g.homeTeam, away: g.awayTeam, homeScore: g.homeScore!, awayScore: g.awayScore! })
    } else {
      dropped += 1
    }
  }
  return { verified, dropped }
}

function part(value: number, label: string): string | null {
  return value > 0 ? `${value} ${label}` : null
}

/** NBA: a standard points-league ordering. Only the ORDER is used; the number is never shown. */
function nbaRank(s: Record<string, unknown>): number {
  return (
    num(s.points) +
    1.2 * num(s.total_rebounds) +
    1.5 * num(s.assists) +
    3 * num(s.steals) +
    3 * num(s.blocks) -
    num(s.turnovers)
  )
}

function nbaLine(s: Record<string, unknown>): string {
  const parts = [
    `${num(s.points)} PTS`,
    part(num(s.total_rebounds), "REB"),
    part(num(s.assists), "AST"),
    part(num(s.steals), "STL"),
    part(num(s.blocks), "BLK"),
    part(num(s.three_points_made), "3PM"),
  ].filter((p): p is string => Boolean(p))
  const fgm = num(s.field_goals_made)
  const fga = num(s.field_goals_attempted)
  if (fga > 0) parts.push(`${fgm}-of-${fga} FG`)
  return parts.join(", ")
}

function nhlSkaterRank(s: Record<string, unknown>): number {
  const ppp = num(s.power_play_goals) + num(s.power_play_assists)
  return (
    3 * num(s.goals) +
    2 * num(s.assists) +
    ppp +
    0.5 * num(s.shots_on_goal) +
    0.5 * num(s.hits) +
    0.5 * num(s.blocks)
  )
}

function nhlSkaterLine(s: Record<string, unknown>): string {
  const ppp = num(s.power_play_goals) + num(s.power_play_assists)
  const pm = num(s.plus_minus)
  return [
    part(num(s.goals), "G"),
    part(num(s.assists), "A"),
    part(ppp, "PPP"),
    part(num(s.shots_on_goal), "SOG"),
    part(num(s.hits), "HIT"),
    part(num(s.blocks), "BLK"),
    pm !== 0 ? `${pm > 0 ? "+" : ""}${pm} +/-` : null,
  ]
    .filter((p): p is string => Boolean(p))
    .join(", ")
}

function goalieRank(s: Record<string, unknown>): number {
  return 3 * num(s.win) + 3 * num(s.shutouts) + 0.2 * num(s.saves) - num(s.goals_allowed)
}

function goalieLine(s: Record<string, unknown>): string {
  const result = num(s.win) > 0 ? "W" : num(s.overtime_loss) > 0 ? "OTL" : num(s.loss) > 0 ? "L" : null
  return [
    result,
    `${num(s.saves)} saves on ${num(s.shots_against)} shots`,
    `${num(s.goals_allowed)} GA`,
    num(s.shutouts) > 0 ? "shutout" : null,
  ]
    .filter((p): p is string => Boolean(p))
    .join(", ")
}

/** Rank the lines of VERIFIED games only. Pure. */
export function rankPerformers(
  sport: GameNightSport,
  lines: RawLine[],
  verified: VerifiedGame[],
  limits: { players: number; goalies: number } = { players: 8, goalies: 3 },
): { performers: Performer[]; goalies: Performer[] } {
  const ok = new Set(verified.map((g) => g.gameId))
  const usable = lines.filter((l) => ok.has(baseGameId(l.gameId)) && l.playerName && l.team && l.opponent)

  const performers: Performer[] = []
  const goalies: Performer[] = []
  for (const l of usable) {
    const base = { name: l.playerName!, team: l.team!, opponent: l.opponent! }
    if (sport === "NBA") {
      performers.push({ ...base, kind: "player", rank: nbaRank(l.stats), line: nbaLine(l.stats) })
    } else if (l.group === "goalies") {
      if (num(l.stats.shots_against) > 0) goalies.push({ ...base, kind: "goalie", rank: goalieRank(l.stats), line: goalieLine(l.stats) })
    } else {
      const line = nhlSkaterLine(l.stats)
      if (line) performers.push({ ...base, kind: "skater", rank: nhlSkaterRank(l.stats), line })
    }
  }
  const byRank = (a: Performer, b: Performer) => b.rank - a.rank || a.name.localeCompare(b.name)
  return {
    performers: performers.sort(byRank).slice(0, limits.players),
    goalies: goalies.sort(byRank).slice(0, limits.goalies),
  }
}

/** "2026-11-14" → "November 14, 2026" (UTC, so the label cannot shift a day). */
export function formatDateLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
}

/** The US Eastern calendar date `daysAgo` days before `now`, as YYYY-MM-DD. */
export function easternDate(now: Date, daysAgo = 0): string {
  const shifted = new Date(now.getTime() - daysAgo * 86_400_000)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(shifted)
}

/** Read one sport's slate for one ET date and return only what survived the cross-check. */
export async function loadGameNightFacts(sport: GameNightSport, date: string): Promise<GameNightFacts> {
  const rows = await prisma.playerGameStat.findMany({
    where: { sportType: sport, gameDate: new Date(`${date}T00:00:00Z`) },
    select: { gameId: true, team: true, opponent: true, statPayload: true, normalizedStatMap: true },
  })

  const lines: RawLine[] = rows.map((r) => {
    const payload = (r.statPayload ?? {}) as Record<string, unknown>
    const norm = (r.normalizedStatMap ?? {}) as Record<string, unknown>
    const stats = (norm.stats && typeof norm.stats === "object" ? norm.stats : payload) as Record<string, unknown>
    return {
      gameId: r.gameId,
      team: r.team,
      opponent: r.opponent,
      playerName: typeof payload.player === "string" ? payload.player.trim() || null : null,
      position: typeof payload.position === "string" ? payload.position : null,
      group: typeof norm.group === "string" ? norm.group : null,
      stats,
    }
  })

  const ids = [...new Set(lines.map((l) => baseGameId(l.gameId)))]
  const games: RawGame[] = ids.length
    ? await prisma.sportsGame.findMany({
        where: { sport, source: GAME_SOURCE, externalId: { in: ids } },
        select: { externalId: true, homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, status: true },
      })
    : []

  const { verified, dropped } = verifyGames(sport, games, lines)
  const { performers, goalies } = rankPerformers(sport, lines, verified)
  return { sport, date, dateLabel: formatDateLabel(date), games: verified, droppedGames: dropped, performers, goalies }
}

/**
 * Every player name seen in this sport over the last `days` days. The fact check uses it to catch a
 * draft that names a real player who is NOT in the day's facts — the realistic hallucination.
 */
export async function loadRecentPlayerNames(sport: GameNightSport, date: string, days = 21): Promise<string[]> {
  const since = new Date(new Date(`${date}T00:00:00Z`).getTime() - days * 86_400_000)
  const rows = await prisma.$queryRaw<Array<{ name: string | null }>>`
    SELECT DISTINCT stat_payload->>'player' AS name
    FROM player_game_stats
    WHERE "sportType" = ${sport} AND game_date >= ${since}
  `
  return rows.map((r) => (r.name ?? "").trim()).filter((n) => n.length > 0)
}
