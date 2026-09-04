/**
 * RemainingScheduleSimulator
 *
 * Builds the remaining schedule (weeks currentWeek+1 .. totalWeeks) of matchups.
 * Uses WeeklyMatchup when available; otherwise generates round-robin.
 */

import { prisma } from '@/lib/prisma'

export interface RemainingScheduleInput {
  leagueId: string
  season: number
  currentWeek: number
  totalWeeks: number
  teamIds: string[]
}

/**
 * Round-robin schedule for one week: pair teams so each plays once.
 * Position 0 fixed; positions 1..n-1 rotate left by weekIndex.
 */
function roundRobinPairings(teamIds: string[], weekIndex: number): [string, string][] {
  const n = teamIds.length
  if (n < 2) return []

  const order = [...teamIds]
  // Rotate positions 1..n-1 left by weekIndex
  const rest = order.slice(1)
  for (let r = 0; r < weekIndex; r++) {
    rest.push(rest.shift()!)
  }
  const rotated = [order[0], ...rest]

  const pairs: [string, string][] = []
  for (let i = 0; i < Math.floor(n / 2); i++) {
    pairs.push([rotated[2 * i], rotated[2 * i + 1]])
  }
  return pairs
}

/**
 * Fetch completed matchups from WeeklyMatchup to infer schedule pattern,
 * then fill remaining weeks with same pattern or round-robin.
 */
export async function getRemainingSchedule(
  input: RemainingScheduleInput
): Promise<Array<[string, string][]>> {
  const { leagueId, season, currentWeek, totalWeeks, teamIds } = input
  const remainingWeeks = Math.max(0, totalWeeks - currentWeek)
  if (remainingWeeks === 0 || teamIds.length < 2) return []

  const schedule: Array<[string, string][]> = []

  // Try to get actual matchups for a past week to learn pairing pattern
  const past = await prisma.weeklyMatchup.findMany({
    where: {
      leagueId,
      seasonYear: season,
      week: { gte: 1, lte: Math.min(currentWeek, totalWeeks) },
    },
    orderBy: { week: 'asc' },
  })

  const teamIdSet = new Set(teamIds)
  // WeeklyMatchup.rosterId is String now (see the migration's README entry), so
  // this is an identity function -- kept so the pairing logic below reads the
  // same regardless of which id space `r` happens to be in.
  const rosterIdToTeamId = (r: string) => r

  // Group past by week and matchupId; each group of 2 rosterIds = one pairing
  const pairingsByWeek = new Map<number, [string, string][]>()
  const weekMatchupToRosters = new Map<string, string[]>()
  for (const row of past) {
    const key = `${row.week}:${row.matchupId ?? row.rosterId}`
    const list = weekMatchupToRosters.get(key) ?? []
    list.push(row.rosterId)
    weekMatchupToRosters.set(key, list)
  }
  for (const [key, rosterIds] of weekMatchupToRosters) {
    const [weekStr] = key.split(':')
    const week = parseInt(weekStr, 10)
    if (rosterIds.length >= 2) {
      const a = rosterIdToTeamId(rosterIds[0])
      const b = rosterIdToTeamId(rosterIds[1])
      if (teamIdSet.has(a) && teamIdSet.has(b)) {
        if (!pairingsByWeek.has(week)) pairingsByWeek.set(week, [])
        pairingsByWeek.get(week)!.push([a, b])
      }
    }
  }

  // Future weeks: use round-robin (we don't have future schedule in DB; real schedule would come from platform API)
  for (let w = 0; w < remainingWeeks; w++) {
    schedule.push(roundRobinPairings(teamIds, w))
  }

  return schedule
}
