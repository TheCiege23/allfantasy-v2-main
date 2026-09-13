import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reversing a native redraft trade: rows, FAAB and an append-only IDP cap ledger.
 *
 * 🛑 THE FAILURE THAT MATTERS IS WRITING WHEN IT SHOULD REFUSE. Refusing a legitimate reversal is
 * an inconvenience; restoring stale state silently undoes whatever happened after the trade. Most of
 * this file is about the second kind.
 *
 * `captureRedraftRosterState` is NOT mocked — readiness runs the real capture against the mock
 * client, so the membership/FAAB comparison under test is the production one.
 */

const emitInTxMock = vi.fn()

const db = {
  redraftTradeProposal: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  tradeExecutionSnapshot: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  tradeReversal: { findUnique: vi.fn(), create: vi.fn() },
  redraftRoster: { findUnique: vi.fn(), update: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn(), updateMany: vi.fn() },
  iDPCapTransaction: { findMany: vi.fn(), create: vi.fn() },
  iDPSalaryRecord: { findFirst: vi.fn(), findFirstOrThrow: vi.fn(), update: vi.fn() },
  iDPCapConfig: { findUnique: vi.fn() },
  $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
}

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/events', () => ({
  EVENT: { TRADE_CANCELED: 'transaction.trade.canceled' },
  getPlatformEvents: () => ({ emitInTx: emitInTxMock }),
}))

type P = { playerId: string; playerName: string; position: string; slotType: string; acquisitionType: string }
const pl = (playerId: string, slotType: string, acquisitionType: string): P => ({
  playerId,
  playerName: playerId.toUpperCase(),
  position: 'WR',
  slotType,
  acquisitionType,
})

/*
 * The trade: `b` goes r1 -> r2, `c` goes r2 -> r1, and 10 FAAB goes r1 -> r2.
 * `b` carries an IDP salary record, moved by the ledger pair cap-out / cap-in.
 */
const BEFORE = {
  rosters: [
    { rosterId: 'r1', teamName: 'One', ownerId: 'o1', faabBalance: 100, players: [pl('a', 'STARTER', 'drafted'), pl('b', 'FLEX', 'waiver')] },
    { rosterId: 'r2', teamName: 'Two', ownerId: 'o2', faabBalance: 50, players: [pl('c', 'STARTER', 'drafted')] },
  ],
}
const AFTER = {
  rosters: [
    { rosterId: 'r1', teamName: 'One', ownerId: 'o1', faabBalance: 90, players: [pl('a', 'STARTER', 'drafted'), pl('c', 'BENCH', 'trade')] },
    { rosterId: 'r2', teamName: 'Two', ownerId: 'o2', faabBalance: 60, players: [pl('b', 'BENCH', 'trade')] },
  ],
}

/** Point the mock client's roster reads at a given world. */
function serveRosters(world: typeof AFTER) {
  db.redraftRoster.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const r = world.rosters.find((x) => x.rosterId === where.id)
    return r ? { id: r.rosterId, teamName: r.teamName, ownerId: r.ownerId, faabBalance: r.faabBalance } : null
  })
  db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: { where: { rosterId: string } }) => {
    const r = world.rosters.find((x) => x.rosterId === where.rosterId)
    return r ? r.players : []
  })
}

/** Immediately after the trade: reversible. */
function worldAsTheTradeLeftIt() {
  db.redraftTradeProposal.findUnique.mockResolvedValue({ id: 'p-1', status: 'accepted', leagueId: 'l-1' })
  db.redraftTradeProposal.findUniqueOrThrow.mockResolvedValue({ id: 'p-1', leagueId: 'l-1', seasonId: 's-1' })
  db.redraftTradeProposal.updateMany.mockResolvedValue({ count: 1 })
  const snap = {
    id: 'snap-1',
    tradeSource: 'redraft_native',
    beforeState: BEFORE,
    afterState: AFTER,
    dependencies: { sourceTransactionIds: ['cap-out', 'cap-in'] },
  }
  db.tradeExecutionSnapshot.findUnique.mockResolvedValue(snap)
  db.tradeExecutionSnapshot.findUniqueOrThrow.mockResolvedValue(snap)
  db.tradeReversal.findUnique.mockResolvedValue(null)
  db.tradeReversal.create.mockResolvedValue({ id: 'rev-1' })
  serveRosters(AFTER)
  db.redraftRosterPlayer.updateMany.mockResolvedValue({ count: 1 })
  db.iDPCapTransaction.findMany.mockResolvedValue([
    { id: 'cap-out', playerId: 'b', rosterId: 'r1', transactionType: 'trade_out' },
    { id: 'cap-in', playerId: 'b', rosterId: 'r2', transactionType: 'trade_in' },
  ])
  let n = 0
  db.iDPCapTransaction.create.mockImplementation(async () => ({ id: `rev-ledger-${++n}` }))
  // The salary record is still where the trade put it.
  db.iDPSalaryRecord.findFirst.mockResolvedValue({ rosterId: 'r2' })
  db.iDPSalaryRecord.findFirstOrThrow.mockResolvedValue({
    id: 'sal-b',
    playerId: 'b',
    playerName: 'B',
    isDefensive: true,
    salary: 12,
    yearsRemaining: 2,
  })
  db.iDPCapConfig.findUnique.mockResolvedValue({ season: 2026 })
}

