import type { PlayoffSeriesView } from "./types"
import { cupPointsLeaders, type CupGameDetails } from "./nbaCupProgress"

export type CupRound = "cup_group_play" | "cup_quarterfinals" | "cup_semifinals" | "cup_championship"
export type NbaCupGame = CupGameDetails & {
  eventId: string; round: CupRound; label: string; startsAt: string | null
  homeTeamName: string; awayTeamName: string; conference: "east" | "west" | "finals"
  venue: string | null; location: string | null
  status: "scheduled" | "in_progress" | "final"; blocked: boolean
  homeScore: number | null; awayScore: number | null; winnerTeamName: string | null
  seriesNumber?: number
  scoreboardDate?: string
  /**
   * Live and box-score detail. Optional because snapshots written before these
   * fields existed carry none of them, and a reader must treat "absent" as
   * "unknown", never as zero.
   */
  statusDetail?: string | null
  period?: number | null
  clock?: string | null
  homeLeader?: NbaCupLeader | null
  awayLeader?: NbaCupLeader | null
  homeLines?: number[]
  awayLines?: number[]
  homeAbbr?: string | null
  awayAbbr?: string | null
  homeColor?: string | null
  awayColor?: string | null
}

/** A team's points leader for one game. */
export type NbaCupLeader = { name: string; points: number }

/**
 * ⚠ ONLY ONCE THE GAME HAS STARTED. Before tipoff ESPN's competitor `leaders`
 * are season averages, so reading them pregame would label a season leader as
 * this game's top scorer with a number nobody scored.
 */
function pointsLeader(competitor: any): NbaCupLeader | null {
  const category = Array.isArray(competitor?.leaders) ? competitor.leaders.find((row: any) => row?.name === "points") : null
  const top = category?.leaders?.[0]
  const name = top?.athlete?.displayName ?? top?.athlete?.shortName
  const points = Number(top?.value)
  return typeof name === "string" && name && Number.isFinite(points) && points >= 0 ? { name, points } : null
}

function lineScores(competitor: any): number[] {
  if (!Array.isArray(competitor?.linescores)) return []
  return competitor.linescores.map((row: any) => Number(row?.value)).filter((value: number) => Number.isFinite(value) && value >= 0)
}

function hexColor(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : null
}

const EAST = new Set(["Atlanta Hawks", "Boston Celtics", "Brooklyn Nets", "Charlotte Hornets", "Chicago Bulls", "Cleveland Cavaliers", "Detroit Pistons", "Indiana Pacers", "Miami Heat", "Milwaukee Bucks", "New York Knicks", "Orlando Magic", "Philadelphia 76ers", "Toronto Raptors", "Washington Wizards"])
const WEST = new Set(["Dallas Mavericks", "Denver Nuggets", "Golden State Warriors", "Houston Rockets", "LA Clippers", "Los Angeles Clippers", "Los Angeles Lakers", "Memphis Grizzlies", "Minnesota Timberwolves", "New Orleans Pelicans", "Oklahoma City Thunder", "Phoenix Suns", "Portland Trail Blazers", "Sacramento Kings", "San Antonio Spurs", "Utah Jazz"])

export function isNbaCupTeam(name: string): boolean { return EAST.has(name) || WEST.has(name) }

