/**
 * Survivor tribe shuffle: rebalance tribes by consecutive losses or imbalance (PROMPT 346). Deterministic.
 */

import { prisma } from '@/lib/prisma'
import { randomInt } from 'node:crypto'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { getTribesWithMembers } from './SurvivorTribeService'
import { appendSurvivorAudit } from './SurvivorAuditLog'
import type { SurvivorTribeWithMembers } from './types'

/**
 * Check if shuffle should run: consecutive council losses or size imbalance.
 * Returns { shouldShuffle, reason }.
 */
export async function checkShuffleTrigger(
  leagueId: string,
  options?: { currentWeek?: number }
): Promise<{ shouldShuffle: boolean; reason?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config || !config.tribeShuffleEnabled) return { shouldShuffle: false }

  const tribes = await getTribesWithMembers(leagueId)
  if (tribes.length === 0) return { shouldShuffle: false }

  const councils = await prisma.survivorTribalCouncil.findMany({
    where: { leagueId, phase: 'pre_merge' },
    orderBy: { week: 'asc' },
    select: { week: true, attendingTribeId: true, eliminatedRosterId: true },
  })

  if (config.tribeShuffleConsecutiveLosses != null && config.tribeShuffleConsecutiveLosses > 0) {
    for (const tribe of tribes) {
      let consecutive = 0
      for (let i = councils.length - 1; i >= 0; i--) {
        const c = councils[i]
        if (c.attendingTribeId !== tribe.id) break
        if (c.eliminatedRosterId) consecutive++
        else break
      }
      if (consecutive >= config.tribeShuffleConsecutiveLosses) {
        return { shouldShuffle: true, reason: `Tribe ${tribe.name} has ${consecutive} consecutive council losses` }
      }
    }
  }

  if (config.tribeShuffleImbalanceThreshold != null && config.tribeShuffleImbalanceThreshold > 0) {
    const sizes = tribes.map((t) => t.members.length)
    const min = Math.min(...sizes)
    const max = Math.max(...sizes)
    if (max - min >= config.tribeShuffleImbalanceThreshold) {
      return { shouldShuffle: true, reason: `Tribe size imbalance: ${min} vs ${max}` }
    }
  }

  return { shouldShuffle: false }
}

/**
 * Run shuffle: reassign all active rosters to tribes (round-robin to rebalance). Preserves league state.
 * Chat membership must be updated by SurvivorChatMembershipService after this.
 */
export async function runShuffle(
  leagueId: string,
  options?: { seed?: number }
): Promise<{ ok: boolean; tribes?: SurvivorTribeWithMembers[]; error?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }

  const tribes = await prisma.survivorTribe.findMany({
    where: { configId: config.configId },
    orderBy: { slotIndex: 'asc' },
    include: { members: true },
  })
  if (tribes.length === 0) return { ok: false, error: 'No tribes' }

  const allRosterIds = tribes.flatMap((t) => t.members.map((m) => m.rosterId))
  if (allRosterIds.length === 0) return { ok: false, error: 'No members' }

  const seed = options?.seed ?? randomInt(0, 2 ** 32)
  let s = seed
  const shuffle = <T>(arr: T[]): T[] => {
    const out = [...arr]
    for (let i = out.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) >>> 0
      const j = (s % (i + 1)) >>> 0
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  const shuffled = shuffle(allRosterIds)
  const tribeCount = tribes.length

  await prisma.$transaction(async (tx) => {
    for (const m of tribes.flatMap((t) => t.members)) {
      await (tx as any).survivorTribeMember.delete({ where: { id: m.id } })
    }
    for (let slot = 0; slot < tribeCount; slot++) {
      const rosterIds = shuffled.filter((_, index) => index % tribeCount === slot)
      const tribe = tribes[slot]
      for (let i = 0; i < rosterIds.length; i++) {
        await (tx as any).survivorTribeMember.create({
          data: {
            tribeId: tribe.id,
            rosterId: rosterIds[i],
            isLeader: i === 0,
          },
        })
      }
    }
  })

  await appendSurvivorAudit(leagueId, config.configId, 'tribe_shuffle', {
    rosterCount: shuffled.length,
    tribeCount,
    seed,
  })

  return getTribesWithMembers(leagueId).then((t) => ({ ok: true, tribes: t }))
}
