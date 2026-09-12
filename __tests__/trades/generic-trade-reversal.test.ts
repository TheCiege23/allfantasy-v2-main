import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reversing an executed generic trade from its execution snapshot.
 *
 * 🛑 WHAT THESE ARE REALLY GUARDING. Reversal overwrites two rosters with recorded state. The
 * dangerous failure is not "it refused when it should have worked" — that is an inconvenience. It
 * is "it wrote when it should have refused", which silently undoes whatever happened after the
 * trade. Most of this file is about the second kind.
 */

const emitInTxMock = vi.fn()

const db = {
  afLeagueTrade: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  tradeExecutionSnapshot: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  tradeReversal: { findUnique: vi.fn(), create: vi.fn() },
  roster: { findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
}

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/events', () => ({
  EVENT: { TRADE_CANCELED: 'transaction.trade.canceled' },
  getPlatformEvents: () => ({ emitInTx: emitInTxMock }),
}))

/** `playerData` shapes that `getRosterPlayerIds` understands. */
const rosterBlob = (ids: string[], extra: Record<string, unknown> = {}) => ({
  players: ids.map((id) => ({ playerId: id })),
  ...extra,
})

const BEFORE = {
  rosters: [
    { rosterId: 'r1', platformUserId: 'u1', faabRemaining: 100, playerData: rosterBlob(['a', 'b']) },
    { rosterId: 'r2', platformUserId: 'u2', faabRemaining: 50, playerData: rosterBlob(['c']) },
  ],
}
const AFTER = {
  rosters: [
    { rosterId: 'r1', platformUserId: 'u1', faabRemaining: 90, playerData: rosterBlob(['a', 'c']) },
    { rosterId: 'r2', platformUserId: 'u2', faabRemaining: 60, playerData: rosterBlob(['b']) },
  ],
}

/** The world as it stands immediately after the trade — i.e. reversible. */
function worldMatchesAfterState() {
  db.afLeagueTrade.findUnique.mockResolvedValue({
    id: 't-1',
    status: 'processed',
    proposerRosterId: 'r1',
    receiverRosterId: 'r2',
  })
  db.afLeagueTrade.findUniqueOrThrow.mockResolvedValue({ id: 't-1', leagueId: 'l-1', status: 'processed' })
  db.tradeExecutionSnapshot.findUnique.mockResolvedValue({
    id: 'snap-1',
    tradeSource: 'af_league_generic',
    afterState: AFTER,
  })
  db.tradeExecutionSnapshot.findUniqueOrThrow.mockResolvedValue({ id: 'snap-1', beforeState: BEFORE })
  db.tradeReversal.findUnique.mockResolvedValue(null)
  db.roster.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const m = AFTER.rosters.find((r) => r.rosterId === where.id)
    return m ? { playerData: m.playerData, faabRemaining: m.faabRemaining } : null
  })
  db.afLeagueTrade.updateMany.mockResolvedValue({ count: 1 })
  db.tradeReversal.create.mockResolvedValue({ id: 'rev-1' })
}

