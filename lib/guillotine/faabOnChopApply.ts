/**
 * Server half of ./faabOnChop.ts: moves the chopped teams' FAAB to the survivors.
 */
import { prisma } from '@/lib/prisma'
import { splitChoppedFaab } from './faabOnChop'
import { copyGenericFaabToRedraft } from '@/lib/league/faabMirror'

export type FaabRedistribution = { pool: number; perTeam: number; survivors: number; shares: Map<string, number> }

/**
 * Move the chopped teams' FAAB to the survivors, in one transaction.
 *
 * IDEMPOTENT BY CONSTRUCTION: the chopped balance is zeroed in the same transaction that hands it
 * out, and only if it still holds the amount that was read (compare-and-set), so a retried chop or a
 * concurrent waiver run finds nothing left to move. Survivors are credited with an atomic increment,
 * so a waiver run that spends at the same moment never loses either change.
 */
export async function redistributeChoppedFaab(input: {
  choppedRosterIds: string[]
  survivorRosterIds: string[]
}): Promise<FaabRedistribution | null> {
  if (input.choppedRosterIds.length === 0 || input.survivorRosterIds.length === 0) return null
  return prisma.$transaction(async (tx) => {
    const rows = await tx.roster.findMany({
      where: { id: { in: [...input.choppedRosterIds, ...input.survivorRosterIds] } },
      select: { id: true, faabRemaining: true },
    })
    const byId = new Map(rows.map((r) => [r.id, r.faabRemaining]))
    const survivors = input.survivorRosterIds.flatMap((id) => {
      const faab = byId.get(id)
      return faab == null ? [] : [{ rosterId: id, faab }]
    })
    // Nobody to receive it (FAAB is off): leave the chopped balance alone rather than burn it.
    if (survivors.length === 0) return null

    let pool = 0
    for (const id of input.choppedRosterIds) {
      const balance = byId.get(id)
      if (balance == null || balance <= 0) continue
      const taken = await tx.roster.updateMany({ where: { id, faabRemaining: balance }, data: { faabRemaining: 0 } })
      if (taken.count === 1) pool += balance
    }

    const split = splitChoppedFaab(pool, survivors)
    if (split.pool === 0) return null
    for (const [rosterId, amount] of split.shares) {
      if (amount > 0) await tx.roster.update({ where: { id: rosterId }, data: { faabRemaining: { increment: amount } } })
    }
    await copyGenericFaabToRedraft(tx, [...input.choppedRosterIds, ...split.shares.keys()])
    return { pool: split.pool, perTeam: Math.floor(split.pool / survivors.length), survivors: survivors.length, shares: split.shares }
  })
}
