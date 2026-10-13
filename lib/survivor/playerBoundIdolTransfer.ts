import type { Prisma } from '@prisma/client'

type MoveReason = 'trade' | 'trade_reversal' | 'waiver_drop' | 'waiver_claim'
const WAIVER_IDOL_ROSTER_ID = '__survivor_waivers__'

/** Move a hidden idol with its NBA player inside the same transaction as the roster move. */
export async function movePlayerBoundIdolsInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    leagueId: string
    playerId: string
    fromRedraftRosterId?: string | null
    toRedraftRosterId?: string | null
    reason: MoveReason
  },
): Promise<number> {
  const idols = await tx.survivorIdol.findMany({
    where: { leagueId: input.leagueId, playerId: input.playerId, status: { in: ['hidden', 'revealed'] }, isUsed: false },
    select: { id: true, rosterId: true, currentOwnerUserId: true, status: true },
  })
  if (!idols.length) return 0

  const rosterIds = [input.fromRedraftRosterId, input.toRedraftRosterId].filter((id): id is string => Boolean(id))
  const links = await tx.roster.findMany({
    where: { leagueId: input.leagueId, redraftRosterId: { in: rosterIds } },
    select: { id: true, redraftRosterId: true },
  })
  const bySeasonRoster = new Map(links.map(link => [link.redraftRosterId, link.id]))
  const fromRosterId = input.fromRedraftRosterId ? bySeasonRoster.get(input.fromRedraftRosterId) : null
  const toRosterId = input.toRedraftRosterId ? bySeasonRoster.get(input.toRedraftRosterId) : null
  if (input.fromRedraftRosterId && !fromRosterId) throw new Error('Survivor idol source roster link is missing')
  if (input.toRedraftRosterId && !toRosterId) throw new Error('Survivor idol destination roster link is missing')

  const newOwner = toRosterId
    ? await tx.survivorPlayer.findFirst({ where: { leagueId: input.leagueId, redraftRosterId: toRosterId }, select: { userId: true } })
    : null
  if (toRosterId && !newOwner) throw new Error('Survivor idol destination manager is missing')

  for (const idol of idols) {
    if (fromRosterId && idol.rosterId !== fromRosterId) {
      throw new Error(`Survivor idol ${idol.id} no longer belongs to the source roster`)
    }
    if (input.reason === 'waiver_claim' && idol.currentOwnerUserId) {
      throw new Error(`Survivor idol ${idol.id} has not been released to waivers`)
    }
    const nextOwnerId = newOwner?.userId ?? null
    const changed = await tx.survivorIdol.updateMany({
      where: { id: idol.id, status: idol.status, currentOwnerUserId: idol.currentOwnerUserId },
      data: { rosterId: toRosterId ?? WAIVER_IDOL_ROSTER_ID, currentOwnerUserId: nextOwnerId },
    })
    if (changed.count !== 1) throw new Error(`Survivor idol ${idol.id} changed during roster settlement`)
    if (idol.currentOwnerUserId && idol.currentOwnerUserId !== nextOwnerId) {
      const previous = await tx.survivorPlayer.findUnique({
        where: { leagueId_userId: { leagueId: input.leagueId, userId: idol.currentOwnerUserId } },
        select: { idolIds: true },
      })
      if (previous) await tx.survivorPlayer.update({
        where: { leagueId_userId: { leagueId: input.leagueId, userId: idol.currentOwnerUserId } },
        data: { idolIds: previous.idolIds.filter(id => id !== idol.id) },
      })
    }
    if (nextOwnerId && nextOwnerId !== idol.currentOwnerUserId) {
      const next = await tx.survivorPlayer.findUnique({
        where: { leagueId_userId: { leagueId: input.leagueId, userId: nextOwnerId } },
        select: { idolIds: true },
      })
      if (!next) throw new Error('Survivor idol destination inventory is missing')
      await tx.survivorPlayer.update({
        where: { leagueId_userId: { leagueId: input.leagueId, userId: nextOwnerId } },
        data: { idolIds: Array.from(new Set([...next.idolIds, idol.id])) },
      })
    }
    await tx.survivorIdolLedgerEntry.create({
      data: {
        leagueId: input.leagueId,
        idolId: idol.id,
        eventType: input.reason === 'waiver_drop' ? 'waived' : 'transferred',
        fromRosterId: idol.rosterId,
        toRosterId: toRosterId ?? null,
        metadata: { reason: input.reason, playerId: input.playerId },
      },
    })
  }
  return idols.length
}
