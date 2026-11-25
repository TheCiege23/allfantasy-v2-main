/**
 * Server half of ./faabOnChop.ts: moves the chopped teams' FAAB to the survivors.
 */
import { prisma } from '@/lib/prisma'
import { DEFAULT_FAAB_ON_CHOP_PERCENT, distributeChoppedFaab, faabTakenFromChopped, type FaabOnChop, type FaabSurvivor } from './faabOnChop'
import { copyGenericFaabToRedraft } from '@/lib/league/faabMirror'

/**
 * `taken` is what each chopped team gave up — recorded in the `faab_split` event so an undone chop can give
 * each team back exactly its own balance (./chopUndo.ts), not a guessed share of the pool.
 *
 * `applied` is the rule that placed the money (`split` when a scorer rule had no scores to read), and `recorded`
 * says the `faab_split` event was written here, inside the transaction, so the caller must not write it again.
 */
export type FaabRedistribution = {
  pool: number
  perTeam: number
  survivors: number
  shares: Map<string, number>
  taken: Map<string, number>
  applied: FaabOnChop
  recorded: boolean
}

type RedistributeInput = {
  choppedRosterIds: string[]
  survivorRosterIds: string[]
  /** Who gets it (./faabOnChop.ts). Absent = an even split, the only rule there was before 2026-11-25. */
  policy?: FaabOnChop
  /** The share of each chopped team's balance that is passed on. Absent = all of it. */
  percent?: number
  /** rosterId → the score the chop ranked the team on this week: read by the scorer rules. */
  weekPoints?: ReadonlyMap<string, number> | Readonly<Record<string, number>>
  /**
   * The chop this payout belongs to. With it, the payout is made ONCE per `key` whatever is retried (see below),
   * the `faab_split` event is written in the same transaction, and `waiver_order` can read who was paid before.
   */
  record?: { leagueId: string; key: string; weekOrPeriod: number }
}

/**
 * Move the chopped teams' FAAB to the survivors, in one transaction.
 *
 * 🛑 ONCE PER CHOP, AND THE BALANCE ALONE NO LONGER PROVES IT. With everything passed on (`percent` 100) the
 * chopped balance is zeroed in the same transaction that hands it out, and only if it still holds the amount
 * that was read (compare-and-set), so a retried chop finds nothing left to move. That is how the even split was
 * idempotent, and it still is. But a share (`percent` below 100) leaves money on the chopped team, and a retried
 * chop would take the same share of what is left, again and again. So when `record` is given the payout takes the
 * league row lock, looks for this chop's own `faab_split` event, does nothing if it is there, and writes it in the
 * same transaction as the balances — the marker `applyFaabAfterChop` uses for the same reason. Undo deletes the
 * marker when it gives the money back (./chopUndoService.ts), so chopping the week again pays again.
 *
 * A share is refused without `record`: there would be nothing to stop the second take.
 *
 * Survivors are credited with an atomic increment, so a waiver run that spends at the same moment never loses
 * either change.
 */
