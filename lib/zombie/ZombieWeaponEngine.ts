/**
 * Zombie weapon engine: score-threshold awards, top-two active, bomb override (PROMPT 353). Deterministic.
 */

import { prisma } from '@/lib/prisma'
import { getZombieLeagueConfig } from './ZombieLeagueConfig'
import { getStatus } from './ZombieOwnerStatusService'
import { appendZombieAudit } from './ZombieAuditLog'

/** Award weapon by score threshold (config.weaponScoreThresholds). */
export async function awardWeaponByScore(
  leagueId: string,
  rosterId: string,
  weeklyPoints: number,
  week?: number,
  zombieLeagueId?: string | null
): Promise<string | null> {
  const config = await getZombieLeagueConfig(leagueId)
  if (!config?.weaponScoreThresholds?.length) return null
  const status = await getStatus(leagueId, rosterId)
  if (status === 'Zombie') return null // zombie cannot wield unless revived

  let awarded: string | null = null
  for (const thresh of config.weaponScoreThresholds) {
    if (weeklyPoints >= thresh.minPoints) {
      const existing = await prisma.zombieResourceLedger.findFirst({
        where: { leagueId, rosterId, resourceType: 'weapon', resourceKey: thresh.weaponType },
      })
      if (existing) {
        await prisma.zombieResourceLedger.update({
          where: { id: existing.id },
          data: { balance: existing.balance + 1, awardedInWeek: week ?? undefined, updatedAt: new Date() },
        })
      } else {
        await prisma.zombieResourceLedger.create({
          data: {
            leagueId,
            zombieLeagueId: zombieLeagueId ?? null,
            rosterId,
            resourceType: 'weapon',
            resourceKey: thresh.weaponType,
            balance: 1,
            awardedInWeek: week ?? null,
          },
        })
      }
      await prisma.zombieResourceLedgerEntry.create({
        data: {
          leagueId,
          rosterId,
          resourceType: 'weapon',
          resourceKey: thresh.weaponType,
          delta: 1,
          reason: 'score_threshold',
          week: week ?? null,
        },
      })
      awarded = thresh.weaponType
      break
    }
  }
  if (awarded) {
    await appendZombieAudit({
      leagueId,
      zombieLeagueId: zombieLeagueId ?? null,
      eventType: 'weapon_award',
      metadata: { rosterId, weaponType: awarded, week, weeklyPoints },
    })
  }
  return awarded
}
