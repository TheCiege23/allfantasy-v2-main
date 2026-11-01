import type { BracketTeamProfile, PlayoffChallengeView, PlayoffSeriesView } from "./types"
import { nbaCupLogoCode } from "@/lib/players/teamLogos"
import { nbaCupGroupStandings, cupTeamName } from "./nbaCupProgress"

export const coachTeamKey = (name: string, sport: string) => ["NBA", "NBA_CUP"].includes(sport.toUpperCase())
  ? nbaCupLogoCode(name) ?? name.toUpperCase() : name.toUpperCase().replace(/[^A-Z0-9]/g, "")
export type CoachStoredGame = { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; status: string | null; startTime: string | null; fetchedAt: string; source: string }
export type CoachInjury = { player: string; team: string; status: string; reportedAt: string; source: string }
export function buildMatchupEvidence(view: PlayoffChallengeView, game: PlayoffSeriesView, stored: CoachStoredGame[], injuries: CoachInjury[], injuryCoverage: string, now = Date.now()) {
  const key = (name: string) => coachTeamKey(name, view.challenge.sport)
  const start = game.startsAt ? Date.parse(game.startsAt) : now
  const groups = view.challenge.sport === "nba_cup" ? nbaCupGroupStandings(view.series, view.challenge.seasonYear) : []
  const profileFor = (name: string) => {
    const profile: BracketTeamProfile | undefined = view.teamProfiles?.[name]
    const rows = stored.filter((row) => row.startTime && Date.parse(row.startTime) < Math.min(now, start) && [row.homeTeam, row.awayTeam].some((team) => key(team) === key(name)))
    const unique = new Map<string, CoachStoredGame>()
    for (const row of rows) {
      const id = `${key(row.homeTeam)}:${key(row.awayTeam)}:${row.startTime}`
      if (!unique.has(id) || Date.parse(row.fetchedAt) > Date.parse(unique.get(id)!.fetchedAt)) unique.set(id, row)
    }
    const finals = [...unique.values()].filter((row) => /^(final|completed|finished|STATUS_FINAL)$/i.test(row.status ?? "") && row.homeScore != null && row.awayScore != null && row.homeScore !== row.awayScore)
      .sort((a, b) => Date.parse(b.startTime!) - Date.parse(a.startTime!)).slice(0, 10)
    const wins = finals.filter((row) => (key(row.homeTeam) === key(name) ? row.homeScore! > row.awayScore! : row.awayScore! > row.homeScore!)).length
    const cup = groups.flatMap((group) => group.teams).find((row) => row.team === cupTeamName(name))
    return { name, seasonRecord: profile?.won != null && profile.lost != null ? { wins: profile.won, losses: profile.lost } : null,
      recentForm: { games: finals.length, wins, losses: finals.length - wins, scope: "Available verified finals from the past 30 days; may be incomplete" },
      hoursSincePreviousTipoff: finals[0] && Number.isFinite(start) ? Math.round((start - Date.parse(finals[0].startTime!)) / 3600000) : null,
      cupRecord: cup ? { wins: cup.wins, losses: cup.losses, status: cup.status, road: cup.road } : null,
      injuries: injuries.filter((row) => key(row.team) === key(name)).map(({ player, status, reportedAt, source }) => ({ player, status, reportedAt, source })),
      sources: finals.map((row) => ({ source: row.source, asOf: row.fetchedAt })),
    }
  }
  const home = profileFor(game.homeTeamName), away = profileFor(game.awayTeamName)
  const factors: string[] = [], risks = ["This is an evidence-based lean, not a calibrated win probability.", injuryCoverage]
  let homeSignals = 0, awaySignals = 0
  if (home.seasonRecord && away.seasonRecord) {
    const hp = home.seasonRecord.wins / Math.max(1, home.seasonRecord.wins + home.seasonRecord.losses)
    const ap = away.seasonRecord.wins / Math.max(1, away.seasonRecord.wins + away.seasonRecord.losses)
    if (hp !== ap) { if (hp > ap) homeSignals++; else awaySignals++; factors.push(`${hp > ap ? home.name : away.name} has the stronger cached season win rate.`) }
    risks.push("The cached season record has no verified freshness timestamp.")
  } else risks.push("Verified season records are missing for one or both teams.")
  if (home.recentForm.games >= 3 && away.recentForm.games >= 3) {
    const h = home.recentForm.wins / home.recentForm.games, a = away.recentForm.wins / away.recentForm.games
    if (h !== a) { if (h > a) homeSignals++; else awaySignals++; factors.push(`${h > a ? home.name : away.name} won a larger share of the available recent finals.`) }
  } else risks.push("Too few verified recent games to compare form.")
  if (home.hoursSincePreviousTipoff != null && away.hoursSincePreviousTipoff != null && Math.abs(home.hoursSincePreviousTipoff - away.hoursSincePreviousTipoff) >= 24) {
    factors.push(`${home.hoursSincePreviousTipoff > away.hoursSincePreviousTipoff ? home.name : away.name} has at least one extra day between tipoffs. Actual travel and recovery are unknown.`)
  }
  const recommendation = homeSignals === awaySignals ? null : homeSignals > awaySignals ? home.name : away.name
  if (!recommendation) risks.push("The available signals do not establish a clear side.")
  return { seriesId: game.id, home, away, startsAt: game.startsAt, venue: game.venue ?? null,
    recommendation, factors, risks, dataQuality: home.recentForm.games >= 3 && away.recentForm.games >= 3 ? "partial" : "limited",
    asOf: new Date(now).toISOString(), sourceDescription: "Stored provider results, cached season standings and current injury read port. No browser-side provider fetches." }
}
export type MatchupEvidence = ReturnType<typeof buildMatchupEvidence>
