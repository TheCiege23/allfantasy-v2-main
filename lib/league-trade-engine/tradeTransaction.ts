/**
 * Sample pattern: run trade processing inside `prisma.$transaction` for atomicity.
 */

import { prisma } from '@/lib/prisma'
import { applyTradeAssetsInTransaction, type LeagueTradeTx } from '@/lib/league-trade-engine/tradeProcessor'

export async function runAfTradeProcessingTransaction<T>(
  fn: (tx: LeagueTradeTx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => fn(tx), { isolationLevel: 'Serializable' })
}

export async function sampleProcessAfTradeInTransaction(tradeId: string): Promise<void> {
  const trade = await prisma.afLeagueTrade.findUniqueOrThrow({
    where: { id: tradeId },
    include: { items: true },
  })
  const assets = trade.items.map((i) => ({
    itemType: i.itemType as import('@/lib/league-trade-engine/types').TradeItemType,
    itemReference: i.itemReference,
    fromRosterId: i.fromRosterId,
    toRosterId: i.toRosterId,
    faabAmount: i.faabAmount,
    metadata: (i.metadata as Record<string, unknown>) ?? {},
  }))
  await prisma.$transaction(async (tx) => {
    await applyTradeAssetsInTransaction(tx, {
      leagueId: trade.leagueId,
      proposerRosterId: trade.proposerRosterId,
      receiverRosterId: trade.receiverRosterId,
      assets,
    })
  }, { isolationLevel: 'Serializable' })
}
