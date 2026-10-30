import type { Prisma } from '@prisma/client'

/** A selected claim reserves its player until settlement or commissioner resolution. */
export async function assertNotReservedByPirateClaim(
  db: Prisma.TransactionClient,
  rosterId: string,
  playerId: string,
): Promise<void> {
  const claim = await db.pirateClaim.findFirst({
    where: { loserRosterId: rosterId, playerId, status: { in: ['pending', 'countered', 'processing'] } },
    select: { id: true },
  })
  if (claim) throw new Error('This player is reserved by a Pirate claim until it settles.')
}
