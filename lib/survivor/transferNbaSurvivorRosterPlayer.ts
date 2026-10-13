import type { Prisma } from '@prisma/client'

/** Preserve the outgoing ownership interval when a native NBA Survivor player changes rosters. */
export async function transferNbaSurvivorRosterPlayer(
  tx: Prisma.TransactionClient,
  input: { playerId: string; fromRosterId: string; toRosterId: string; slotType: string; acquisitionType: string; rowId?: string },
): Promise<number> {
  const row = await tx.redraftRosterPlayer.findFirst({
    where: { id: input.rowId, rosterId: input.fromRosterId, playerId: input.playerId, droppedAt: null },
  })
  if (!row) return 0
  const transferredAt = new Date()
  const closed = await tx.redraftRosterPlayer.updateMany({
    where: { id: row.id, rosterId: input.fromRosterId, droppedAt: null },
    data: { droppedAt: transferredAt },
  })
  if (closed.count !== 1) return 0
  await tx.redraftRosterPlayer.create({
    data: {
      rosterId: input.toRosterId,
      playerId: row.playerId,
      playerName: row.playerName,
      position: row.position,
      team: row.team,
      sport: row.sport,
      slotType: input.slotType,
      isLocked: false,
      injuryStatus: row.injuryStatus,
      byeWeek: row.byeWeek,
      addedAt: transferredAt,
      acquisitionType: input.acquisitionType,
      isKept: row.isKept,
    },
  })
  return 1
}