describe('generic trade reversal readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    emitInTxMock.mockResolvedValue({ eventId: 'evt-rev-1' })
    worldMatchesAfterState()
  })

  it('is ready when the rosters still look exactly as the trade left them', async () => {
    const { evaluateGenericTradeReversalReadiness } = await import('@/lib/league-trade-engine/tradeReversal')
    const r = await evaluateGenericTradeReversalReadiness(db as never, 't-1')
    expect(r).toEqual({ ok: true, blockers: [], drift: [] })
  })

  it('🛑 refuses when a roster changed after execution', async () => {
    // THE CENTRAL SAFETY TEST. A later trade, a waiver claim or a commissioner edit all make the
    // recorded "before" the wrong thing to write back — restoring it would undo whatever came
    // after, with no record that it happened.
    db.roster.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'r1') return { playerData: rosterBlob(['a', 'c', 'z']), faabRemaining: 90 }
      const m = AFTER.rosters.find((r) => r.rosterId === where.id)!
      return { playerData: m.playerData, faabRemaining: m.faabRemaining }
    })

    const { evaluateGenericTradeReversalReadiness } = await import('@/lib/league-trade-engine/tradeReversal')
    const r = await evaluateGenericTradeReversalReadiness(db as never, 't-1')

    expect(r.ok).toBe(false)
    expect(r.blockers).toContain('ROSTER_CHANGED_SINCE_EXECUTION')
    // The drift is kept so a refusal can be explained later, not just asserted at the time.
    expect(r.drift.map((d) => d.rosterId)).toEqual(['r1'])
  })

  it('⚠ ignores lineup churn that does not change WHO is on the roster', async () => {
    // Deliberate design decision, pinned because it is the one that could quietly invert.
    // `playerData` carries slots, timestamps and provider scratch that change without anyone
    // trading. A byte-for-byte comparison would refuse nearly every real reversal — and a guard
    // that always refuses is a guard someone switches off. Membership + FAAB is what a trade moves.
    db.roster.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const m = AFTER.rosters.find((r) => r.rosterId === where.id)!
      return {
        playerData: rosterBlob(
          [...m.playerData.players].map((p) => p.playerId).reverse(),
          { lineupUpdatedAt: '2026-09-12T21:00:00Z', slots: { QB: 'a' } },
        ),
        faabRemaining: m.faabRemaining,
      }
    })

    const { evaluateGenericTradeReversalReadiness } = await import('@/lib/league-trade-engine/tradeReversal')
    expect((await evaluateGenericTradeReversalReadiness(db as never, 't-1')).ok).toBe(true)
  })

  it('⚠ still catches a FAAB-only change', async () => {
    // The counterpart to the test above: loosening the comparison must not blind it to FAAB, which
    // a trade moves just as really as it moves players.
    db.roster.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const m = AFTER.rosters.find((r) => r.rosterId === where.id)!
      return { playerData: m.playerData, faabRemaining: where.id === 'r2' ? 61 : m.faabRemaining }
    })

    const { evaluateGenericTradeReversalReadiness } = await import('@/lib/league-trade-engine/tradeReversal')
    const r = await evaluateGenericTradeReversalReadiness(db as never, 't-1')
    expect(r.blockers).toContain('ROSTER_CHANGED_SINCE_EXECUTION')
  })

  it('refuses a trade with no execution snapshot, and does not try to reconstruct one', async () => {
    // Everything executed before the snapshot writers landed falls here. A guessed "before" is not
    // evidence, and inventing one is how a reversal invents a roster.
    db.tradeExecutionSnapshot.findUnique.mockResolvedValue(null)
    const { evaluateGenericTradeReversalReadiness } = await import('@/lib/league-trade-engine/tradeReversal')
    const r = await evaluateGenericTradeReversalReadiness(db as never, 't-1')
    expect(r.blockers).toEqual(['NO_EXECUTION_SNAPSHOT'])
  })

  it('refuses a native-redraft snapshot rather than restoring rows as a blob', async () => {
    db.tradeExecutionSnapshot.findUnique.mockResolvedValue({
      id: 'snap-n',
      tradeSource: 'redraft_native',
      afterState: AFTER,
    })
    const { evaluateGenericTradeReversalReadiness } = await import('@/lib/league-trade-engine/tradeReversal')
    const r = await evaluateGenericTradeReversalReadiness(db as never, 't-1')
    expect(r.blockers).toContain('SNAPSHOT_NOT_GENERIC')
  })

  it('refuses a trade that was already reversed', async () => {
    db.tradeReversal.findUnique.mockResolvedValue({ id: 'rev-existing' })
    const { evaluateGenericTradeReversalReadiness } = await import('@/lib/league-trade-engine/tradeReversal')
    expect((await evaluateGenericTradeReversalReadiness(db as never, 't-1')).blockers).toContain('ALREADY_REVERSED')
  })

  it('refuses a trade that is not processed', async () => {
    db.afLeagueTrade.findUnique.mockResolvedValue({
      id: 't-1',
      status: 'pending',
      proposerRosterId: 'r1',
      receiverRosterId: 'r2',
    })
    const { evaluateGenericTradeReversalReadiness } = await import('@/lib/league-trade-engine/tradeReversal')
    expect((await evaluateGenericTradeReversalReadiness(db as never, 't-1')).blockers).toContain('TRADE_NOT_PROCESSED')
  })
})

