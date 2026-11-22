import { finalizeNativeTournamentSeason } from './finalizeNativeTournamentSeason'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assignEntriesToPods, advancePodWinners } from './contestEngine'

import { tournamentRoundEnds, isNativeTournamentLeague } from './tournamentCalendar'

/** Stable roster IDs give each drafted team exactly one contest entry. */
export async function ensureNativeTournamentEntries(leagueId: string, seasonId: string): Promise<void> {
  const contestId = await prisma.$transaction(async tx => {
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { bbContestId: true, bestBallMode: true, settings: true } })
    if (!isNativeTournamentLeague(league) || !league?.bbContestId) return null
    const contest = await tx.bestBallContest.findUniqueOrThrow({ where: { id: league.bbContestId } })
    if (contest.status !== 'open') return contest.id
    const draft = await tx.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } })
    if (draft?.status !== 'completed') throw new Error('Tournament draft is not completed')
    const season = await tx.redraftSeason.findUniqueOrThrow({ where: { id: seasonId }, include: { rosters: { include: { players: { where: { droppedAt: null } } } } } })
    if (season.leagueId !== leagueId) throw new Error('Tournament season does not belong to league')
    if (!season.rosters.length || season.rosters.some(roster => roster.players.length < contest.rosterSize)) throw new Error('Tournament draft rosters are incomplete')
    for (const roster of season.rosters) {
      await tx.bestBallEntry.upsert({
        where: { id: contest.id + ':' + roster.id },
        create: { id: contest.id + ':' + roster.id, contestId: contest.id, userId: roster.ownerId, entryName: roster.teamName ?? roster.ownerName,
          roster: roster.players.map(player => ({ playerId: player.playerId, playerName: player.playerName, position: player.position })) as Prisma.InputJsonValue },
        update: {},
      })
    }
    await tx.bestBallContest.update({ where: { id: contest.id }, data: { totalEntries: season.rosters.length } })
    return contest.id
  }, { isolationLevel: 'Serializable', timeout: 30_000 })
  if (!contestId) return
  await assignEntriesToPods(contestId)
  const draft = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { id: true } })
  if (draft) await prisma.bestBallPod.updateMany({ where: { contestId, roundNumber: 1, status: 'forming' }, data: { draftSessionId: draft.id, status: 'active' } })
  await prisma.bestBallContest.updateMany({ where: { id: contestId, status: 'open' }, data: { status: 'active' } })
}

/**
 * 🛑 A RENEWED TOURNAMENT LEAGUE ENDED ITS NEW SEASON ON THE FIRST TICK. A contest is created once, at
 * league creation, and nothing on renewal replaced it — so year two still pointed at year one's
 * COMPLETED contest, and the branch below took "complete" to mean "this season is over", finalized the
 * new season and moved the league to completed. A contest belongs to the season whose rosters hold its
 * entries (`${contestId}:${rosterId}`, see ensureNativeTournamentEntries); a completed one with entries
 * but none for this season is last year's. It is replaced, with the same settings, by a fresh open
 * contest for this season. Done here rather than in renewal so every renewal path is covered.
 */
async function currentSeasonContestId(season: { id: string; leagueId: string }, contestId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const league = await tx.league.findUniqueOrThrow({ where: { id: season.leagueId }, select: { bbContestId: true } })
    // Another tick already rolled it.
    if (league.bbContestId && league.bbContestId !== contestId) return league.bbContestId
    const contest = await tx.bestBallContest.findUniqueOrThrow({ where: { id: contestId } })
    if (contest.status !== 'complete') return contestId
    const rosters = await tx.redraftRoster.findMany({ where: { seasonId: season.id }, select: { id: true } })
    const ownIds = rosters.map((r) => `${contestId}:${r.id}`)
    const [entries, ours] = await Promise.all([
      tx.bestBallEntry.count({ where: { contestId } }),
      tx.bestBallEntry.count({ where: { contestId, id: { in: ownIds } } }),
    ])
    if (entries === 0 || ours > 0) return contestId
    const fresh = await tx.bestBallContest.create({
      data: {
        name: contest.name, sport: contest.sport, variant: contest.variant,
        podSize: contest.podSize, rosterSize: contest.rosterSize, rounds: contest.rounds,
        advancersPerPod: contest.advancersPerPod, draftType: contest.draftType, draftSpeed: contest.draftSpeed,
        entryType: contest.entryType, maxEntriesPerUser: contest.maxEntriesPerUser,
        scoringPeriod: contest.scoringPeriod, cumulativeScoring: contest.cumulativeScoring,
        resetBetweenRounds: contest.resetBetweenRounds,
      },
    })
    await tx.league.update({ where: { id: season.leagueId }, data: { bbContestId: fresh.id } })
    return fresh.id
  }, { isolationLevel: 'Serializable', timeout: 30_000 })
}

