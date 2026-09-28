import { prisma } from '@/lib/prisma'
import { transitionLeagueStateInTransaction } from '@/server/services/leagueLifecycleService'
import { enterRedraftOffseason } from '@/lib/redraft/offseason/RedraftOffseasonService'
import { isNativeTournamentLeague } from './tournamentCalendar'

/** Completion can commit before archival. Every retry repairs the remaining handoff. */
export async function finalizeNativeTournamentSeason(seasonId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    const season = await tx.redraftSeason.findUniqueOrThrow({ where: { id: seasonId }, include: { league: true } })
    if (!isNativeTournamentLeague(season.league) || !season.league.bbContestId) throw new Error('Not a native tournament season')
    const contest = await tx.bestBallContest.findUniqueOrThrow({ where: { id: season.league.bbContestId } })
    if (contest.status !== 'complete') throw new Error('Tournament is not complete')
    let state = season.league.lifecycleState
    if (!['post_draft', 'in_season', 'playoffs', 'completed', 'offseason'].includes(state)) throw new Error('Tournament completion has an invalid league phase')
    const transition = async (nextState: 'in_season' | 'completed') => {
      await transitionLeagueStateInTransaction(tx, { leagueId: season.leagueId, nextState, actorUserId: 'system:native-tournament', source: 'engine:native-tournament', idempotencyKey: `tournament:${seasonId}:${nextState}`, metadata: { seasonId, contestId: contest.id } })
      state = nextState
    }
    if (state === 'post_draft') await transition('in_season')
    if (state === 'in_season' || state === 'playoffs') await transition('completed')
    await tx.redraftSeason.update({ where: { id: seasonId }, data: { status: 'complete' } })
  }, { isolationLevel: 'Serializable', timeout: 30_000 })
  const archived = await enterRedraftOffseason(seasonId, 'system:native-tournament')
  if (!archived.ok) throw new Error(`Tournament archival refused: ${archived.code}`)
}