describe('reverseGenericTrade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    emitInTxMock.mockResolvedValue({ eventId: 'evt-rev-1' })
    worldMatchesAfterState()
  })

  it('restores both rosters from beforeState and records the reversal', async () => {
    const { reverseGenericTrade } = await import('@/lib/league-trade-engine/tradeReversal')
    const res = await reverseGenericTrade({
      tradeId: 't-1',
      actorUserId: 'u-commish',
      actorRole: 'commissioner',
      reason: 'collusion review',
    })

    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('unreachable')
    expect(res.rostersRestored).toBe(2)

    // Written back from the SNAPSHOT, never recomputed.
    expect(db.roster.update).toHaveBeenCalledTimes(2)
    const r1 = db.roster.update.mock.calls.find((c) => c[0].where.id === 'r1')![0]
    expect(r1.data.playerData).toEqual(BEFORE.rosters[0].playerData)
    expect(r1.data.faabRemaining).toBe(100)

    // Conditional claim, same shape as settlement: two reversals racing must not both write.
    expect(db.afLeagueTrade.updateMany.mock.calls[0][0].where).toEqual({ id: 't-1', status: 'processed' })

    const row = db.tradeReversal.create.mock.calls[0][0].data
    expect(row.snapshotId).toBe('snap-1')
    expect(row.eventId).toBe('evt-rev-1')
    expect(row.idempotencyKey).toBe('af-league-trade-reversal:t-1')
    expect(row.noticeKey).toBe('af_trade:t-1:reversed')
    expect(row.reason).toBe('collusion review')
    expect(row.actorRole).toBe('commissioner')
    // The verdict that authorised the write is kept with the row.
    expect(row.readiness.ok).toBe(true)
  })

  it('🛑 writes NOTHING when readiness fails inside the transaction', async () => {
    // The preflight is a courtesy; this is the check that decides. A reversal authorised by a
    // stale read is exactly the clobber this module exists to prevent — so the in-transaction
    // re-evaluation is simulated going stale between the two calls.
    let call = 0
    db.roster.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      call += 1
      const m = AFTER.rosters.find((r) => r.rosterId === where.id)!
      // First pass (preflight) clean; second pass (inside the tx) sees a changed roster.
      if (call > 2 && where.id === 'r1') return { playerData: rosterBlob(['a', 'c', 'z']), faabRemaining: 90 }
      return { playerData: m.playerData, faabRemaining: m.faabRemaining }
    })

    const { reverseGenericTrade } = await import('@/lib/league-trade-engine/tradeReversal')
    const res = await reverseGenericTrade({
      tradeId: 't-1',
      actorUserId: 'u-commish',
      actorRole: 'commissioner',
      reason: 'late refusal',
    })

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.readiness.blockers).toContain('ROSTER_CHANGED_SINCE_EXECUTION')
    expect(db.roster.update).not.toHaveBeenCalled()
    expect(db.tradeReversal.create).not.toHaveBeenCalled()
  })

  it('refuses before opening a transaction when the preflight already says no', async () => {
    db.tradeExecutionSnapshot.findUnique.mockResolvedValue(null)
    const { reverseGenericTrade } = await import('@/lib/league-trade-engine/tradeReversal')
    const res = await reverseGenericTrade({
      tradeId: 't-1',
      actorUserId: 'u-commish',
      actorRole: 'commissioner',
      reason: 'no snapshot',
    })
    expect(res.ok).toBe(false)
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('refuses when the status claim loses its race', async () => {
    db.afLeagueTrade.updateMany.mockResolvedValue({ count: 0 })
    const { reverseGenericTrade } = await import('@/lib/league-trade-engine/tradeReversal')
    const res = await reverseGenericTrade({
      tradeId: 't-1',
      actorUserId: 'u-commish',
      actorRole: 'commissioner',
      reason: 'raced',
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.readiness.blockers).toContain('ALREADY_REVERSED')
    expect(db.tradeReversal.create).not.toHaveBeenCalled()
  })
})
