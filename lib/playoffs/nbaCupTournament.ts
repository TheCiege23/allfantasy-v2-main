import type { PlayoffSeriesView } from "./types"

export type CupRound = "cup_group_play" | "cup_quarterfinals" | "cup_semifinals" | "cup_championship"
export type NbaCupGame = {
  eventId: string; round: CupRound; label: string; startsAt: string | null
  homeTeamName: string; awayTeamName: string; conference: "east" | "west" | "finals"
  venue: string | null; location: string | null
  status: "scheduled" | "in_progress" | "final"; blocked: boolean
  homeScore: number | null; awayScore: number | null; winnerTeamName: string | null
  seriesNumber?: number
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
    games.set(event.id, {
      eventId: event.id, round, label, startsAt: blocked ? null : new Date(timestamp).toISOString(),
      homeTeamName: h, awayTeamName: a, conference, venue: venue?.fullName ?? null,
      location: [venue?.address?.city, venue?.address?.state].filter(Boolean).join(", ") || null,
      status, blocked, homeScore: hs, awayScore: as, winnerTeamName: winner,
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
