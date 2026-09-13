/**
 * Unit tests for native redraft trade settlement (lib/redraft/tradeSettlement.ts).
 *
 * Verifies the keystone fix: accepting a trade actually moves RedraftRosterPlayer rows and transfers
 * faabBalance, with ownership / sufficiency validation, and treats picks as reference-only.
 *
 * ⚠ THE ROSTER DOUBLE IS A SMALL IN-MEMORY TABLE, NOT A CALL RECORDER. FAAB moved from
 * read-compute-write to conditional in-database arithmetic (audit #23), so asserting "update was called with
 * 70" would pin the old implementation rather than the outcome. The store honours `updateMany`'s
 * `gte` / `not: null` / `null` conditions and `increment` / `decrement`, and each transaction's `findUnique`
 * can read a snapshot taken when that transaction began — which is how READ COMMITTED interleaves two trades.
 */
import { describe, it, expect, vi } from 'vitest'
import { settleRedraftTradeAssets, type SettlementAssetRow } from '@/lib/redraft/tradeSettlement'

const PROPOSER = 'roster-A'
const RECEIVER = 'roster-B'

type Store = Record<string, number | null>
type FaabWhere = { id: string; faabBalance?: null | { gte?: number; not?: null } }
type FaabData = { faabBalance: number | { increment?: number; decrement?: number } }

function matches(store: Store, where: FaabWhere): boolean {
  if (!(where.id in store)) return false
  const balance = store[where.id]
  const cond = where.faabBalance
  if (cond === undefined) return true
  if (cond === null) return balance === null
  if (cond.not === null && balance === null) return false
  if (cond.gte !== undefined && (balance === null || balance < cond.gte)) return false
  return true
}

function apply(store: Store, id: string, data: FaabData) {
  const value = data.faabBalance
  if (typeof value === 'number') store[id] = value
  else if (value.increment !== undefined) store[id] = (store[id] as number) + value.increment
  else if (value.decrement !== undefined) store[id] = (store[id] as number) - value.decrement
}

/**
 * @param store shared live table
 * @param readSnapshot what this transaction's reads see; defaults to live. A copy taken at "begin" models a
 *   concurrent transaction that read before another committed.
 */
function makeTx(store: Store, opts: { movedCount?: number; readSnapshot?: Store } = {}) {
  const calls = { playerUpdates: [] as Array<{ where: unknown; data: unknown }> }
  const reads = () => opts.readSnapshot ?? store
  const tx = {
    redraftRosterPlayer: {
      updateMany: vi.fn(async ({ where, data }: { where: unknown; data: unknown }) => {
        calls.playerUpdates.push({ where, data })
        return { count: opts.movedCount ?? 1 }
      }),
    },
    redraftRoster: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ faabBalance: reads()[where.id] ?? null })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: FaabData }) => {
        apply(store, where.id, data)
        return {}
      }),
      updateMany: vi.fn(async ({ where, data }: { where: FaabWhere; data: FaabData }) => {
        if (!matches(store, where)) return { count: 0 }
        apply(store, where.id, data)
        return { count: 1 }
      }),
    },
  }
  return { tx: tx as never, calls }
}

const faab = (from: string, to: string, amount: number): SettlementAssetRow => ({
  fromRosterId: from,
  toRosterId: to,
  assetType: 'faab',
  playerId: null,
  metadata: { amount },
})

