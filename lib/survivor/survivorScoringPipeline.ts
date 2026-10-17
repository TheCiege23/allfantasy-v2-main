/**
 * Survivor Scoring Pipeline — bridges sports-router to survivor weekly scoring.
 *
 * Fetches real game data via sports-router, calculates fantasy scores per roster,
 * and writes SurvivorWeeklyScore records. These scores drive:
 * - Tribe immunity (lowest tribe → elimination council)
 * - Individual immunity (highest scorer post-merge)
 * - Challenge results validation
 * - Exile island scoring
 */

import { prisma } from '@/lib/prisma'
import { getSportSchedule } from './sportScheduleEngine'
import { applySurvivorSitOutToScoring } from './SurvivorSitOutEngine'

/**
 * Sync weekly scores for a survivor league from the sports data pipeline.
 * Reads from redraft roster scoring (PlayerWeeklyScore) which is populated
 * by the redraft scoring system connected to sports-router.
 */
export async function syncSurvivorWeeklyScores(
  leagueId: string,
  week: number,
): Promise<{ scoredPlayers: number; tribeScores: Record<string, number> }> {
  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: { sport: true },
  })
  if (!league) throw new Error('League not found')

  // Get all active survivor players
  const players = await (prisma as any).survivorPlayer.findMany({
    where: { leagueId, playerState: { in: ['active', 'immune'] } },
    select: { id: true, userId: true, tribeId: true, redraftRosterId: true },
  })

  // Get boost/penalty effects for this week
  const effects = await (prisma as any).survivorIdol.findMany({
    where: {
      leagueId,
      isUsed: true,
      status: 'used',
      powerCategory: 'score',
    },
    select: { currentOwnerUserId: true, powerType: true },
  })

  const boostMap = new Map<string, number>()
  const penaltyMap = new Map<string, number>()
  for (const e of effects) {
    if (e.powerType === 'point_boost_10') boostMap.set(e.currentOwnerUserId, (boostMap.get(e.currentOwnerUserId) ?? 0) + 10)
    if (e.powerType === 'point_boost_20') boostMap.set(e.currentOwnerUserId, (boostMap.get(e.currentOwnerUserId) ?? 0) + 20)
    if (e.powerType === 'rival_penalty_10') penaltyMap.set(e.currentOwnerUserId, (penaltyMap.get(e.currentOwnerUserId) ?? 0) + 10)
  }

  const tribeScores: Record<string, number> = {}
  let scoredPlayers = 0

  for (const player of players) {
    // Get fantasy score from redraft scoring system
    let fantasyScore = 0

    if (player.redraftRosterId) {
      // Try to read from redraft lineup scoring
      const lineupScore = await (prisma as any).bestBallOptimizedLineup.findFirst({
        where: { rosterId: player.redraftRosterId, week },
        select: { totalPoints: true },
      })
      if (lineupScore) {
        fantasyScore = lineupScore.totalPoints ?? 0
      }
    }

    // If no redraft score, try PlayerWeeklyScore
    if (fantasyScore === 0) {
      const weeklyScore = await (prisma as any).playerWeeklyScore?.findFirst?.({
        where: { leagueId, userId: player.userId, week },
        select: { totalPoints: true },
      })
      if (weeklyScore) {
        fantasyScore = weeklyScore.totalPoints ?? 0
      }
    }

    const boost = boostMap.get(player.userId) ?? 0
    const penalty = penaltyMap.get(player.userId) ?? 0
    const finalScore = Math.max(0, fantasyScore + boost - penalty)

    // Upsert weekly score
    await (prisma as any).survivorWeeklyScore.upsert({
      where: {
        uniq_league_user_week: { leagueId, userId: player.userId, week },
      },
      create: {
        leagueId,
        userId: player.userId,
        week,
        fantasyScore,
        pointBoostApplied: boost,
        pointPenaltyApplied: penalty,
        finalScore,
        tribeId: player.tribeId,
        countedTowardTribeTotal: true,
        isFinalized: false,
      },
      update: {
        fantasyScore,
        pointBoostApplied: boost,
        pointPenaltyApplied: penalty,
        finalScore,
        tribeId: player.tribeId,
      },
    })

    // Accumulate tribe totals
    if (player.tribeId) {
      tribeScores[player.tribeId] = (tribeScores[player.tribeId] ?? 0) + finalScore
    }

    scoredPlayers++
  }

  await applySurvivorSitOutToScoring(leagueId, week)

  const adjustedRows = await (prisma as any).survivorWeeklyScore.findMany({
    where: { leagueId, week, countedTowardTribeTotal: true },
    select: { tribeId: true, finalScore: true },
  })
  const adjustedTribeScores: Record<string, number> = {}
  for (const row of adjustedRows) {
    if (!row.tribeId) continue
    adjustedTribeScores[row.tribeId] = (adjustedTribeScores[row.tribeId] ?? 0) + row.finalScore
  }

  return { scoredPlayers, tribeScores: adjustedTribeScores }
}

/**
 * Finalize weekly scores (mark as official, no more changes).
 */
export async function finalizeWeeklyScores(leagueId: string, week: number): Promise<void> {
  await (prisma as any).survivorWeeklyScore.updateMany({
    where: { leagueId, week, isFinalized: false },
    data: { isFinalized: true, finalizedAt: new Date() },
  })
}

/**
 * Determine which tribe lost (lowest total score) for elimination council.
 */
export async function getLosingTribe(
  leagueId: string,
  week: number,
): Promise<{ tribeId: string; tribeName: string; score: number } | null> {
  const scores = await (prisma as any).survivorWeeklyScore.findMany({
    where: { leagueId, week, countedTowardTribeTotal: true },
    select: { tribeId: true, finalScore: true },
  })

  const tribeScores: Record<string, number> = {}
  for (const s of scores) {
    if (s.tribeId) {
      tribeScores[s.tribeId] = (tribeScores[s.tribeId] ?? 0) + s.finalScore
    }
  }

  if (!Object.keys(tribeScores).length) return null

  const lowestTribeId = Object.entries(tribeScores).sort(([, a], [, b]) => a - b)[0]?.[0]
  if (!lowestTribeId) return null

  const tribe = await (prisma as any).survivorTribe.findUnique({
    where: { id: lowestTribeId },
    select: { name: true },
  })

  return {
    tribeId: lowestTribeId,
    tribeName: tribe?.name ?? 'Unknown Tribe',
    score: tribeScores[lowestTribeId]!,
  }
}

/**
 * Determine individual immunity winner (highest scorer post-merge).
 */
export async function getIndividualImmunityWinner(
  leagueId: string,
  week: number,
): Promise<{ userId: string; displayName: string; score: number } | null> {
  const scores = await (prisma as any).survivorWeeklyScore.findMany({
    where: { leagueId, week },
    orderBy: { finalScore: 'desc' },
    take: 1,
    select: { userId: true, finalScore: true },
  })

  if (!scores.length) return null

  const player = await (prisma as any).survivorPlayer.findFirst({
    where: { leagueId, userId: scores[0].userId },
    select: { displayName: true },
  })

  return {
    userId: scores[0].userId,
    displayName: player?.displayName ?? scores[0].userId,
    score: scores[0].finalScore,
  }
}
