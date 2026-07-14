/**
 * Native redraft trade settlement.
 *
 * The redraft accept path (`/api/redraft/trade-votes::finalizeAcceptedTrade`) historically only ran
 * the IDP salary-cap transfer (a no-op for non-IDP leagues). It never moved `RedraftRosterPlayer`
 * rows or transferred `RedraftRoster.faabBalance`, so accepted trades did not actually change rosters.
 *
 * This module settles a two-party redraft trade for real:
 *  - `player` assets: move the active `RedraftRosterPlayer` from the sending roster to the receiving
 *    roster (rosterId update; acquisitionType -> "trade"; slotType -> "BENCH").
 *  - `faab` assets: transfer the metadata amount between `RedraftRoster.faabBalance` with a
 *    sufficiency check.
 *  - `draft_pick` / `future_consideration`: reference-only. Redraft has no owned-pick inventory, so
 *    these are recorded on the proposal but not settled here (documented in
 *    docs/trade-center-rebuild-audit.md).
 *
 * Must be called inside a Prisma `$transaction` so player + FAAB movement is atomic.
 */

import type { Prisma } from '@prisma/client'

export type TradeSettlementTx = Prisma.TransactionClient

export type SettlementAssetRow = {
  fromRosterId: string
  toRosterId: string
  assetType: string
  playerId: string | null
  metadata?: unknown
}

export type TradeSettlementResult = {
  playersMoved: number
  faabTransferred: number
  picksRecorded: number
}

function readFaabAmount(metadata: unknown): number {
  if (!metadata || typeof metadata !== 'object') return 0
  const raw = (metadata as Record<string, unknown>)
  const amount = Number(raw.amount ?? raw.faab ?? raw.faabAmount ?? 0)
  return Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0
}

/**
 * Settle accepted trade assets onto the two rosters. Throws on invalid ownership / insufficient FAAB
 * so the surrounding transaction rolls back and the caller can surface a 409.
 */
export async function settleRedraftTradeAssets(
  tx: TradeSettlementTx,
  input: {
    proposerRosterId: string
    receiverRosterId: string
    assets: SettlementAssetRow[]
  },
): Promise<TradeSettlementResult> {
  const { proposerRosterId, receiverRosterId, assets } = input
  const validRosterIds = new Set([proposerRosterId, receiverRosterId])

  let playersMoved = 0
  let picksRecorded = 0

  // Net FAAB delta per roster (positive = gains FAAB).
  const faabDelta = new Map<string, number>([
    [proposerRosterId, 0],
    [receiverRosterId, 0],
  ])

  for (const asset of assets) {
    const fromRosterId = asset.fromRosterId
    const toRosterId = asset.toRosterId
    if (!validRosterIds.has(fromRosterId) || !validRosterIds.has(toRosterId) || fromRosterId === toRosterId) {
      throw new Error('Trade asset has invalid roster direction')
    }

    if (asset.assetType === 'player') {
      if (!asset.playerId) throw new Error('Player asset missing playerId')
      const moved = await tx.redraftRosterPlayer.updateMany({
        where: { rosterId: fromRosterId, playerId: asset.playerId, droppedAt: null },
        data: { rosterId: toRosterId, acquisitionType: 'trade', slotType: 'BENCH', isLocked: false },
      })
      if (moved.count === 0) {
        throw new Error(`Traded player ${asset.playerId} is no longer on the sending roster`)
      }
      playersMoved += moved.count
      continue
    }

    if (asset.assetType === 'faab') {
      const amount = readFaabAmount(asset.metadata)
      if (amount <= 0) throw new Error('FAAB asset missing a positive amount')
      faabDelta.set(fromRosterId, (faabDelta.get(fromRosterId) ?? 0) - amount)
      faabDelta.set(toRosterId, (faabDelta.get(toRosterId) ?? 0) + amount)
      continue
    }

    if (asset.assetType === 'draft_pick' || asset.assetType === 'future_consideration') {
      // Reference-only: no owned-pick inventory in redraft. Recorded on the proposal already.
      picksRecorded += 1
      continue
    }

    throw new Error(`Unsupported trade asset type: ${asset.assetType}`)
  }

  // Apply net FAAB transfers with sufficiency checks.
  //
  // This must be a single atomic guarded UPDATE, not a read-then-write (findUnique
  // then update): under Postgres's default READ COMMITTED isolation, two concurrent
  // settlements against the same roster can both read the same starting balance,
  // both compute a valid-looking result, and the second write silently overwrites
  // the first (a lost update) — physically reproduced during Gate C concurrency
  // validation: two real trades each "successfully" deducted 60 FAAB from a 100
  // balance, yet the final balance was 40, not -20 and not correctly rejected.
  // The WHERE clause's own arithmetic guard makes this atomic regardless of
  // isolation level — Postgres's row-level lock on the UPDATE itself prevents the
  // race, the same way the existing conditional-claim UPDATE on trade proposals does.
  let faabTransferred = 0
  for (const [rosterId, delta] of faabDelta) {
    if (delta === 0) continue
    const updated = await tx.$executeRaw`UPDATE "redraft_rosters" SET "faabBalance" = "faabBalance" + ${delta} WHERE id = ${rosterId} AND COALESCE("faabBalance", 0) + ${delta} >= 0`
    if (updated === 0) {
      throw new Error('Insufficient FAAB balance to complete trade')
    }
    if (delta > 0) faabTransferred += delta
  }

  return { playersMoved, faabTransferred, picksRecorded }
}