describe('settleRedraftTradeAssets', () => {
  it('moves player rows between rosters with acquisitionType=trade', async () => {
    const { tx, calls } = makeTx({})
    const assets: SettlementAssetRow[] = [
      { fromRosterId: PROPOSER, toRosterId: RECEIVER, assetType: 'player', playerId: 'p1' },
      { fromRosterId: RECEIVER, toRosterId: PROPOSER, assetType: 'player', playerId: 'p2' },
    ]
    const res = await settleRedraftTradeAssets(tx, { proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, assets })
    expect(res.playersMoved).toBe(2)
    expect(calls.playerUpdates).toHaveLength(2)
    expect(calls.playerUpdates[0]!.data).toMatchObject({ rosterId: RECEIVER, acquisitionType: 'trade', slotType: 'BENCH' })
  })

  it('throws (rolls back) when a traded player is no longer on the sending roster', async () => {
    const { tx } = makeTx({}, { movedCount: 0 })
    const assets: SettlementAssetRow[] = [
      { fromRosterId: PROPOSER, toRosterId: RECEIVER, assetType: 'player', playerId: 'gone' },
    ]
    await expect(
      settleRedraftTradeAssets(tx, { proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, assets }),
    ).rejects.toThrow(/no longer on the sending roster/)
  })

  it('transfers FAAB from sender to receiver using metadata.amount', async () => {
    const store: Store = { [PROPOSER]: 100, [RECEIVER]: 50 }
    const { tx } = makeTx(store)
    const res = await settleRedraftTradeAssets(tx, {
      proposerRosterId: PROPOSER,
      receiverRosterId: RECEIVER,
      assets: [faab(PROPOSER, RECEIVER, 30)],
    })
    expect(res.faabTransferred).toBe(30)
    expect(store).toEqual({ [PROPOSER]: 70, [RECEIVER]: 80 })
  })

  it('throws on insufficient FAAB, and moves nothing', async () => {
    const store: Store = { [PROPOSER]: 10, [RECEIVER]: 50 }
    const { tx } = makeTx(store)
    await expect(
      settleRedraftTradeAssets(tx, { proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, assets: [faab(PROPOSER, RECEIVER, 30)] }),
    ).rejects.toThrow(/Insufficient FAAB/)
    expect(store).toEqual({ [PROPOSER]: 10, [RECEIVER]: 50 })
  })

  it('credits a roster that has no balance yet from the credit, as settlement always did', async () => {
    const store: Store = { [PROPOSER]: 100, [RECEIVER]: null }
    const { tx } = makeTx(store)
    await settleRedraftTradeAssets(tx, { proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, assets: [faab(PROPOSER, RECEIVER, 30)] })
    expect(store).toEqual({ [PROPOSER]: 70, [RECEIVER]: 30 })
  })

  it('🛑 two trades racing on one roster cannot both spend the same FAAB', async () => {
    /*
     * Both transactions begin while the proposer has 100, and each pays away 60 to a different roster.
     * Read-compute-write let both read 100, both pass, and both write 40: 120 spent from a 100 budget, one
     * debit lost, both receivers credited. The second trade must be refused instead.
     */
    const OTHER = 'roster-C'
    const store: Store = { [PROPOSER]: 100, [RECEIVER]: 0, [OTHER]: 0 }
    const first = makeTx(store, { readSnapshot: { ...store } })
    const second = makeTx(store, { readSnapshot: { ...store } })

    await settleRedraftTradeAssets(first.tx, { proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, assets: [faab(PROPOSER, RECEIVER, 60)] })
    await expect(
      settleRedraftTradeAssets(second.tx, { proposerRosterId: PROPOSER, receiverRosterId: OTHER, assets: [faab(PROPOSER, OTHER, 60)] }),
    ).rejects.toThrow(/Insufficient FAAB/)

    expect(store).toEqual({ [PROPOSER]: 40, [RECEIVER]: 60, [OTHER]: 0 })
  })

  it('records draft_pick / future_consideration as reference-only (no roster mutation)', async () => {
    const store: Store = { [PROPOSER]: 100, [RECEIVER]: 100 }
    const { tx, calls } = makeTx(store)
    const assets: SettlementAssetRow[] = [
      { fromRosterId: PROPOSER, toRosterId: RECEIVER, assetType: 'draft_pick', playerId: null, metadata: { label: '2026 R1' } },
      { fromRosterId: RECEIVER, toRosterId: PROPOSER, assetType: 'future_consideration', playerId: null },
    ]
    const res = await settleRedraftTradeAssets(tx, { proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, assets })
    expect(res.picksRecorded).toBe(2)
    expect(res.playersMoved).toBe(0)
    expect(calls.playerUpdates).toHaveLength(0)
    expect(store).toEqual({ [PROPOSER]: 100, [RECEIVER]: 100 })
  })

  it('rejects invalid roster direction', async () => {
    const { tx } = makeTx({})
    const assets: SettlementAssetRow[] = [
      { fromRosterId: 'stranger', toRosterId: RECEIVER, assetType: 'player', playerId: 'p1' },
    ]
    await expect(
      settleRedraftTradeAssets(tx, { proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, assets }),
    ).rejects.toThrow(/invalid roster direction/)
  })
})
