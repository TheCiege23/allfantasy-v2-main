import { bracketCompanionCopy } from "@/lib/brackets/bracketCompanionCopy"
import type { PlayoffSeriesView } from "./types"

export type CupScorer = { name: string; points: number }
export type CupGameDetails = {
  clock?: string | null; period?: number | null; statusDetail?: string | null
  homeLeaders?: CupScorer[]; awayLeaders?: CupScorer[]
  homeRegulationPoints?: number | null; awayRegulationPoints?: number | null
}

/** Only game-level PTS leaders qualify; pregame pointsPerGame are season averages. */
export function cupPointsLeaders(competitor: any): CupScorer[] {
  const category = (Array.isArray(competitor?.leaders) ? competitor.leaders : []).find((row: any) => row?.name === "points")
  const leaders = (Array.isArray(category?.leaders) ? category.leaders : []).flatMap((leader: any) => {
    const name = leader?.athlete?.displayName
    const value = leader.value ?? leader.displayValue
    const points = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN
    const teamId = leader.team?.id ?? leader.athlete?.team?.id
    return typeof name === "string" && name.trim() && Number.isSafeInteger(points) && points >= 0 &&
      (!teamId || String(teamId) === String(competitor.team?.id)) ? [{ name: name.trim(), points }] : []
  }) as CupScorer[]
  const max = Math.max(...leaders.map((leader) => leader.points))
  return leaders.filter((leader) => leader.points === max)
}

export function cupGameDetails(game: Pick<PlayoffSeriesView, "providerGamesJson">): CupGameDetails {
  const data = game.providerGamesJson
  if (!data || typeof data !== "object" || Array.isArray(data)) return {}
  const json = data as Record<string, unknown>
  const live = json.live && typeof json.live === "object" && !Array.isArray(json.live) ? json.live as Record<string, unknown> : {}
  const scorers = (value: unknown): CupScorer[] => (Array.isArray(value) ? value : []).flatMap((item) => {
    const row = item as Partial<CupScorer> | null
    return row && typeof row.name === "string" && row.name.trim() && typeof row.points === "number" && Number.isSafeInteger(row.points) && row.points >= 0
      ? [{ name: row.name.trim(), points: row.points }] : []
  })
  const number = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
  const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null
  return {
    period: number(json.period ?? live.period), clock: text(json.clock ?? live.clock), statusDetail: text(json.statusDetail ?? live.detail),
    homeLeaders: scorers(json.homeLeaders ?? [live.homeLeader]), awayLeaders: scorers(json.awayLeaders ?? [live.awayLeader]),
    homeRegulationPoints: number(json.homeRegulationPoints), awayRegulationPoints: number(json.awayRegulationPoints),
  }
}

// Season-scoped published draw. Never reuse a previous year's draw for a future Cup.
// Official release: https://www.nba.com/news/nba-cup-101 (2026 draw and tiebreakers).
const GROUPS_2026 = [
  { name: "East Group A", conference: "east", teams: ["Brooklyn Nets", "Detroit Pistons", "Milwaukee Bucks", "Orlando Magic", "Toronto Raptors"] },
  { name: "East Group B", conference: "east", teams: ["Cleveland Cavaliers", "Indiana Pacers", "Miami Heat", "New York Knicks", "Philadelphia 76ers"] },
  { name: "East Group C", conference: "east", teams: ["Atlanta Hawks", "Boston Celtics", "Charlotte Hornets", "Chicago Bulls", "Washington Wizards"] },
  { name: "West Group A", conference: "west", teams: ["Dallas Mavericks", "Denver Nuggets", "Houston Rockets", "Phoenix Suns", "Utah Jazz"] },
  { name: "West Group B", conference: "west", teams: ["LA Clippers", "Memphis Grizzlies", "Minnesota Timberwolves", "New Orleans Pelicans", "Oklahoma City Thunder"] },
  { name: "West Group C", conference: "west", teams: ["Golden State Warriors", "Los Angeles Lakers", "Portland Trail Blazers", "Sacramento Kings", "San Antonio Spurs"] },
] as const

export const cupTeamName = (name: string) => name === "Los Angeles Clippers" ? "LA Clippers" : name
type GroupGame = Pick<PlayoffSeriesView, "id" | "round" | "homeTeamName" | "awayTeamName" | "winnerTeamName" | "liveHomeScore" | "liveAwayScore" | "status" | "providerGamesJson">
export type CupTeamStanding = {
  team: string; wins: number; losses: number; remaining: number; rank: number; tied: boolean
  differential: number | null; maxWins: number; canWinGroup: boolean | null; canFinishSecond: boolean | null
  status: "Qualified" | "Group winner" | "Eliminated" | "Group leader" | "In contention" | "Tiebreak pending" | "Schedule pending"
  road: string
}
export type CupGroupStanding = { name: string; conference: string; teams: CupTeamStanding[]; scheduleComplete: boolean }

