import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The generic (`AfLeagueTrade`) half of the execution-evidence gap.
 *
 * 🛑 The native redraft path got its snapshot writer first; this side was left uncovered, with
 * `TradeExecutionSnapshot.genericTradeId` and its relation sitting unused. Until this landed, a
 * trade executed through the league trade engine left nothing for `TradeReversal` to restore to.
 */

const emitInTxMock = vi.fn()
const snapshotCreateMock = vi.fn()
const rosterFindUniqueMock = vi.fn()

vi.mock('@/lib/events', () => ({
  EVENT: { TRADE_PROCESSED: 'transaction.trade.processed' },
  getPlatformEvents: () => ({ emitInTx: emitInTxMock }),
}))

const tx = {
  roster: { findUnique: rosterFindUniqueMock },
  tradeExecutionSnapshot: { create: snapshotCreateMock },
} as never

const INPUT = {
  tradeId: 't-1',
  leagueId: 'l-1',
  proposerRosterId: 'r-1',
  receiverRosterId: 'r-2',
  executedByActorId: 'u-4',
  executedByActorRole: 'commissioner' as const,
  governance: { statusWhenFinalized: 'awaiting_commissioner', reviewType: 'commissioner' },
  validations: { rosterTransactionGate: 'ok' },
  assetSummary: { items: 2 },
  beforeState: [],
  afterState: [],
  executedAt: new Date('2026-09-12T20:00:00.000Z'),
}

describe('generic trade execution snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    emitInTxMock.mockResolvedValue({ eventId: 'evt-gen-1' })
    snapshotCreateMock.mockResolvedValue({ id: 'snap-gen-1' })
    rosterFindUniqueMock.mockResolvedValue(null)
  })

  it('fills genericTradeId and leaves nativeTradeId alone', async () => {
    const { writeGenericTradeExecutionSnapshot } = await import(
      '@/lib/league-trade-engine/tradeExecutionSnapshot'
    )
    await writeGenericTradeExecutionSnapshot(tx, INPUT)

    const data = snapshotCreateMock.mock.calls[0][0].data
    // 🛑 BOTH COLUMNS ARE UNIQUE, NULLABLE FKs TO DIFFERENT TABLES. Filling the native one here
    // would point a reversal at a redraft proposal that does not exist, and the FK would not
    // object because it is nullable — a silent mis-link, not an error.
    expect(data.genericTradeId).toBe('t-1')
    expect(data.nativeTradeId).toBeUndefined()
    expect(data.tradeSource).toBe('af_league_generic')
    expect(data.executionIdempotencyKey).toBe('af-league-trade-execution:t-1')
    expect(data.seasonId).toBeNull()
  })

  it('emits the outbox event on the same transaction and links it', async () => {
    const { writeGenericTradeExecutionSnapshot } = await import(
      '@/lib/league-trade-engine/tradeExecutionSnapshot'
    )
    const result = await writeGenericTradeExecutionSnapshot(tx, INPUT)

    expect(emitInTxMock.mock.calls[0][0]).toBe(tx)
    // A DIFFERENT key from the native path's `trade.processed:<id>`: the two id spaces are
    // unrelated, and a shared key shape would let a redraft proposal and an AfLeagueTrade with
    // the same id silently dedupe against each other.
    expect(emitInTxMock.mock.calls[0][2].idempotencyKey).toBe('af-trade.processed:t-1')
    expect(emitInTxMock.mock.calls[0][2].leagueConcept).toBeNull()
    expect(snapshotCreateMock.mock.calls[0][0].data.eventId).toBe('evt-gen-1')
    expect(result).toEqual({ snapshotId: 'snap-gen-1', eventId: 'evt-gen-1' })
  })

  it('writes no snapshot when the event cannot be emitted', async () => {
    emitInTxMock.mockRejectedValue(new Error('outbox insert failed'))
    const { writeGenericTradeExecutionSnapshot } = await import(
      '@/lib/league-trade-engine/tradeExecutionSnapshot'
    )
    await expect(writeGenericTradeExecutionSnapshot(tx, INPUT)).rejects.toThrow('outbox insert failed')
    expect(snapshotCreateMock).not.toHaveBeenCalled()
  })

  it('copies playerData whole rather than reshaping it', async () => {
    const blob = { starters: ['p1'], bench: ['p2'], meta: { nested: true } }
    rosterFindUniqueMock.mockResolvedValue({
      id: 'r-1',
      platformUserId: 'pu-1',
      faabRemaining: 42,
      playerData: blob,
    })

    const { captureGenericRosterState } = await import(
      '@/lib/league-trade-engine/tradeExecutionSnapshot'
    )
    const state = await captureGenericRosterState(tx, ['r-2', 'r-1', 'r-1'])

    // `playerData` is the column the trade processor reads and writes, so it is what a reversal
    // has to restore. Normalising it here would make the evidence disagree with the writer.
    expect(state[0].playerData).toEqual(blob)
    expect(state[0].faabRemaining).toBe(42)
    expect(state).toHaveLength(2) // deduped
  })

  describe('the actor role names who actually acted', () => {
    it.each([
      ['awaiting_commissioner', 'commissioner'],
      ['awaiting_votes', 'commissioner'],
      ['scheduled', 'scheduled_processor'],
      ['pending', 'user'],
    ])('%s -> %s', async (status, expected) => {
      const { genericTradeActorRole } = await import(
        '@/lib/league-trade-engine/tradeExecutionSnapshot'
      )
      expect(genericTradeActorRole(status)).toBe(expected)
    })

    it('separates a cron execution from a person pressing process', async () => {
      // 🛑 THE ONE THAT WOULD BE LOST BY DEFAULTING EVERYTHING TO 'user'. The scheduled sweep runs
      // under the id of whoever scheduled the trade, so the ACTOR ID cannot distinguish an
      // automated execution from a manual one. Only the role can.
      const { genericTradeActorRole } = await import(
        '@/lib/league-trade-engine/tradeExecutionSnapshot'
      )
      expect(genericTradeActorRole('scheduled')).not.toBe(genericTradeActorRole('pending'))
    })
  })
})
