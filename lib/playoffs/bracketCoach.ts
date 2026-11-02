import type { PlayoffChallengeView, PlayoffSeriesView } from "./types"
import { pointsForSeries } from "./playoffScoring"
import { nbaCupGroupStandings, cupTeamName } from "./nbaCupProgress"

export type CoachPick = { seriesId: string; pickTeamName: string }
export type CoachRival = { id: string; name: string; totalScore: number; finalizedAt?: string | null; picks: CoachPick[] }
export type CoachGame = {
  id: string; home: string; away: string; startsAt: string | null; status: string; points: number
  pick: string | null; eligible: boolean; locked: boolean; homeScore: number | null; awayScore: number | null
}
export const gameHasLocked = (game: Pick<PlayoffSeriesView, "status" | "startsAt">, now: number) =>
  game.status === "in_progress" || game.status === "final" || Boolean(game.startsAt && Number.isFinite(Date.parse(game.startsAt)) && Date.parse(game.startsAt) <= now)

export function eligibleCoachPick(view: PlayoffChallengeView, game: PlayoffSeriesView, finalizedAt?: string | null): boolean {
  if (["nba_cup", "ncaaf"].includes(view.challenge.sport) && !view.challenge.isTestMode) {
    return Boolean(finalizedAt && game.startsAt && Date.parse(finalizedAt) < Date.parse(game.startsAt))
  }
  return true
}
function localDay(time: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(time)
}
export function validCoachTimeZone(value: string | null): string {
  try { localDay(Date.now(), value ?? "America/New_York"); return value ?? "America/New_York" } catch { return "America/New_York" }
}

/** Rival picks enter only after their own game locks; drafts never enter comparisons or rooting. */
export function buildBracketCoach(view: PlayoffChallengeView, rival: CoachRival | null, now = Date.now(), zone = "America/New_York") {
  if (rival && !rival.finalizedAt) rival = null
  const timeZone = validCoachTimeZone(zone)
  const myPicks = new Map(view.picks.map((pick) => [pick.seriesId, pick.pickTeamName]))
  const rivalPicks = new Map(rival?.picks.map((pick) => [pick.seriesId, pick.pickTeamName]) ?? [])
  const finalized = Boolean(view.activeEntry?.isComplete && view.activeEntry.finalizedAt)
  const games: CoachGame[] = view.series.map((game) => {
    const selected = myPicks.get(game.id)
    const pick = selected && [game.homeTeamName, game.awayTeamName].includes(selected) ? selected : null
    return { id: game.id, home: game.homeTeamName, away: game.awayTeamName, startsAt: game.startsAt,
      status: game.status, points: pointsForSeries(game, view.challenge.sport), pick,
      eligible: finalized && eligibleCoachPick(view, game, view.activeEntry?.finalizedAt),
      locked: gameHasLocked(game, now), homeScore: game.liveHomeScore ?? null, awayScore: game.liveAwayScore ?? null }
  })
  const byId = new Map(view.series.map((game) => [game.id, game]))
  const today = localDay(now, timeZone)
  const tonight = games.filter((game) => game.status === "in_progress" || Boolean(game.startsAt && Number.isFinite(Date.parse(game.startsAt)) && localDay(Date.parse(game.startsAt), timeZone) === today))
    .sort((a, b) => Number(b.status === "in_progress") - Number(a.status === "in_progress") || Date.parse(a.startsAt ?? "") - Date.parse(b.startsAt ?? ""))
  const nextLocks = games.filter((game) => !game.locked && game.startsAt && Date.parse(game.startsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!))
  const gap = (view.activeEntry?.totalScore ?? 0) - (rival?.totalScore ?? 0)
  const comparisons = rival ? games.filter((game) => game.locked).map((game) => {
    const original = byId.get(game.id)!
    const other = rivalPicks.get(game.id)
    const theirPick = other && [game.home, game.away].includes(other) && eligibleCoachPick(view, original, rival.finalizedAt) ? other : null
    return { ...game, myPick: game.eligible ? game.pick : null, theirPick, winner: original.winnerTeamName }
  }).filter((game) => game.myPick || game.theirPick) : []
  const rooting = comparisons.filter((game) => game.status !== "final" && !game.winner && game.myPick && game.myPick !== game.theirPick).map((game) => ({
    id: game.id, home: game.home, away: game.away, rootFor: game.myPick!, points: game.points,
    gapNow: gap,
    gapIfHomeWins: gap + (game.myPick === game.home ? game.points : 0) - (game.theirPick === game.home ? game.points : 0),
    gapIfAwayWins: gap + (game.myPick === game.away ? game.points : 0) - (game.theirPick === game.away ? game.points : 0),
  }))
  const recent = games.filter((game) => game.status === "final" && game.startsAt && Date.parse(game.startsAt) >= now - 24 * 3600_000 && Date.parse(game.startsAt) <= now)
    .map((game) => { const winner = byId.get(game.id)?.winnerTeamName; return { ...game, winner: winner ?? null, earned: game.eligible && game.pick === winner ? game.points : 0,
      missed: game.eligible && game.pick && winner && game.pick !== winner ? game.points : 0 } })
  return {
    generatedAt: new Date(now).toISOString(), timeZone, entry: view.activeEntry ? { id: view.activeEntry.id, name: view.activeEntry.name, finalized, score: view.activeEntry.totalScore ?? 0 } : null,
    tonight, nextLocks: nextLocks.slice(0, 6), missingPicks: nextLocks.filter((game) => !game.pick).length,
    rival: rival ? { id: rival.id, name: rival.name, totalScore: rival.totalScore } : null,
    comparisons, rooting, recap: { games: recent, pointsEarned: recent.reduce((sum, game) => sum + game.earned, 0), pointsMissed: recent.reduce((sum, game) => sum + game.missed, 0),
      rounds: [...new Set(recent.map((game) => byId.get(game.id)!.round))].map((round) => ({ round, points: recent.filter((game) => byId.get(game.id)!.round === round).reduce((sum, game) => sum + game.earned, 0) })) },
    rivals: view.entries.filter((entry) => entry.isComplete && entry.finalizedAt && entry.id !== view.activeEntry?.id).slice(0, 100).map((entry) => ({ id: entry.id, name: entry.name, totalScore: entry.totalScore ?? 0 })),
  }
}
export type BracketCoach = ReturnType<typeof buildBracketCoach> & { experience?: import("./bracketExperience").BracketExperience }

