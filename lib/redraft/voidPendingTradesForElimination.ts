import { prisma } from '@/lib/prisma'

/**
 * Cancels all pending redraft trades touching an eliminated roster.
 * Covers both the canonical RedraftTradeProposal system and legacy RedraftLeagueTrade
 * records (which may exist as audit mirrors from earlier in the season).
 */
export async function voidPendingRedraftTradesForRoster(leagueId: string, rosterId: string): Promise<number> {
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (!season) return 0

  const now = new Date()

  // Cancel canonical proposals (the active system)
  const proposalRes = await prisma.redraftTradeProposal.updateMany({
    where: {
      seasonId: season.id,
      status: 'pending',
      // A multi-team trade the roster is a third or fourth team in is voided too.
      OR: [{ proposerRosterId: rosterId }, { receiverRosterId: rosterId }, { additionalRosterIds: { has: rosterId } }],
    },
    data: {
      status: 'cancelled',
      cancelledAt: now,
    },
  })

  // Cancel legacy records (audit mirrors created on acceptance; also any pre-migration records)
  const legacyRes = await prisma.redraftLeagueTrade.updateMany({
    where: {
      seasonId: season.id,
      status: 'pending',
      OR: [{ proposerRosterId: rosterId }, { receiverRosterId: rosterId }],
    },
    data: {
      status: 'void_elimination',
      notes: 'Voided automatically: roster eliminated from league.',
      processedAt: now,
    },
  })

  return proposalRes.count + legacyRes.count
}