/** Enumerate only 10 group games (at most 1024 outcomes). Tied places remain possible, never guessed. */
function possibilities(teams: readonly string[], games: GroupGame[]) {
  const pending = games.filter((game) => game.status !== "final" || !game.winnerTeamName)
  const base = teams.map((team) => games.filter((game) => game.status === "final" && cupTeamName(game.winnerTeamName ?? "") === team).length)
  const canFirst = teams.map(() => false), canSecond = teams.map(() => false)
  let minimumRunnerUpWins = 4
  for (let mask = 0; mask < 2 ** pending.length; mask++) {
    const wins = [...base]
    pending.forEach((game, index) => { wins[teams.indexOf(cupTeamName(mask & (1 << index) ? game.homeTeamName : game.awayTeamName))]++ })
    minimumRunnerUpWins = Math.min(minimumRunnerUpWins, [...wins].sort((a, b) => b - a)[1])
    wins.forEach((won, index) => {
      const best = wins.filter((other) => other > won).length + 1
      const worst = wins.filter((other) => other >= won).length
      if (best === 1) canFirst[index] = true
      if (best <= 2 && worst >= 2) canSecond[index] = true
    })
  }
  return { canFirst, canSecond, minimumRunnerUpWins }
}

/** Group records use completed Cup games only. NBA regular-season records never substitute. */
export function nbaCupGroupStandings(series: GroupGame[], season: number, locale = "en"): CupGroupStanding[] {
  const copy = bracketCompanionCopy(locale).roads
  if (season !== 2026) return []
  const groups = GROUPS_2026.map((group) => {
    const games = series.filter((game) => game.round === "cup_group_play" && group.teams.some((team) => team === cupTeamName(game.homeTeamName)) && group.teams.some((team) => team === cupTeamName(game.awayTeamName)))
    const pairs = new Set(games.map((game) => [cupTeamName(game.homeTeamName), cupTeamName(game.awayTeamName)].sort().join("|")))
    const complete = games.length === 10 && pairs.size === 10 && group.teams.every((team) => games.filter((game) => [cupTeamName(game.homeTeamName), cupTeamName(game.awayTeamName)].includes(team)).length === 4)
    const paths = complete ? possibilities(group.teams, games) : null
    const teams: CupTeamStanding[] = group.teams.map((team, index) => {
      const played = games.filter((game) => game.status === "final" && game.winnerTeamName && [cupTeamName(game.homeTeamName), cupTeamName(game.awayTeamName)].includes(team))
      const wins = played.filter((game) => cupTeamName(game.winnerTeamName!) === team).length
      let differential: number | null = 0
      for (const game of played) {
        const details = cupGameDetails(game)
        if (details.period != null && details.period > 4) continue // NBA Cup OT differential is zero.
        if (details.period == null || game.liveHomeScore == null || game.liveAwayScore == null) { differential = null; break }
        differential += (cupTeamName(game.homeTeamName) === team ? 1 : -1) * (game.liveHomeScore - game.liveAwayScore)
      }
      return { team, wins, losses: played.length - wins, remaining: 4 - played.length, maxWins: wins + 4 - played.length,
        rank: 0, tied: false, differential, canWinGroup: paths?.canFirst[index] ?? null, canFinishSecond: paths?.canSecond[index] ?? null,
        status: "In contention", road: "" }
    })
    return { name: group.name, conference: group.conference, teams, scheduleComplete: complete, paths }
  })
  return groups.map((group) => ({ ...group, teams: group.teams.map((team) => {
    const rank = group.teams.filter((other) => other.wins > team.wins).length + 1
    const tied = group.teams.some((other) => other.team !== team.team && other.wins === team.wins)
    const confirmedQuarter = series.find((game) => game.round === "cup_quarterfinals" && [cupTeamName(game.homeTeamName), cupTeamName(game.awayTeamName)].includes(team.team))
    const peers = groups.filter((other) => other.conference === group.conference && other.name !== group.name)
    const wildcardClosed = team.canFinishSecond === false || peers.some((other) => other.paths && other.paths.minimumRunnerUpWins > team.maxWins)
    let status: CupTeamStanding["status"] = !group.scheduleComplete ? "Schedule pending" : team.remaining === 0 && tied ? "Tiebreak pending" : rank === 1 && team.wins > 0 ? "Group leader" : "In contention"
    let road = copy.base(team.remaining, team.maxWins)
    if (confirmedQuarter) { status = "Qualified"; road = copy.qualified }
    else if (team.canWinGroup && team.canFinishSecond === false) { status = "Group winner"; road = copy.won }
    else if (team.canWinGroup === false && wildcardClosed) { status = "Eliminated"; road = copy.eliminated }
    else if (!group.scheduleComplete) road += copy.syncing
    else if (team.canWinGroup) road += copy.lead
    else road += copy.wild
    return { ...team, rank, tied, status, road }
  }).sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.team.localeCompare(b.team)) }))
}