export async function redistributeChoppedFaab(input: RedistributeInput): Promise<FaabRedistribution | null> {
  if (input.choppedRosterIds.length === 0 || input.survivorRosterIds.length === 0) return null
  const policy: FaabOnChop = input.policy ?? 'split'
  if (policy === 'keep') return null
  const percent = input.percent ?? DEFAULT_FAAB_ON_CHOP_PERCENT
  const record = input.record ?? null
  if (percent < DEFAULT_FAAB_ON_CHOP_PERCENT && !record) {
    throw new Error('A share of a chopped team’s FAAB can only be paid with a record of the chop it belongs to')
  }
  const pointsOf = (id: string): number | null => {
    const v = input.weekPoints instanceof Map ? input.weekPoints.get(id) : (input.weekPoints as Record<string, number> | undefined)?.[id]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }

  return prisma.$transaction(async (tx) => {
    let received = new Map<string, number>()
    if (record) {
      await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${record.leagueId} FOR UPDATE`
      const done = await tx.guillotineEventLog.findFirst({
        where: { leagueId: record.leagueId, eventType: 'faab_split', metadata: { path: ['key'], equals: record.key } },
        select: { id: true },
      })
      if (done) return null
      if (policy === 'waiver_order') received = await paidInTurnSoFar(tx, record.leagueId)
    }

    const rows = await tx.roster.findMany({
      where: { id: { in: [...input.choppedRosterIds, ...input.survivorRosterIds] } },
      select: { id: true, faabRemaining: true, waiverPriority: true },
    })
    const byId = new Map(rows.map((r) => [r.id, r]))
    const survivors: FaabSurvivor[] = input.survivorRosterIds.flatMap((id) => {
      const row = byId.get(id)
      return row?.faabRemaining == null
        ? []
        : [{ rosterId: id, faab: row.faabRemaining, weekPoints: pointsOf(id), waiverPriority: row.waiverPriority ?? null, received: received.get(id) ?? 0 }]
    })
    // Nobody to receive it (FAAB is off): leave the chopped balance alone rather than burn it.
    if (survivors.length === 0) return null

    let pool = 0
    const taken = new Map<string, number>()
    for (const id of input.choppedRosterIds) {
      const balance = byId.get(id)?.faabRemaining
      if (balance == null || balance <= 0) continue
      const take = faabTakenFromChopped(balance, percent)
      if (take <= 0) continue
      // Only if the balance is still the one that was read: a spend in between is never paid out twice.
      const moved = await tx.roster.updateMany({ where: { id, faabRemaining: balance }, data: { faabRemaining: balance - take } })
      if (moved.count === 1) {
        pool += take
        taken.set(id, take)
      }
    }

    const split = distributeChoppedFaab(policy, pool, survivors)
    if (split.pool === 0) return null
    for (const [rosterId, amount] of split.shares) {
      if (amount > 0) await tx.roster.update({ where: { id: rosterId }, data: { faabRemaining: { increment: amount } } })
    }
    await copyGenericFaabToRedraft(tx, [...input.choppedRosterIds, ...split.shares.keys()])
    if (record) {
      await tx.guillotineEventLog.create({
        data: {
          leagueId: record.leagueId,
          eventType: 'faab_split',
          metadata: {
            key: record.key,
            weekOrPeriod: record.weekOrPeriod,
            choppedRosterIds: input.choppedRosterIds,
            pool: split.pool,
            shares: Object.fromEntries(split.shares),
            taken: Object.fromEntries(taken),
            policy,
            applied: split.applied,
            percent,
          },
        },
      })
    }
    return {
      pool: split.pool,
      perTeam: Math.floor(split.pool / survivors.length),
      survivors: survivors.length,
      shares: split.shares,
      taken,
      applied: split.applied,
      recorded: record != null,
    }
  })
}

type EventReader = { guillotineEventLog: { findMany: (args: { where: { leagueId: string; eventType: string }; select: { metadata: true } }) => Promise<Array<{ metadata: unknown }>> } }

/**
 * rosterId → how many `waiver_order` payouts it has already had in this league: the line the next payout joins
 * the back of. Read from the payouts' own `faab_split` events; an undone chop's event is gone (see above), so it
 * does not count. Shared with the commissioner's chop preview (./chopPreviewLoad.ts), which must name the same team.
 */
export async function paidInTurnSoFar(db: EventReader, leagueId: string): Promise<Map<string, number>> {
  const events = await db.guillotineEventLog.findMany({ where: { leagueId, eventType: 'faab_split' }, select: { metadata: true } })
  const counts = new Map<string, number>()
  for (const e of events) {
    const m = e.metadata && typeof e.metadata === 'object' && !Array.isArray(e.metadata) ? (e.metadata as Record<string, unknown>) : null
    if (!m || m.applied !== 'waiver_order') continue
    const shares = m.shares && typeof m.shares === 'object' && !Array.isArray(m.shares) ? (m.shares as Record<string, unknown>) : {}
    for (const [rosterId, amount] of Object.entries(shares)) {
      if (typeof amount === 'number' && amount > 0) counts.set(rosterId, (counts.get(rosterId) ?? 0) + 1)
    }
  }
  return counts
}