/** Only explicit Cup labels qualify. NBA regular-season dates alone prove nothing. */
export function parseNbaCupScoreboard(payload: unknown, season: number): NbaCupGame[] {
  const events = (payload as { events?: unknown[] })?.events
  if (!Array.isArray(events)) throw new Error("NBA scoreboard events missing")
  const games = new Map<string, NbaCupGame>()
  for (const raw of events) {
    const event = raw as any
    const competition = event?.competitions?.[0]
    const label = competition?.notes?.find((note: any) => note.type === "event" && /^NBA Cup(?: -)? /i.test(note.headline ?? ""))?.headline
    const round: CupRound | null = label === "NBA Cup - Group Play" ? "cup_group_play"
      : label === "NBA Cup - Quarterfinals" ? "cup_quarterfinals"
      : label === "NBA Cup - Semifinals" ? "cup_semifinals"
      : label === "NBA Cup Championship" ? "cup_championship" : null
    if (!round || event?.season?.year !== season + 1 || !/^\d+$/.test(event?.id ?? "")) continue
    const eventNumber = Number(event.id)
    if (!Number.isSafeInteger(eventNumber) || eventNumber < 1 || eventNumber > 2_000_000_000) continue
    const competitors = competition?.competitors
    if (!Array.isArray(competitors) || competitors.length !== 2) continue
    const home = competitors.find((team: any) => team.homeAway === "home")
    const away = competitors.find((team: any) => team.homeAway === "away")
    const h = home?.team?.displayName, a = away?.team?.displayName
    if (!isNbaCupTeam(h) || !isNbaCupTeam(a) || h === a) continue
    const timestamp = Date.parse(event.date ?? "")
    if (!Number.isFinite(timestamp) || new Date(timestamp).getUTCFullYear() !== season) continue
    const month = new Date(timestamp).getUTCMonth()
    if (month < 9 || month > 11) continue
    const type = event.status?.type
    const blocked = !["STATUS_SCHEDULED", "STATUS_IN_PROGRESS", "STATUS_HALFTIME", "STATUS_END_PERIOD", "STATUS_FINAL"].includes(type?.name) || /TBD|postpon|cancel/i.test(type?.detail ?? "")
    const status = type?.completed === true && type?.name === "STATUS_FINAL" ? "final"
      : type?.state === "in" ? "in_progress" : "scheduled"
    const score = (value: unknown) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null
    const hs = status === "scheduled" ? null : score(home.score)
    const as = status === "scheduled" ? null : score(away.score)
    const winner = !blocked && status === "final" && hs != null && as != null && hs !== as ? hs > as ? h : a : null
    const conference = round === "cup_championship" ? "finals" : EAST.has(h) && EAST.has(a) ? "east" : WEST.has(h) && WEST.has(a) ? "west" : null
    // Cross-conference group games and incorrectly labelled rounds are not valid Cup games.
    if (!conference) continue
    const venue = competition.venue
    const period = Number.isSafeInteger(event.status?.period) && event.status.period > 0 ? event.status.period : null
    const regulationPoints = (team: any) => {
      const quarters = team?.linescores?.slice(0, 4)
      return Array.isArray(quarters) && quarters.length === 4 && quarters.every((row: any) => Number.isSafeInteger(row.value) && row.value >= 0)
        ? quarters.reduce((total: number, row: any) => total + row.value, 0) : null
    }
    const started = status !== "scheduled"
    const detail = typeof type?.shortDetail === "string" && type.shortDetail.trim() ? type.shortDetail.trim().slice(0, 40) : null
    const clock = typeof event.status?.displayClock === "string" ? event.status.displayClock.slice(0, 12) : null
    games.set(event.id, {
      eventId: event.id, round, label, startsAt: blocked ? null : new Date(timestamp).toISOString(),
      homeTeamName: h, awayTeamName: a, conference, venue: venue?.fullName ?? null,
      location: [venue?.address?.city, venue?.address?.state].filter(Boolean).join(", ") || null,
      status, blocked, homeScore: hs, awayScore: as, winnerTeamName: winner,
      homeLeaders: status === "scheduled" ? [] : cupPointsLeaders(home),
      awayLeaders: status === "scheduled" ? [] : cupPointsLeaders(away),
      homeRegulationPoints: status === "final" ? regulationPoints(home) : null,
      awayRegulationPoints: status === "final" ? regulationPoints(away) : null,
      statusDetail: started ? detail : null,
      period: started ? period : null,
      clock: status === "in_progress" ? clock : null,
      homeLeader: started ? pointsLeader(home) : null,
      awayLeader: started ? pointsLeader(away) : null,
      homeLines: started ? lineScores(home) : [],
      awayLines: started ? lineScores(away) : [],
      homeAbbr: typeof home?.team?.abbreviation === "string" ? home.team.abbreviation.slice(0, 5) : null,
      awayAbbr: typeof away?.team?.abbreviation === "string" ? away.team.abbreviation.slice(0, 5) : null,
      homeColor: hexColor(home?.team?.color),
      awayColor: hexColor(away?.team?.color),
    })
  }
  return [...games.values()]
}

