/**
 * Keeps a native league's two FAAB stores equal.
 *
 * ⚠ A NATIVE LEAGUE CARRIES ITS FAAB TWICE AND EACH ENGINE WROTE ONLY ITS OWN.
 *   `Roster.faabRemaining`       native waivers (lib/waiver-wire/process-engine.ts), AF trades
 *                                (lib/league-trade-engine/tradeProcessor.ts), the Guilly chop split
 *                                (lib/guillotine/faabOnChopApply.ts), the chop preview
 *   `RedraftRoster.faabBalance`  redraft waivers (lib/redraft/waiverEngine.ts), redraft trades
 *                                (lib/redraft/tradeSettlement.ts), the Guilly standings and every
 *                                Chimmy grounding that quotes a team's FAAB
 * So a plain Guilly team that won a $30 claim kept showing its old budget on the standings and to
 * Chimmy, and a FAAB trade on one path left the other engine bidding with the old number. Survivor
 * Guilly already wrote both by hand.
 *
 * Each writer now copies the balance it just wrote onto the linked row. Copying the RESULT, not the
 * delta, is deliberate: the next FAAB change on a roster also repairs whatever drift it carried in.
 * A null is never copied — null means "FAAB off" on that side, and a roster created with no budget
 * must not wipe a real balance on the other one.
 */

type GenericRosterDb = {
  findMany(args: {
    where: { id: { in: string[] } } | { redraftRosterId: { in: string[] } }
    select: { id: true; faabRemaining: true; redraftRosterId: true }
  }): Promise<Array<{ id: string; faabRemaining: number | null; redraftRosterId: string | null }>>
  updateMany(args: { where: { redraftRosterId: string }; data: { faabRemaining: number } }): Promise<unknown>
}
type RedraftRosterDb = {
  findMany(args: { where: { id: { in: string[] } }; select: { id: true; faabBalance: true } }): Promise<Array<{ id: string; faabBalance: number | null }>>
  updateMany(args: { where: { id: string }; data: { faabBalance: number } }): Promise<unknown>
}
export type FaabMirrorDb = { roster: GenericRosterDb; redraftRoster: RedraftRosterDb }

/** After writing `Roster.faabRemaining`: copy it onto each linked `RedraftRoster.faabBalance`. */
export async function copyGenericFaabToRedraft(db: FaabMirrorDb, genericRosterIds: string[]): Promise<void> {
  const ids = [...new Set(genericRosterIds)]
  if (!ids.length) return
  const rows = await db.roster.findMany({ where: { id: { in: ids } }, select: { id: true, faabRemaining: true, redraftRosterId: true } })
  for (const row of rows) {
    if (!row.redraftRosterId || row.faabRemaining == null) continue
    await db.redraftRoster.updateMany({ where: { id: row.redraftRosterId }, data: { faabBalance: row.faabRemaining } })
  }
}

/** After writing `RedraftRoster.faabBalance`: copy it onto the generic roster linked to each. */
export async function copyRedraftFaabToGeneric(db: FaabMirrorDb, redraftRosterIds: string[]): Promise<void> {
  const ids = [...new Set(redraftRosterIds)]
  if (!ids.length) return
  const rows = await db.redraftRoster.findMany({ where: { id: { in: ids } }, select: { id: true, faabBalance: true } })
  for (const row of rows) {
    if (row.faabBalance == null) continue
    await db.roster.updateMany({ where: { redraftRosterId: row.id }, data: { faabRemaining: Math.round(row.faabBalance) } })
  }
}
