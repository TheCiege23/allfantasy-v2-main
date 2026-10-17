/**
 * [NEW] lib/big-brother/BigBrotherHOHEngine.ts
 * Head of Household assignment. Enforces consecutive HOH block from config. PROMPT 2/6.
 */

import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'
import { getExcludedRosterIds } from './bigBrotherGuard'

/**
 * Get eligible roster IDs for HOH this week (not evicted; optionally exclude previous HOH if consecutive not allowed).
 */
export async function getEligibleHOHRosterIds(
  leagueId: string,
  configId: string,
  week: number,
  consecutiveHohAllowed: boolean
): Promise<string[]> {
  const excluded = await getExcludedRosterIds(leagueId)
  const rosters = await prisma.roster.findMany({
    where: { leagueId, id: { notIn: excluded } },
    select: { id: true },
  })
  let ids = rosters.map((r) => r.id)
  if (!consecutiveHohAllowed && week > 1) {
    const prev = await prisma.bigBrotherCycle.findUnique({
      where: { configId_week: { configId, week: week - 1 } },
      select: { hohRosterId: true },
    })
    if (prev?.hohRosterId) ids = ids.filter((id) => id !== prev.hohRosterId)
  }
  return ids
}

/**
 * Assign HOH for a cycle. Call after HOH challenge result is determined.
 * Validates: winner is eligible (not evicted, and not previous HOH if block enabled).
 */
export async function assignHOH(
  leagueId: string,
  configId: string,
  cycleId: string,
  winnerRosterId: string
): Promise<{ ok: boolean; error?: string }> {
  const config = await getBigBrotherConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Big Brother league' }
  if (config.configId !== configId) return { ok: false, error: 'Config mismatch' }

  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: cycleId },
    select: { id: true, week: true, leagueId: true, configId: true },
  })
  if (!cycle || cycle.leagueId !== leagueId || cycle.configId !== configId) return { ok: false, error: 'Cycle not found in this league' }

  const eligible = await getEligibleHOHRosterIds(
    leagueId,
    configId,
    cycle.week,
    config.consecutiveHohAllowed
  )
  if (!eligible.includes(winnerRosterId)) {
    return { ok: false, error: 'Winner not eligible for HOH (evicted or consecutive block)' }
  }

  await prisma.bigBrotherCycle.update({
    where: { id: cycleId },
    data: { hohRosterId: winnerRosterId },
  })
  return { ok: true }
}