/** Persist event-to-slot assignments; refreshed dates must never move users' picks. */
export function assignNbaCupSlots(games: NbaCupGame[], previous: NbaCupGame[] = []): NbaCupGame[] {
  const old = new Map(previous.map((game) => [game.eventId, game.seriesNumber]))
  const used = new Set<number>()
  const result = games.map((game) => ({ ...game, seriesNumber: old.get(game.eventId) }))
  for (const game of result) if (game.seriesNumber != null) used.add(game.seriesNumber)
  for (const game of result.sort((a, b) => a.eventId.localeCompare(b.eventId))) {
    if (game.seriesNumber != null) continue
    if (game.round === "cup_group_play") game.seriesNumber = Number(game.eventId) + 100
    else {
      const slots = game.round === "cup_championship" ? [7] : game.round === "cup_semifinals"
        ? [game.conference === "east" ? 5 : 6] : game.conference === "east" ? [1, 2] : [3, 4]
      game.seriesNumber = slots.find((slot) => !used.has(slot))
    }
    if (game.seriesNumber != null) used.add(game.seriesNumber)
  }
  return result
}

export function nbaCupLockedReason(game: Pick<PlayoffSeriesView, "startsAt" | "status" | "homeTeamName" | "awayTeamName">, now = Date.now()): string | null {
  if (game.status === "final") return "Game completed"
  if (game.status === "in_progress") return "This game has started. Your pick is locked."
  if (!game.startsAt || !isNbaCupTeam(game.homeTeamName) || !isNbaCupTeam(game.awayTeamName)) return "This matchup will open automatically when its teams and tipoff are confirmed."
  const start = new Date(game.startsAt).getTime()
  if (!Number.isFinite(start)) return "Tipoff time is pending."
  return start <= now ? "This game has started. Your pick is locked." : null
}

/** A first submission after tipoff cannot turn an earlier draft pick into earned points. */
export function eligibleNbaCupPicks<T extends { seriesId: string }>(
  games: Array<{ id: string; startsAt?: string | Date | null }>, picks: T[], finalizedAt: string | Date | null | undefined,
): T[] {
  const submitted = finalizedAt ? new Date(finalizedAt).getTime() : Number.NaN
  if (!Number.isFinite(submitted)) return []
  const starts = new Map(games.map((game) => [game.id, game.startsAt ? new Date(game.startsAt).getTime() : Number.NaN]))
  return picks.filter((pick) => (starts.get(pick.seriesId) ?? Number.NaN) > submitted)
}

/**
 * Whether any Cup game is on, or about to be, so the minute-level live tick is
 * worth a provider call. Reads only the stored snapshot.
 *
 * ⚠ THE WINDOW RUNS 4H PAST TIPOFF, NOT TO A GUESSED END TIME. A game with
 * overtime or a long delay is still live after a typical 2.5h, and a game the
 * snapshot still calls scheduled after tipoff is exactly the one whose first
 * live score has not been fetched yet.
 */
export function nbaCupLiveWindowOpen(games: NbaCupGame[], now = Date.now()): boolean {
  return games.some((game) => {
    if (game.blocked || game.status === "final") return false
    if (game.status === "in_progress") return true
    const start = Date.parse(game.startsAt ?? "")
    return Number.isFinite(start) && start - 10 * 60_000 <= now && now <= start + 4 * 3600_000
  })
}
