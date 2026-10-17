import type { Prisma } from '@prisma/client'
import { getBigBrotherFinalists } from './BigBrotherFinalists'
/**
 * [NEW] lib/big-brother/BigBrotherJuryEngine.ts
 * Jury: when eliminated users become jury; finale vote. PROMPT 2/6.
 */

import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'
import { appendBigBrotherAudit } from './BigBrotherAuditLog'

/**
 * Check if the next evictee should join jury (by config: after_eliminations, when_remaining, or fixed_week).
 */
export async function shouldJoinJury(leagueId: string, week: number, remainingCount: number): Promise<boolean> {
  const config = await getBigBrotherConfig(leagueId)
  if (!config) return false

  switch (config.juryStartMode) {
    case 'after_eliminations': {
      const eliminated = await prisma.bigBrotherCycle.count({
        where: { leagueId, evictedRosterId: { not: null } },
      })
      return eliminated >= (config.juryStartAfterEliminations ?? 0)
    }
    case 'when_remaining':
      return remainingCount <= (config.juryStartWhenRemaining ?? 0)
    case 'fixed_week':
      return week >= (config.juryStartWeek ?? 0)
    default:
      return false
  }
}

/**
 * Enroll an evicted roster as jury member (call after eviction when shouldJoinJury).
 */
export async function enrollJuryMember(leagueId: string, configId: string, rosterId: string, evictedWeek: number): Promise<void> {
  await prisma.bigBrotherJuryMember.upsert({
    where: { leagueId_rosterId: { leagueId, rosterId } },
    create: { leagueId, configId, rosterId, evictedWeek },
    update: {},
  })
  await appendBigBrotherAudit(leagueId, configId, 'jury_enrolled', { rosterId, evictedWeek })
}

/**
 * Get jury members for a league.
 */
export async function getJuryMembers(leagueId: string) {
  return prisma.bigBrotherJuryMember.findMany({
    where: { leagueId },
    orderBy: { joinedAt: 'asc' },
  })
}

/**
 * Submit finale vote (jury member votes for a finalist). One vote per jury member.
 */
export async function submitFinaleVote(
  leagueId: string,
  juryRosterId: string,
  targetRosterId: string
): Promise<{ ok: boolean; error?: string }> {
  const config = await getBigBrotherConfig(leagueId)
  const finalists = await getBigBrotherFinalists(leagueId)
  if (!config || !finalists) return { ok: false, error: 'Finale has not been reached' }
  if (!finalists.includes(targetRosterId)) return { ok: false, error: 'Target must be an active finalist' }
  return prisma.$transaction(async tx => {
    await tx.bigBrotherLeagueConfig.update({ where: { id: config.configId }, data: { updatedAt: new Date() } })
    const published = await tx.bigBrotherAuditLog.findFirst({ where: { leagueId, configId: config.configId, eventType: 'finale_vote' } })
    if (published) return { ok: false, error: 'Finale voting is closed' }
    const member = await tx.bigBrotherJuryMember.findUnique({ where: { leagueId_rosterId: { leagueId, rosterId: juryRosterId } } })
    if (!member || member.configId !== config.configId || finalists.includes(juryRosterId)) return { ok: false, error: 'Not an eligible jury member' }
    await tx.bigBrotherFinaleVote.upsert({ where: { leagueId_juryRosterId: { leagueId, juryRosterId } }, create: { leagueId, juryRosterId, targetRosterId }, update: { targetRosterId } })
    return { ok: true }
  })
}

/**
 * Publishable tally requires every eligible juror to vote and a unique winner.
 */
export async function tallyFinaleVotes(leagueId: string, db: Prisma.TransactionClient = prisma): Promise<{ targetRosterId: string; voteCount: number } | null> {
  const config = await getBigBrotherConfig(leagueId)
  const finalists = await getBigBrotherFinalists(leagueId)
  if (!config || !finalists) return null
  const [votes, jury] = await Promise.all([
    db.bigBrotherFinaleVote.findMany({ where: { leagueId }, select: { juryRosterId: true, targetRosterId: true } }),
    db.bigBrotherJuryMember.findMany({ where: { leagueId, configId: config.configId }, select: { rosterId: true } }),
  ])
  const eligible = new Set(jury.map(j => j.rosterId).filter(id => !finalists.includes(id)))
  const valid = new Map(votes.filter(v => eligible.has(v.juryRosterId) && finalists.includes(v.targetRosterId)).map(v => [v.juryRosterId, v.targetRosterId]))
  if (!eligible.size || valid.size !== eligible.size) return null
  const count = new Map<string, number>()
  for (const target of valid.values()) count.set(target, (count.get(target) ?? 0) + 1)
  const ranked = [...count].sort((a, b) => b[1] - a[1])
  if (!ranked.length || (ranked[1] && ranked[0][1] === ranked[1][1])) return null
  return { targetRosterId: ranked[0][0], voteCount: ranked[0][1] }
}