async function load() {
  return import('@/lib/redraft/tradeReversal')
}

describe('native trade reversal readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    emitInTxMock.mockResolvedValue({ eventId: 'evt-nrev-1' })
    worldAsTheTradeLeftIt()
  })

  it('is ready when rosters and cap records are exactly where the trade left them', async () => {
    const { evaluateNativeTradeReversalReadiness } = await load()
    expect(await evaluateNativeTradeReversalReadiness(db as never, 'p-1')).toEqual({ ok: true, blockers: [], drift: [] })
  })

  it('🛑 refuses when roster membership changed after the trade', async () => {
    serveRosters({
      rosters: [
        AFTER.rosters[0],
        { ...AFTER.rosters[1], players: [...AFTER.rosters[1].players, pl('z', 'BENCH', 'waiver')] },
      ],
    })
    const { evaluateNativeTradeReversalReadiness } = await load()
    const r = await evaluateNativeTradeReversalReadiness(db as never, 'p-1')
    expect(r.blockers).toContain('ROSTER_CHANGED_SINCE_EXECUTION')
    expect(r.drift.map((d) => d.rosterId)).toEqual(['r2'])
  })

  it('⚠ refuses a FAAB-only change, and ignores a slot-only change', async () => {
    const { evaluateNativeTradeReversalReadiness } = await load()

    serveRosters({ rosters: [{ ...AFTER.rosters[0], faabBalance: 89 }, AFTER.rosters[1]] })
    expect((await evaluateNativeTradeReversalReadiness(db as never, 'p-1')).blockers).toContain('ROSTER_CHANGED_SINCE_EXECUTION')

    // Same people, same FAAB, different lineup slots: not a reason to refuse.
    serveRosters({
      rosters: [
        { ...AFTER.rosters[0], players: [pl('a', 'BENCH', 'drafted'), pl('c', 'STARTER', 'trade')] },
        AFTER.rosters[1],
      ],
    })
    expect((await evaluateNativeTradeReversalReadiness(db as never, 'p-1')).ok).toBe(true)
  })

  it('🛑 refuses when a salary record the trade moved has moved again', async () => {
    // A cut, extension or later trade touched it. Putting it "back" would be wrong.
    db.iDPSalaryRecord.findFirst.mockResolvedValue({ rosterId: 'r3' })
    const { evaluateNativeTradeReversalReadiness } = await load()
    expect((await evaluateNativeTradeReversalReadiness(db as never, 'p-1')).blockers).toContain('CAP_RECORD_MOVED_SINCE_EXECUTION')
  })

  it('refuses on incomplete cap evidence rather than reversing half of it', async () => {
    db.iDPCapTransaction.findMany.mockResolvedValue([
      { id: 'cap-out', playerId: 'b', rosterId: 'r1', transactionType: 'trade_out' },
    ])
    const { evaluateNativeTradeReversalReadiness } = await load()
    expect((await evaluateNativeTradeReversalReadiness(db as never, 'p-1')).blockers).toContain('CAP_LEDGER_MISSING')
  })

  it.each([
    ['no snapshot', () => db.tradeExecutionSnapshot.findUnique.mockResolvedValue(null), 'NO_EXECUTION_SNAPSHOT'],
    ['a generic snapshot', () => db.tradeExecutionSnapshot.findUnique.mockResolvedValue({ id: 'g', tradeSource: 'af_league_generic', afterState: AFTER, dependencies: {} }), 'SNAPSHOT_NOT_NATIVE'],
    ['a pending proposal', () => db.redraftTradeProposal.findUnique.mockResolvedValue({ id: 'p-1', status: 'pending', leagueId: 'l-1' }), 'PROPOSAL_NOT_ACCEPTED'],
    ['an existing reversal', () => db.tradeReversal.findUnique.mockResolvedValue({ id: 'old' }), 'ALREADY_REVERSED'],
  ])('refuses %s', async (_label, arrange, blocker) => {
    arrange()
    const { evaluateNativeTradeReversalReadiness } = await load()
    expect((await evaluateNativeTradeReversalReadiness(db as never, 'p-1')).blockers).toContain(blocker)
  })
})

