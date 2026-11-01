import "server-only"
import { prisma } from "@/lib/prisma"
import { getPlayoffBracketView } from "./playoffService"
import { buildBracketCoach, gameHasLocked, type CoachRival } from "./bracketCoach"
import { buildMatchupEvidence, coachTeamKey, type CoachStoredGame, type CoachInjury } from "./bracketCoachEvidence"
import { listInjuryFacts } from "@/lib/injuries/injuryReadPort"

type CoachUser = { id: string; email?: string | null; name?: string | null }
export class CoachAccessError extends Error { constructor(public status: number, message: string) { super(message) } }
export async function loadCoachView(input: { challengeId: string; entryId?: string | null; user: CoachUser }) {
  const view = await getPlayoffBracketView({ challengeId: input.challengeId, requestedEntryId: input.entryId, user: input.user })
  if (!view) throw new CoachAccessError(404, "Pool not found")
  if (view.challenge.ownerUserId !== input.user.id && !view.entries.some((row) => row.userId === input.user.id)) throw new CoachAccessError(403, "Join this pool before using its private coach")
  if (input.entryId && (!view.activeEntry || view.activeEntry.id !== input.entryId || view.activeEntry.userId !== input.user.id)) throw new CoachAccessError(404, "Your bracket was not found")
  return view
}
export async function loadBracketCoach(input: { challengeId: string; entryId?: string | null; rivalId?: string | null; timeZone?: string; user: CoachUser }) {
  const view = await loadCoachView(input)
  const now = Date.now()
  const selected = input.rivalId ? view.entries.find((row) => row.id === input.rivalId && row.isComplete && row.id !== view.activeEntry?.id)
    : view.entries.filter((row) => row.isComplete && row.id !== view.activeEntry?.id).sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0))[0]
  if (input.rivalId && !selected) throw new CoachAccessError(404, "Finalized comparison bracket not found in this pool")
  let rival: CoachRival | null = null
  if (selected && view.activeEntry) {
    const lockedIds = view.series.filter((game) => gameHasLocked(game, now)).map((game) => game.id)
    const picks = lockedIds.length ? await prisma.playoffBracketPick.findMany({
      where: { challengeId: input.challengeId, entryId: selected.id, seriesId: { in: lockedIds } }, select: { seriesId: true, pickTeamName: true },
    }) : []
    rival = { id: selected.id, name: selected.name, totalScore: selected.totalScore ?? 0, finalizedAt: selected.finalizedAt, picks }
  }
  return buildBracketCoach(view, rival, now, input.timeZone)
}
export async function loadMatchupEvidence(input: { challengeId: string; seriesId: string; user: CoachUser }) {
  const view = await loadCoachView(input)
  const game = view.series.find((row) => row.id === input.seriesId)
  if (!game) throw new CoachAccessError(404, "Matchup not found")
  const sport = view.challenge.sport === "nba_cup" ? "NBA" : view.challenge.sport.toUpperCase()
  const now = new Date(), names = [game.homeTeamName, game.awayTeamName]
  const aliases = [...new Set(names.flatMap((name) => [name, coachTeamKey(name, sport)]))]
  const [results, injuryFeed] = await Promise.all([
    prisma.sportsGame.findMany({ where: { sport, expiresAt: { gt: now }, startTime: { gte: new Date(now.getTime() - 30 * 86400000), lte: now },
      OR: [{ homeTeam: { in: aliases } }, { awayTeam: { in: aliases } }] }, orderBy: { startTime: "desc" }, take: 120,
      select: { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, status: true, startTime: true, fetchedAt: true, source: true } }).catch(() => []),
    listInjuryFacts({ sport, now, designationsOnly: true, maxAgeHours: 24, maxReportAgeHours: 24, limit: 300 }).catch(() => null),
  ])
  const stored: CoachStoredGame[] = results.map((row) => ({ ...row, startTime: row.startTime?.toISOString() ?? null, fetchedAt: row.fetchedAt.toISOString() }))
  // Persisted verified tournament finals remain useful when a short-lived scoreboard cache expires.
  for (const row of view.series) {
    if (row.status !== "final" || !row.winnerTeamName || !row.startsAt || Date.parse(row.startsAt) < now.getTime() - 30 * 86400000 || Date.parse(row.startsAt) > now.getTime()) continue
    stored.push({ homeTeam: row.homeTeamName, awayTeam: row.awayTeamName, homeScore: row.liveHomeScore ?? null, awayScore: row.liveAwayScore ?? null,
      status: "final", startTime: row.startsAt, fetchedAt: row.lastSyncedAt ?? row.startsAt, source: "verified_tournament_result" })
  }
  const injuries: CoachInjury[] = (injuryFeed?.facts ?? []).filter((row) => !row.stale && row.team && row.status && names.some((name) => coachTeamKey(name, sport) === coachTeamKey(row.team!, sport)))
    .map((row) => ({ player: row.playerName, team: row.team!, status: row.status!, reportedAt: row.reportedAt.toISOString(), source: row.source }))
  const coverage = !injuryFeed || !injuryFeed.coverage.sourceAvailable || injuryFeed.feedStale ? "Current injury coverage is unavailable or stale; availability is unknown."
    : "Only current verified injury reports are listed; absence of a report does not establish availability."
  return { view, evidence: buildMatchupEvidence(view, game, stored, injuries, coverage, now.getTime()) }
}