/** Hypothetical wins change records only. They never invent scores, tiebreakers or qualifiers. */
export function qualificationScenarios(series: PlayoffSeriesView[], season: number, selectedTeam: string, locale = "en") {
  const team = cupTeamName(selectedTeam)
  const groups = nbaCupGroupStandings(series, season, locale)
  const group = groups.find((row) => row.teams.some((row) => row.team === team))
  if (!group) return []
  const describe = (winner: string, gameId: string) => {
    const hypothetical = series.map((game) => game.id === gameId ? { ...game, status: "final" as const, winnerTeamName: winner, liveHomeScore: null, liveAwayScore: null, providerGamesJson: {} } : game)
    const row = nbaCupGroupStandings(hypothetical, season, locale).flatMap((group) => group.teams).find((row) => row.team === team)!
    return { wins: row.wins, losses: row.losses, status: row.status, road: row.road, canWinGroup: row.canWinGroup, canFinishSecond: row.canFinishSecond }
  }
  const sameGroup = new Set(group.teams.map((row) => row.team))
  const conference = new Set(groups.filter((row) => row.conference === group.conference).flatMap((row) => row.teams.map((row) => row.team)))
  return series.filter((game) => game.round === "cup_group_play" && game.status !== "final" && !game.winnerTeamName && game.startsAt &&
    conference.has(cupTeamName(game.homeTeamName)) && conference.has(cupTeamName(game.awayTeamName)))
    .sort((a, b) => {
      const priority = (game: PlayoffSeriesView) => [game.homeTeamName, game.awayTeamName].map(cupTeamName).includes(team) ? 2 : sameGroup.has(cupTeamName(game.homeTeamName)) ? 1 : 0
      return priority(b) - priority(a) || Date.parse(a.startsAt!) - Date.parse(b.startsAt!)
    })
    .slice(0, 12).map((game) => ({ id: game.id, home: game.homeTeamName, away: game.awayTeamName, ifHomeWins: describe(game.homeTeamName, game.id), ifAwayWins: describe(game.awayTeamName, game.id) }))
}
