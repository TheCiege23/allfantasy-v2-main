/**
 * Unit tests for native redraft trade settlement (lib/redraft/tradeSettlement.ts).
 *
 * Verifies the keystone fix: accepting a trade actually moves RedraftRosterPlayer rows and transfers
 * faabBalance, with ownership / sufficiency validation, and treats picks as reference-only.
 */
import { describe, it, expect, vi } from 'vitest'
import { settleRedraftTradeAssets, type SettlementAssetRow } from '@/lib/redraft/tradeSettlement'

const PROPOSER = 'roster-A'
const RECEIVER = 'roster-B'

function makeTx(faab: Record<string, number> = {}, movedCount = 1) {
  const balances = { ...faab }
  const calls = {
    playerUpdates: [] as Array<{ where: unknown; data: unknown }>,
    // One entry per successful atomic $executeRaw guarded update (mirrors the real
    // UPDATE "redraft_rosters" SET "faabBalance" = "faabBalance" + $delta WHERE
    // id = $rosterId AND ... >= 0 statement — see lib/redraft/tradeSettlement.ts).
    rosterUpdates: [] as Array<{ id: string; faabBalance: number }>,
  }
  const tx = {
    redraftRosterPlayer: {
      updateMany: vi.fn(async ({ where, data }: { where: unknown; data: unknown }) => {
        calls.playerUpdates.push({ where, data })
        return { count: movedCount }
      }),
    },
    // Simulates the atomic guarded UPDATE: tagged-template call, interpolated
    // values are [delta, rosterId, delta] matching the real query's parameter order.
    $executeRaw: vi.fn(async (_strings: TemplateStringsArray, delta: number, rosterId: string) => {
      const current = balances[rosterId] ?? 0
      const next = current + delta
      if (next < 0) return 0
      balances[rosterId] = next
      calls.rosterUpdates.push({ id: rosterId, faabBalance: next })
      return 1
    }),
  }
  return { tx: tx as never, calls }
}

describe('settleRedraftTradeAssets', () => {
  it('moves player rows between rosters with acquisitionType=trade', async () => {
    const { tx, calls } = makeTx()
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
    const { tx } = makeTx({}, 0)
    const assets: SettlementAssetRow[] = [
      { fromRosterId: PROPOSER, toRosterId: RECEIVER, assetType: 'player', playerId: 'gone' },
    ]
    await expect(
      settleRedraftTradeAssets(tx, { proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, assets }),
    ).rejects.toThrow(/no longer on the sending roster/)
  })

  it('transfers FAAB from sender to receiver using metadata.amount', async () => {
    const { tx, calls } = makeTx({ [PROPOSER]: 100, [RECEIVER]: 50 })
    const assets: SettlementAssetRow[] = [
      { fromRosterId: PROPOSER, toRosterId: RECEIVER, assetType: 'faab', playerId: null, metadata: { amount: 30 } },
    ]
    const res = await settleRedraftTradeAssets(tx, { proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, assets })
    expect(res.faabTransferred).toBe(30)
    const proposer = calls.rosterUpdates.find((u) => u.id === PROPOSER)
    const receiver = calls.rosterUpdates.find((u) => u.id === RECEIVER)
    expect(proposer?.faabBalance).toBe(70)
    expect(receiver?.faabBalance).toBe(80)
  })

  it('throws on insufficient FAAB', async () => {
    const { tx } = makeTx({ [PROPOSER]: 10, [RECEIVER]: 50 })
    const assets: SettlementAssetRow[] = [
      { fromRosterId: PROPOSER, toRosterId: RECEIVER, assetType: 'faab', playerId: null, metadata: { amount: 30 } },
    ]
    await expect(
      settleRedraftTradeAssets(tx, { proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, assets }),
    ).rejects.toThrow(/Insufficient FAAB/)
  })

  it('records draft_pick / future_consideration as reference-only (no roster mutation)', async () => {
    const { tx, calls } = makeTx()
    const assets: SettlementAssetRow[] = [
      { fromRosterId: PROPOSER, toRosterId: RECEIVER, assetType: 'draft_pick', playerId: null, metadata: { label: '2026 R1' } },
      { fromRosterId: RECEIVER, toRosterId: PROPOSER, assetType: 'future_consideration', playerId: null },
    ]
    const res = await settleRedraftTradeAssets(tx, { proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, assets })
    expect(res.picksRecorded).toBe(2)
    expect(res.playersMoved).toBe(0)
    expect(calls.playerUpdates).toHaveLength(0)
    expect(calls.rosterUpdates).toHaveLength(0)
  })

  it('rejects invalid roster direction', async () => {
    const { tx } = makeTx()
    const assets: SettlementAssetRow[] = [
      { fromRosterId: 'stranger', toRosterId: RECEIVER, assetType: 'player', playerId: 'p1' },
    ]
    await expect(
      settleRedraftTradeAssets(tx, { proposerRosterId: PROPOSER, receiverRosterId: RECEIVER, assets }),
    ).rejects.toThrow(/invalid roster direction/)
  })
})
