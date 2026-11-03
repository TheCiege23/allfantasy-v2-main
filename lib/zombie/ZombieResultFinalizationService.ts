/**
 * Zombie result finalization: run after matchup results lock (PROMPT 353).
 * Sequence: infection -> serum awards (high score, bash/maul) -> weapon awards -> weekly winnings.
 */

import { prisma } from '@/lib/prisma'
import { getZombieLeagueConfig } from './ZombieLeagueConfig'
import { getRosterTeamMap } from './rosterTeamMap'
import { runInfectionForWeek } from './ZombieInfectionEngine'
import { awardSerum } from './ZombieSerumEngine'
import { awardWeaponByScore } from './ZombieWeaponEngine'
import { recordWinnings } from './ZombieWeeklyWinningsLedger'

export interface FinalizeWeekInput {
  leagueId: string
  week: number
  season?: number
  zombieLeagueId?: string | null
}

/**
 * Get weekly points by roster (from TeamPerformance via roster-team map).
 */
async function getWeeklyPointsByRoster(
  leagueId: string,
  season: number,
  week: number
): Promise<Map<string, number>> {
  const map = await getRosterTeamMap(leagueId)
  const teamIds = [...map.teamIdToRosterId.keys()]
  const perfs = await prisma.teamPerformance.findMany({
    where: { teamId: { in: teamIds }, season, week },
    select: { teamId: true, points: true },
  })
  const out = new Map<string, number>()
  for (const p of perfs) {
    const rosterId = map.teamIdToRosterId.get(p.teamId)
    if (rosterId) out.set(rosterId, p.points)
  }
  return out
}

/**
 * Run full finalization for one league/week.
 */
export async function finalizeWeek(input: FinalizeWeekInput): Promise<{
  infectionCount: number
  serumAwards: number
  weaponAwards: number
}> {
  const native = await prisma.zombieLeague.findUnique({ where: { leagueId: input.leagueId } })
  if (native?.sport === 'NFL' && await prisma.redraftSeason.findFirst({ where: { leagueId: input.leagueId, season: input.season ?? native.season }, select: { id: true } })) {
    const { runWeeklyResolution } = await import('./weeklyResolutionEngine')
    const result = await runWeeklyResolution(native.id, input.week)
    if (result.skipped || !result.resolution) throw new Error(result.reason ?? 'Native Zombie results are not ready.')
    return { infectionCount: result.resolution.infectionCount, serumAwards: Array.isArray(result.resolution.serumAwards) ? result.resolution.serumAwards.length : 0, weaponAwards: Array.isArray(result.resolution.weaponAwards) ? result.resolution.weaponAwards.length : 0 }
  }
  const config = await getZombieLeagueConfig(input.leagueId)
  if (!config) return { infectionCount: 0, serumAwards: 0, weaponAwards: 0 }

  const season = input.season ?? new Date().getFullYear()
  const { leagueId, week, zombieLeagueId } = input

  const infectionOutcome = await runInfectionForWeek({
    leagueId,
    week,
    season,
    zombieLeagueId,
  })

  const pointsByRoster = await getWeeklyPointsByRoster(leagueId, season, week)
  let serumAwards = 0
  let weaponAwards = 0

  if (config.serumAwardHighScore && pointsByRoster.size > 0) {
    const maxPoints = Math.max(...pointsByRoster.values())
    const winners = [...pointsByRoster.entries()].filter(([, p]) => p === maxPoints)
    for (const [rosterId] of winners) {
      await awardSerum(leagueId, rosterId, 'high_score', week, zombieLeagueId)
      serumAwards++
    }
  }

  for (const [rosterId, points] of pointsByRoster) {
    const awarded = await awardWeaponByScore(leagueId, rosterId, points, week, zombieLeagueId)
    if (awarded) weaponAwards++
  }

  const matchups = await prisma.matchupFact.findMany({
    where: { leagueId, weekOrPeriod: week, season },
    select: { teamA: true, teamB: true, scoreA: true, scoreB: true, winnerTeamId: true },
  })
  const map = await getRosterTeamMap(leagueId)
  for (const m of matchups) {
    if (!m.winnerTeamId) continue
    const winnerRosterId = map.teamIdToRosterId.get(m.winnerTeamId)
    const loserTeamId = m.winnerTeamId === m.teamA ? m.teamB : m.teamA
    const loserRosterId = map.teamIdToRosterId.get(loserTeamId)
    if (winnerRosterId) {
      const winnerScore = m.winnerTeamId === m.teamA ? m.scoreA : m.scoreB
      await recordWinnings(leagueId, winnerRosterId, week, winnerScore, 'matchup', zombieLeagueId)
    }
    if (loserRosterId) {
      const loserScore = m.winnerTeamId === m.teamA ? m.scoreB : m.scoreA
      await recordWinnings(leagueId, loserRosterId, week, loserScore, 'matchup', zombieLeagueId)
    }
  }

  return {
    infectionCount: infectionOutcome.infected.length,
    serumAwards,
    weaponAwards,
  }
}
