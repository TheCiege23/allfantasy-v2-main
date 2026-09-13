/**
 * Apply a redraft trade's net FAAB changes as conditional, in-database arithmetic.
 *
 * 🛑 WHY THIS EXISTS (audit #23). Both redraft trade settlement writers read a roster's balance, computed the
 * new value in JavaScript, and wrote that absolute number back:
 *
 *   read 100  ->  100 - 60 = 40  ->  write 40
 *
 * Postgres runs these transactions at READ COMMITTED, so two trades settling at once from the same roster
 * could both read 100, both pass the sufficiency check, and both write 40. One debit vanished: the roster
 * spent 120 of a 100 budget and kept 40, and both receivers were credited. Nothing threw.
 *
 * ⚠ AND THE RUNTIME WRITER WAS WORSE. `applyExecutedTrade` wrote `Math.max(0, balance + delta)`. The runtime
 * validator lets a commissioner override skip the FAAB check, so an override trade larger than the sender's
 * balance floored the sender at 0 while the receiver was credited the full amount — FAAB that existed
 * nowhere, minted silently. Through this helper that trade is refused instead.
 *
 * The fix is to let the database do the arithmetic and the check in one statement:
 *
 *   UPDATE ... SET faabBalance = faabBalance - 60 WHERE id = ? AND faabBalance >= 60
 *
 * The second of two racing debits re-reads the committed row, finds 40 < 60, matches nothing, and the trade
 * throws and rolls back. Debits run before credits, so a refused debit never leaves a credit behind.
 *
 * `faabBalance` is `Float?`. In SQL `NULL + x` is `NULL`, so a credit to a roster with no balance yet sets it
 * to the credit, which is what settlement always did (it read `null` as 0). A debit from a null balance is
 * refused, also as before.
 */
import type { Prisma } from '@prisma/client'

type FaabDb = Pick<Prisma.TransactionClient, 'redraftRoster'>

export const INSUFFICIENT_FAAB_MESSAGE = 'Insufficient FAAB balance to complete trade'

/**
 * @param deltas net FAAB change per roster id: negative = pays, positive = receives.
 * @returns total FAAB credited (the amount that actually moved).
 */
export async function applyRedraftFaabDeltasInTransaction(db: FaabDb, deltas: Map<string, number>): Promise<number> {
  for (const [rosterId, delta] of deltas) {
    if (!(delta < 0)) continue
    const amount = -delta
    const debited = await db.redraftRoster.updateMany({
      where: { id: rosterId, faabBalance: { gte: amount } },
      data: { faabBalance: { decrement: amount } },
    })
    if (debited.count === 0) throw new Error(INSUFFICIENT_FAAB_MESSAGE)
  }

  let transferred = 0
  for (const [rosterId, delta] of deltas) {
    if (!(delta > 0)) continue
    const credited = await db.redraftRoster.updateMany({
      where: { id: rosterId, faabBalance: { not: null } },
      data: { faabBalance: { increment: delta } },
    })
    if (credited.count === 0) {
      const seeded = await db.redraftRoster.updateMany({
        where: { id: rosterId, faabBalance: null },
        data: { faabBalance: delta },
      })
      if (seeded.count === 0) {
        // Another writer gave it a balance between our two statements — add to that instead.
        const retried = await db.redraftRoster.updateMany({
          where: { id: rosterId, faabBalance: { not: null } },
          data: { faabBalance: { increment: delta } },
        })
        if (retried.count === 0) throw new Error(`FAAB credit could not find roster ${rosterId}`)
      }
    }
    transferred += delta
  }
  return transferred
}