describe('reverseNativeTrade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    emitInTxMock.mockResolvedValue({ eventId: 'evt-nrev-1' })
    worldAsTheTradeLeftIt()
  })

  const INPUT = { proposalId: 'p-1', actorUserId: 'u-commish', actorRole: 'commissioner', reason: 'collusion review' }

  it('moves each traded player back with their original slot and acquisition type', async () => {
    const { reverseNativeTrade } = await load()
    const res = await reverseNativeTrade(INPUT)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('unreachable')
    expect(res.playersRestored).toBe(2)
    // The key the route dispatches the league notice with — the same string stored on the row.
    expect(res.noticeKey).toBe('redraft_trade:p-1:reversed')
    expect(db.tradeReversal.create.mock.calls[0][0].data.noticeKey).toBe(res.noticeKey)

    const calls = db.redraftRosterPlayer.updateMany.mock.calls.map((c) => c[0])
    // `c` came r2 -> r1; it goes back to r2 as the STARTER it was, not the BENCH trade settlement made it.
    expect(calls).toContainEqual({
      where: { rosterId: 'r1', playerId: 'c', droppedAt: null },
      data: { rosterId: 'r2', slotType: 'STARTER', acquisitionType: 'drafted' },
    })
    expect(calls).toContainEqual({
      where: { rosterId: 'r2', playerId: 'b', droppedAt: null },
      data: { rosterId: 'r1', slotType: 'FLEX', acquisitionType: 'waiver' },
    })
    // `a` never moved and must not be touched.
    expect(calls.some((c) => c.where.playerId === 'a')).toBe(false)
  })

  it('restores FAAB to the before-state balances', async () => {
    const { reverseNativeTrade } = await load()
    await reverseNativeTrade(INPUT)
    const updates = db.redraftRoster.update.mock.calls.map((c) => c[0])
    expect(updates).toContainEqual({ where: { id: 'r1' }, data: { faabBalance: 100 } })
    expect(updates).toContainEqual({ where: { id: 'r2' }, data: { faabBalance: 50 } })
  })

  it('moves the salary record back and APPENDS reversing ledger rows, never editing the originals', async () => {
    const { reverseNativeTrade } = await load()
    const res = await reverseNativeTrade(INPUT)
    if (!res.ok) throw new Error('unreachable')
    expect(res.capRecordsRestored).toBe(1)

    expect(db.iDPSalaryRecord.update).toHaveBeenCalledWith({ where: { id: 'sal-b' }, data: { rosterId: 'r1' } })
    const rows = db.iDPCapTransaction.create.mock.calls.map((c) => c[0].data)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ rosterId: 'r2', transactionType: 'trade_reversal_out', capImpact: -12, season: 2026 })
    expect(rows[1]).toMatchObject({ rosterId: 'r1', transactionType: 'trade_reversal_in', capImpact: 12, season: 2026 })
    // The ledger is history: nothing here updates or deletes an existing IDPCapTransaction row.
    expect(Object.keys(db.iDPCapTransaction)).not.toContain('update')
  })

  it('records the reversal with the season, readiness and new ledger ids', async () => {
    const { reverseNativeTrade } = await load()
    await reverseNativeTrade(INPUT)

    expect(db.redraftTradeProposal.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'p-1', status: 'accepted' },
      data: { status: 'reversed' },
    })
    const row = db.tradeReversal.create.mock.calls[0][0].data
    expect(row).toMatchObject({
      tradeId: 'p-1',
      snapshotId: 'snap-1',
      seasonId: 's-1',
      actorRole: 'commissioner',
      reason: 'collusion review',
      eventId: 'evt-nrev-1',
      idempotencyKey: 'redraft-trade-reversal:p-1',
      noticeKey: 'redraft_trade:p-1:reversed',
    })
    expect(row.readiness.ok).toBe(true)
    expect(row.restoredState.capReversalTransactionIds).toEqual(['rev-ledger-1', 'rev-ledger-2'])
  })

  it('🛑 writes NOTHING when readiness fails inside the transaction', async () => {
    // Preflight clean; the in-transaction re-read sees a roster that changed in between.
    let reads = 0
    db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: { where: { rosterId: string } }) => {
      reads += 1
      const r = AFTER.rosters.find((x) => x.rosterId === where.rosterId)!
      if (reads > 2 && where.rosterId === 'r2') return [...r.players, pl('z', 'BENCH', 'waiver')]
      return r.players
    })

    const { reverseNativeTrade } = await load()
    const res = await reverseNativeTrade(INPUT)

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.readiness.blockers).toContain('ROSTER_CHANGED_SINCE_EXECUTION')
    expect(db.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
    expect(db.iDPSalaryRecord.update).not.toHaveBeenCalled()
    expect(db.tradeReversal.create).not.toHaveBeenCalled()
  })

  it('refuses when the status claim loses its race', async () => {
    db.redraftTradeProposal.updateMany.mockResolvedValue({ count: 0 })
    const { reverseNativeTrade } = await load()
    const res = await reverseNativeTrade(INPUT)
    expect(res.ok).toBe(false)
    expect(db.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
    expect(db.tradeReversal.create).not.toHaveBeenCalled()
  })

  it('throws, and records nothing, if a traded player cannot be found to move back', async () => {
    db.redraftRosterPlayer.updateMany.mockResolvedValue({ count: 0 })
    const { reverseNativeTrade } = await load()
    await expect(reverseNativeTrade(INPUT)).rejects.toThrow(/could not find/)
    expect(db.tradeReversal.create).not.toHaveBeenCalled()
  })
})