/** Missing or unsealed native matchup scores never become zero-point results. */
export async function runNativeTournamentWeek(seasonId: string, throughWeek: number): Promise<string> {
  if (!Number.isInteger(throughWeek) || throughWeek < 1) throw new Error('Invalid scoring period')
  const season = await prisma.redraftSeason.findUniqueOrThrow({ where: { id: seasonId }, include: { league: true } })
  const storedContestId = season.league.bbContestId
  if (!isNativeTournamentLeague(season.league) || !storedContestId) return 'not_tournament'
  /*
   * 🛑 AND LAST SEASON KEPT FINALIZING THE LEAGUE. score-sync keeps a completed tournament season in its
   * batch while the league is post_draft..completed so a failed archive can retry — which after a
   * renewal is the NEW season's lifecycle. Each tick then re-finalized the old season, and that
   * transition moved the renewed, in-season league to `completed`. A completed season with a newer one
   * behind it was archived before the renewal could start (renewal begins from the offseason).
   */
  if (season.status === 'complete') {
    const newer = await prisma.redraftSeason.findFirst({
      where: { leagueId: season.leagueId, id: { not: season.id }, createdAt: { gt: season.createdAt } },
      select: { id: true },
    })
    if (newer) return 'superseded'
  }
  let contestId = storedContestId
  let contest = await prisma.bestBallContest.findUniqueOrThrow({ where: { id: contestId } })
  // Only a completed contest can be last season's; roll it before reading "complete" as "this season is over".
  if (contest.status === 'complete') {
    const current = await currentSeasonContestId(season, contestId)
    if (current !== contestId) {
      contestId = current
      contest = await prisma.bestBallContest.findUniqueOrThrow({ where: { id: contestId } })
    }
  }
  if (contest.status === 'complete') {
    await finalizeNativeTournamentSeason(seasonId)
    return 'complete'
  }
  if (contest.status !== 'active') {
    const draft = await prisma.draftSession.findFirst({ where: { leagueId: season.leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } })
    if (contest.status === 'open' && draft?.status === 'completed') await ensureNativeTournamentEntries(season.leagueId, seasonId)
    return 'waiting_for_draft'
  }
  const root = (season.league.settings ?? {}) as Record<string, unknown>
  const settings = root.best_ball_settings as { regularSeasonLength: number; tournamentAdvancementRounds: number; roundEndWeeks?: number[] } | undefined
  if (!settings || contest.scoringPeriod !== 'weekly') return 'calendar_unavailable'
  const ends = tournamentRoundEnds(settings)
  if (ends.length !== contest.rounds) throw new Error('Tournament calendar does not match contest')
  const entries = await prisma.bestBallEntry.findMany({ where: { contestId, isEliminated: false } })
  const round = entries[0]?.currentRound
  if (!round || entries.some(entry => entry.currentRound !== round)) throw new Error('Tournament round requires recovery')
  const start = round === 1 ? 1 : ends[round - 2]! + 1
  const end = Math.min(throughWeek, ends[round - 1]!)
  if (end < start) return 'waiting_for_round'
  const results: { id: string; scores: { week: number; points: number }[] }[] = []
  for (const entry of entries) {
    const rosterId = entry.id.startsWith(contestId + ':') ? entry.id.slice(contestId.length + 1) : null
    if (!rosterId) return 'entry_mapping_unavailable'
    const rows = await prisma.redraftMatchup.findMany({ where: { seasonId, isMedianMatchup: false, week: { gte: contest.resetBetweenRounds ? start : 1, lte: end }, OR: [{ homeRosterId: rosterId }, { awayRosterId: rosterId }] } })
    const scores: { week: number; points: number }[] = []
    for (let week = contest.resetBetweenRounds ? start : 1; week <= end; week++) {
      const row = rows.find(row => row.week === week)
      if (row?.status !== 'final') return 'waiting_for_final_scores'
      const points = row.homeRosterId === rosterId ? row.homeScore : row.awayScore
      if (!Number.isFinite(points)) return 'waiting_for_final_scores'
      scores.push({ week, points })
    }
    results.push({ id: entry.id, scores })
  }
  await prisma.$transaction(async tx => {
    const fresh = await tx.bestBallEntry.findMany({ where: { contestId, isEliminated: false } })
    if (fresh.length !== entries.length || fresh.some(entry => entry.currentRound !== round || !entries.some(original => original.id === entry.id))) throw new Error('Tournament round changed during scoring')
    for (const result of results) await tx.bestBallEntry.update({ where: { id: result.id }, data: { weeklyScores: result.scores, totalPoints: contest.cumulativeScoring ? result.scores.reduce((sum, row) => sum + row.points, 0) : result.scores.at(-1)!.points } })
  }, { isolationLevel: 'Serializable' })
  if (end < ends[round - 1]!) return 'scored'
  const tie = season.league.bbTiebreaker
  await advancePodWinners(contestId, round, tie === 'max_week' || tie === 'points_for' ? tie : 'advance_all')
  if (round === contest.rounds) await finalizeNativeTournamentSeason(seasonId)
  return round === contest.rounds ? 'complete' : 'advanced'
}
