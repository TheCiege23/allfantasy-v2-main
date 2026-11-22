import 'server-only'
import type { DraftPick, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { withControlLock } from '@/lib/draft/draftLock'
import { assessSeasonDraftCompletion } from './seasonDraftReview'
import { persistSeasonPreparedRosters } from './seasonRosterPreparation'
import { lockAndCheckSeasonRecovery } from './seasonRecoveryState'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { generateSchedule } from '@/lib/redraft/scheduleEngine'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { loadSeasonDraftContext } from './seasonDraftRuntime'
import { assignSeasonDraftLineup } from './seasonDraftPolicy'

type Context = NonNullable<Awaited<ReturnType<typeof loadSeasonDraftContext>>>
export const seasonScoringId = (leagueId: string) => seasonResourceId(leagueId, 'scoring')

export async function handoffCompletedSeasonDraft(leagueId: string, now: Date) {
  const candidate = await loadSeasonDraftContext(leagueId)
  if (!candidate) return false
  const locked = await withControlLock(leagueId, () => prisma.$transaction(async tx => {
    if (await lockAndCheckSeasonRecovery(tx, candidate.tournamentId)) return false
    const binding = await tx.tournamentLeague.findUnique({
      where: { leagueId }, include: { round: true, tournament: { select: { status: true, currentRoundNumber: true } } },
    })
    if (!binding || binding.round.status !== 'drafting' || binding.tournament.status !== 'rules_published'
      || binding.round.roundNumber !== candidate.stage || binding.tournament.currentRoundNumber !== candidate.stage) return false
    const review = await assessSeasonDraftCompletion(leagueId, tx)
    if (review?.state !== 'completed' || !review.session || !review.boardHash || review.context.manifestHash !== candidate.manifestHash) return false
    const picks = await tx.draftPick.findMany({ where: { sessionId: review.session.id }, orderBy: { overall: 'asc' } })
    const pickedAt = Math.max(...picks.map(pick => (pick.pickedAt ?? pick.createdAt).getTime()))
    if (!Number.isFinite(pickedAt) || pickedAt > now.getTime()) return false
    if (candidate.config.rules!.calendar.draftOverrides && pickedAt > Date.parse(candidate.draftWindow.completeBy)) return false
    await persistSeasonPreparedRosters(tx, leagueId, review)
    await materializeSeasonDraft(tx, leagueId, candidate, picks)
    await tx.tournamentLeague.update({ where: { leagueId }, data: { status: 'draft_ready', draftCompletedAt: new Date(pickedAt) } })
    return true
  }, { timeout: 20_000 }))
  return locked.acquired ? locked.value : false
}

/** Draft ownership, lineup and matchup storage commit with the completed board. */
async function materializeSeasonDraft(
  tx: Prisma.TransactionClient, leagueId: string, context: Context, picks: DraftPick[],
) {
  const seasonId = seasonScoringId(leagueId)
  if (await tx.redraftSeason.findUnique({ where: { id: seasonId } })) return
  const binding = await tx.tournamentLeague.findUniqueOrThrow({ where: { leagueId }, include: { round: true } })
  const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { season: true } })
  const { weekStart, weekEnd } = binding.round
  if (league.season == null || binding.round.roundNumber !== context.stage) throw new Error('Invalid tournament scoring binding.')
  const sport = context.config.sport
  await tx.redraftSeason.create({ data: {
    id: seasonId, leagueId, sport, season: league.season, status: 'setup',
    totalWeeks: weekEnd, playoffStartWeek: weekEnd + 1, currentWeek: weekStart,
  } })
  const rosters = context.pool.members.map((member, index) => ({
    member, genericId: context.rosterIds[index]!, id: seasonResourceId(seasonId, member.id),
  }))
  await tx.redraftRoster.createMany({ data: rosters.map(({ member, id }) => ({
    id, leagueId, seasonId, ownerId: member.userId, ownerName: member.displayName, teamName: member.displayName,
    avatarUrl: member.avatarUrl, waiverPriority: member.waiverPriority,
    faabBalance: context.config.rules!.waivers.mode === 'faab' ? context.config.rules!.waivers.budget : null,
  })) })
  const players: Prisma.RedraftRosterPlayerCreateManyInput[] = []
  for (const { member, id, genericId } of rosters) {
    const lineup = assignSeasonDraftLineup(context.config, picks.filter(pick => pick.rosterId === genericId))
    const roster = await tx.roster.findUniqueOrThrow({ where: { id: genericId }, select: { playerData: true } })
    const draftPicks = lineup.map(({ player, slotType }) => ({
      playerId: player.playerId!, playerName: player.playerName, position: player.position, team: player.team, slotType,
    }))
    players.push(...draftPicks.map((player, index) => ({
      ...player, id: seasonResourceId(id, 'player:' + (index + 1)), rosterId: id, sport,
    })))
    await tx.roster.update({ where: { id: genericId }, data: {
      redraftRosterId: id,
      playerData: toPrismaJsonInput({
        ...(roster.playerData as object), draftPicks, players: draftPicks.map(p => p.playerId),
        starters: draftPicks.filter(p => p.slotType !== 'BN').map(p => p.playerId),
      }),
    } })
    await tx.tournamentLeagueParticipant.update({
      where: { tournamentLeagueId_participantId: { tournamentLeagueId: binding.id, participantId: member.id } },
      data: { redraftRosterId: id },
    })
  }
  await tx.redraftRosterPlayer.createMany({ data: players })
  const weeks = weekEnd - weekStart + 1
  const schedule = generateSchedule(rosters, weeks, weeks + 1, sport)
  for (let week = 1; week <= weeks; week++) {
    const slots = schedule.filter(game => game.week === week).flatMap(game => game.away ? [game.home, game.away] : [game.home])
    if (slots.length !== rosters.length || new Set(slots).size !== rosters.length) throw new Error('The tournament matchup schedule is incomplete.')
  }
  await tx.redraftMatchup.createMany({ data: schedule.map(game => ({
    id: seasonResourceId(seasonId, 'match:' + game.week + ':' + game.home),
    seasonId, leagueId, week: game.week + weekStart - 1, type: 'regular',
    homeRosterId: game.home, awayRosterId: game.away,
  })) })
}
