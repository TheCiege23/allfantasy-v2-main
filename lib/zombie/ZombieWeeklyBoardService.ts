/**
 * Zombie weekly board: deterministic data for "On the Chompin' Block", standings deltas, movement watch (PROMPT 353).
 */

import { getWhispererRosterId, getAllStatuses } from './ZombieOwnerStatusService'
import { getMovementProjections } from './ZombieMovementEngine'

export interface ZombieWeeklyBoardData {
  leagueId: string
  week: number
  whispererRosterId: string | null
  survivors: string[]
  zombies: string[]
  chompinBlockCandidates: string[] // e.g. lowest-scoring survivors
  potRemaining?: number
  weeklyStandingsDeltas?: { rosterId: string; delta: number }[]
  movementWatch: { rosterId: string; leagueId: string; reason: string; projectedLevelId: string | null }[]
}

export async function getWeeklyBoardData(
  leagueId: string,
  week: number,
  universeId?: string | null
): Promise<ZombieWeeklyBoardData> {
  const whispererRosterId = await getWhispererRosterId(leagueId)
  const statuses = await getAllStatuses(leagueId)
  const survivors = statuses.filter((s) => s.status === 'Survivor').map((s) => s.rosterId)
  const zombies = statuses.filter((s) => s.status === 'Zombie').map((s) => s.rosterId)

  let movementWatch: ZombieWeeklyBoardData['movementWatch'] = []
  if (universeId) {
    const projections = await getMovementProjections(universeId)
    movementWatch = projections.map((p) => ({
      rosterId: p.rosterId,
      leagueId: p.leagueId,
      reason: p.reason,
      projectedLevelId: p.projectedLevelId || null,
    }))
  }

  return {
    leagueId,
    week,
    whispererRosterId,
    survivors,
    zombies,
    chompinBlockCandidates: [], // caller can fill from lowest weekly scores
    movementWatch,
  }
}
