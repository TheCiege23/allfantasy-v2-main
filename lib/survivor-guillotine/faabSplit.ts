/**
 * Survivor Guilly: the chopped teams' unspent FAAB, split among the survivors when the league chose
 * "Split it among the survivors" (`League.settings.guillotineFaabOnChop`, the same rule and AF
 * Commissioner gate as a Guilly league — lib/guillotine/faabOnChop.ts).
 *
 * ⚠ BOTH BALANCES MOVE. Survivor Guilly keeps `Roster.faabRemaining` (what bids are checked against)
 * and the linked `RedraftRoster.faabBalance` in step on every spend and credit (./operations.ts,
 * lib/waiver-wire/process-engine.ts). The split does the same, or the two would drift.
 *
 * ⚠ IT RUNS INSIDE THE CHOP'S SERIALIZABLE TRANSACTION (./live.ts executeSGLiveChop), so the split and
 * the chop commit together, and what moved is recorded in the chop snapshot: a chop reversed after a
 * stat correction gives the money back (reverseSGFaabSplit).
 */
import type { Prisma } from '@prisma/client'
import { splitChoppedFaab } from '@/lib/guillotine/faabOnChop'

export type SGFaabSplit = {
  pool: number
  /** rosterId → FAAB taken from each chopped team. */
  taken: Record<string, number>
  /** rosterId → FAAB credited to each survivor. */
  shares: Record<string, number>
}

type Tx = Prisma.TransactionClient

export async function splitSGChoppedFaab(tx: Tx, args: { choppedRosterIds: string[]; survivorRosterIds: string[] }): Promise<SGFaabSplit | null> {
  if (args.choppedRosterIds.length === 0 || args.survivorRosterIds.length === 0) return null
  const rows = await tx.roster.findMany({
    where: { id: { in: [...args.choppedRosterIds, ...args.survivorRosterIds] } },
    select: { id: true, faabRemaining: true, redraftRosterId: true },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const survivors = args.survivorRosterIds.flatMap((id) => {
    const faab = byId.get(id)?.faabRemaining
    return faab == null ? [] : [{ rosterId: id, faab }]
  })
  // Nobody to receive it (FAAB is off): leave the chopped balance alone rather than burn it.
  if (survivors.length === 0) return null

  const taken: Record<string, number> = {}
  for (const id of args.choppedRosterIds) {
    const row = byId.get(id)
    const balance = row?.faabRemaining ?? 0
    if (balance <= 0) continue
    const zeroed = await tx.roster.updateMany({ where: { id, faabRemaining: balance }, data: { faabRemaining: 0 } })
    if (zeroed.count !== 1) continue
    taken[id] = balance
    if (row?.redraftRosterId) await tx.redraftRoster.updateMany({ where: { id: row.redraftRosterId }, data: { faabBalance: 0 } })
  }
  const pool = Object.values(taken).reduce((a, b) => a + b, 0)
  const split = splitChoppedFaab(pool, survivors)
  if (split.pool === 0) return null
  const shares: Record<string, number> = {}
  for (const [rosterId, amount] of split.shares) {
    if (amount <= 0) continue
    shares[rosterId] = amount
    await tx.roster.update({ where: { id: rosterId }, data: { faabRemaining: { increment: amount } } })
    const link = byId.get(rosterId)?.redraftRosterId
    if (link) await tx.redraftRoster.updateMany({ where: { id: link }, data: { faabBalance: { increment: amount } } })
  }
  return { pool: split.pool, taken, shares }
}

/**
 * Undo a split when its chop is reversed. Each chopped team gets back what was taken. Each survivor
 * gives back its share, or as much of it as it still holds — it may have spent some on waivers since,
 * and a balance never goes below zero. Returns what could not be recovered, for the reversal notice.
 */
export async function reverseSGFaabSplit(tx: Tx, split: SGFaabSplit): Promise<{ unrecovered: number }> {
  const ids = [...Object.keys(split.taken), ...Object.keys(split.shares)]
  const rows = await tx.roster.findMany({ where: { id: { in: ids } }, select: { id: true, faabRemaining: true, redraftRosterId: true } })
  const byId = new Map(rows.map((r) => [r.id, r]))
  let unrecovered = 0
  for (const [rosterId, share] of Object.entries(split.shares)) {
    const row = byId.get(rosterId)
    const back = Math.min(share, Math.max(0, row?.faabRemaining ?? 0))
    unrecovered += share - back
    if (back <= 0) continue
    await tx.roster.update({ where: { id: rosterId }, data: { faabRemaining: { decrement: back } } })
    if (row?.redraftRosterId) {
      await tx.redraftRoster.updateMany({ where: { id: row.redraftRosterId, faabBalance: { gte: back } }, data: { faabBalance: { decrement: back } } })
    }
  }
  for (const [rosterId, amount] of Object.entries(split.taken)) {
    await tx.roster.update({ where: { id: rosterId }, data: { faabRemaining: { increment: amount } } })
    const link = byId.get(rosterId)?.redraftRosterId
    if (link) await tx.redraftRoster.updateMany({ where: { id: link }, data: { faabBalance: { increment: amount } } })
  }
  return { unrecovered }
}

export function readSGFaabSplit(value: unknown): SGFaabSplit | null {
  const v = value as Partial<SGFaabSplit> | null
  if (!v || typeof v !== 'object' || typeof v.pool !== 'number' || !v.taken || !v.shares) return null
  return v as SGFaabSplit
}
