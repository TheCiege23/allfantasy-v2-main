/**
 * Survivor jury: enroll voted-out roster when past jury start (PROMPT 346). Deterministic.
 */

import { prisma } from '@/lib/prisma'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { appendSurvivorAudit } from './SurvivorAuditLog'

/**
 * Check if this vote-out should join jury (first N eliminations after merge are jury).
 */
export async function shouldJoinJury(leagueId: string, week: number): Promise<boolean> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return false

  const mergeWeek = config.mergeWeek ?? 0
  if (week < mergeWeek) return false

  const juryCount = await prisma.survivorJuryMember.count({
    where: { leagueId },
  })
  return juryCount < config.juryStartAfterMerge
}

/**
 * Enroll a roster in jury (call after elimination when shouldJoinJury).
 */
export async function enrollJuryMember(leagueId: string, rosterId: string, votedOutWeek: number): Promise<void> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return

  await prisma.survivorJuryMember.upsert({
    where: { leagueId_rosterId: { leagueId, rosterId } },
    create: { leagueId, rosterId, votedOutWeek },
    update: {},
  })
  await appendSurvivorAudit(leagueId, config.configId, 'jury_joined', { rosterId, votedOutWeek })
}

/**
 * Get jury members for a league.
 */
export async function getJuryMembers(leagueId: string) {
  return prisma.survivorJuryMember.findMany({
    where: { leagueId },
    orderBy: { joinedAt: 'asc' },
  })
}
