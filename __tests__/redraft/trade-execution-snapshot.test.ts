import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 `TradeExecutionSnapshot` HAD NO WRITER. Measured on origin/main: the model, its
 * `TradeReversal` counterpart and several documents describing both were on main, and
 * `tradeExecutionSnapshot.create` appeared nowhere in production code. Every trade executed
 * without leaving the evidence a reversal would need.
 *
 * These pin the properties that make the row evidence rather than decoration: it is written on the
 * settlement transaction, its `beforeState` is read before anything moves, and its `eventId` comes
 * from an event emitted on that same transaction.
 */

const emitInTxMock = vi.fn()
const snapshotCreateMock = vi.fn()
const rosterFindUniqueMock = vi.fn()
const rosterPlayerFindManyMock = vi.fn()

vi.mock('@/lib/events', () => ({
  EVENT: { TRADE_PROCESSED: 'transaction.trade.processed' },
  getPlatformEvents: () => ({ emitInTx: emitInTxMock }),
}))

const tx = {
  redraftRoster: { findUnique: rosterFindUniqueMock },
  redraftRosterPlayer: { findMany: rosterPlayerFindManyMock },
  tradeExecutionSnapshot: { create: snapshotCreateMock },
} as never

const INPUT = {
  proposalId: 'p-1',
  leagueId: 'l-1',
  seasonId: 's-1',
  proposerRosterId: 'r-1',
  receiverRosterId: 'r-2',
  executedByActorId: 'u-9',
  executedByActorRole: 'commissioner' as const,
  governance: { vetoMode: 'commissioner', vetoThreshold: null, terminalEventType: 'commissioner_approved', decisionReason: null },
  validations: { idpCap: 'ok', capTransfersApplied: 2 },
  assetSummary: { playersMoved: 2, faabTransferred: 0, picksRecorded: 0 },
  sourceTransactionIds: ['cap-tx-1', 'cap-tx-2'],
  beforeState: [],
  afterState: [],
  executedAt: new Date('2026-09-12T19:00:00.000Z'),
}

describe('redraft trade execution snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    emitInTxMock.mockResolvedValue({ eventId: 'evt-77' })
    snapshotCreateMock.mockResolvedValue({ id: 'snap-1' })
    rosterFindUniqueMock.mockResolvedValue(null)
    rosterPlayerFindManyMock.mockResolvedValue([])
  })

  it('emits the outbox event on the SAME transaction, not best-effort afterwards', async () => {
    const { writeRedraftTradeExecutionSnapshot } = await import('@/lib/redraft/tradeExecutionSnapshot')
    await writeRedraftTradeExecutionSnapshot(tx, INPUT)

    // `eventId` is NOT NULL and unique on the model. Evidence pointing at an event that a
    // post-commit emit might never have written is not evidence.
    expect(emitInTxMock).toHaveBeenCalledTimes(1)
    expect(emitInTxMock.mock.calls[0][0]).toBe(tx)
    expect(emitInTxMock.mock.calls[0][2].idempotencyKey).toBe('trade.processed:p-1')
  })

  it('links the snapshot to that event and to the cap rows created in the same transaction', async () => {
    const { writeRedraftTradeExecutionSnapshot } = await import('@/lib/redraft/tradeExecutionSnapshot')
    const result = await writeRedraftTradeExecutionSnapshot(tx, INPUT)

    const data = snapshotCreateMock.mock.calls[0][0].data
    expect(data.eventId).toBe('evt-77')
    expect(data.tradeId).toBe('p-1')
    expect(data.nativeTradeId).toBe('p-1')
    expect(data.tradeSource).toBe('redraft_native')
    expect(data.executionIdempotencyKey).toBe('redraft-trade-execution:p-1')
    // The reason `applyRedraftTradeCapTransfersInTransaction` returns ids at all: reversal
    // preflight has to know the trade has IDP cap dependencies.
    expect(data.dependencies).toEqual({ sourceTransactionIds: ['cap-tx-1', 'cap-tx-2'] })
    expect(result).toEqual({ snapshotId: 'snap-1', eventId: 'evt-77' })
  })

  it('records the governance path that executed it, not a blanket "user"', async () => {
    const { writeRedraftTradeExecutionSnapshot } = await import('@/lib/redraft/tradeExecutionSnapshot')
    await writeRedraftTradeExecutionSnapshot(tx, INPUT)

    expect(snapshotCreateMock.mock.calls[0][0].data.executedByActorRole).toBe('commissioner')
    expect(snapshotCreateMock.mock.calls[0][0].data.executedByActorId).toBe('u-9')
  })

  it('reads roster state on the transaction, sorted, and counts only undropped players', async () => {
    rosterFindUniqueMock.mockResolvedValue({
      id: 'r-1',
      teamName: 'Team One',
      ownerId: 'owner-1',
      faabBalance: 73,
    })
    rosterPlayerFindManyMock.mockResolvedValue([
      { playerId: 'a', playerName: 'A', position: 'RB', slotType: 'BENCH', acquisitionType: 'trade' },
    ])

    const { captureRedraftRosterState } = await import('@/lib/redraft/tradeExecutionSnapshot')
    // Duplicates and reverse order in, deterministic order out — a reversal compares two JSON
    // blobs, and blobs differing only in row order read as a difference.
    const state = await captureRedraftRosterState(tx, ['r-2', 'r-1', 'r-1'])

    expect(rosterPlayerFindManyMock.mock.calls[0][0].where).toEqual({ rosterId: 'r-1', droppedAt: null })
    expect(rosterPlayerFindManyMock.mock.calls[0][0].orderBy).toEqual({ playerId: 'asc' })
    expect(state).toHaveLength(2)
    expect(state[0].rosterId).toBe('r-1')
    expect(state[0].faabBalance).toBe(73)
  })

  it('propagates an emit failure instead of writing a snapshot with no event', async () => {
    emitInTxMock.mockRejectedValue(new Error('outbox insert failed'))

    const { writeRedraftTradeExecutionSnapshot } = await import('@/lib/redraft/tradeExecutionSnapshot')
    await expect(writeRedraftTradeExecutionSnapshot(tx, INPUT)).rejects.toThrow('outbox insert failed')
    expect(snapshotCreateMock).not.toHaveBeenCalled()
  })
})
