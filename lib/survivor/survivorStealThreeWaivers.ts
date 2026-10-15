import type { Prisma, PrismaClient } from '@prisma/client'

/** Raid drops must pass through the next waiver window, even in an instant-FA league.
 * The hold lives in the existing atomic raid audit; claims may still acquire these players.
 */
export async function assertStealThreeWaiverHoldCleared(
  db: Prisma.TransactionClient | PrismaClient, leagueId: string, playerId: string, now = new Date(),
): Promise<void> {
  const raids = await db.survivorAuditEntry.findMany({
    where: { leagueId, action: 'steal_three_played', createdAt: { gte: new Date(now.getTime() - 14 * 86400000) } },
    select: { data: true },
  })
  for (const raid of raids) {
    const data = raid.data && typeof raid.data === 'object' && !Array.isArray(raid.data) ? raid.data : {}
    if (Array.isArray(data.dropPlayerIds) && data.dropPlayerIds.includes(playerId) && typeof data.waiversClearAt === 'string' && new Date(data.waiversClearAt).getTime() > now.getTime()) {
      throw new Error('This player was dropped by Steal 3 and must go through waivers until the next processing window.')
    }
  }
}
