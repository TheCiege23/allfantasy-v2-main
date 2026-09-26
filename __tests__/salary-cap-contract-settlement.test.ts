import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TradeContractState } from '@/lib/salary-cap/TradeContractSettlement'

const mocks = vi.hoisted(() => ({ config: vi.fn(), emit: vi.fn(), db: {} as Record<string, unknown> }))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: mocks.config }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }))
vi.mock('@/lib/events', () => ({ EVENT: { TRADE_CANCELED: 'transaction.trade.canceled' },
  getPlatformEvents: () => ({ emitInTx: mocks.emit }) }))
import { settleTradeContracts } from '@/lib/salary-cap/TradeContractSettlement'
import { applyTradeAssetsInTransaction } from '@/lib/league-trade-engine/tradeProcessor'
import { evaluateGenericTradeReversalReadiness, reverseGenericTrade } from '@/lib/league-trade-engine/tradeReversal'

const rules = { leagueId: 'L', configId: 'cfg', season: 2026, capStartYear: 2026,
  startupCap: 100, capGrowthPercent: 0, capFloorEnabled: false, capFloorAmount: null }
const contract = (id: string, rosterId: string, salary: number, extra = {}): TradeContractState => ({
  id, configId: 'cfg', rosterId, playerId: id, salary, yearSigned: 2026, yearsTotal: 2,
  contractYear: 1, status: 'active', deadMoneyRemaining: null, ...extra,
})
const moves = [{ playerId: 'p', fromRosterId: 'a', toRosterId: 'b' }]

function world(rows = [contract('p', 'a', 30), contract('q', 'b', 50)]) {
  const state = { contracts: structuredClone(rows), ledgers: [] as Array<Record<string, unknown>>,
    rosters: ['a', 'b', 'c'].map(id => ({ id, leagueId: 'L', faabRemaining: 100,
      playerData: { players: rows.filter(c => c.rosterId === id && c.status !== 'cut').map(c => c.playerId) } })) }
  const db = {
    playerContract: {
      findMany: vi.fn(async () => structuredClone(state.contracts)),
      updateMany: vi.fn(async ({ where, data }) => {
        const found = state.contracts.find(c => c.id === where.id && c.rosterId === where.rosterId)
        if (!found) return { count: 0 }
        Object.assign(found, data)
        return { count: 1 }
      }),
    },
    salaryCapTeamLedger: {
      findMany: vi.fn(async () => [] as Array<{ leagueId: string; rosterId: string; capYear: number; rolloverUsed: number }>),
      upsert: vi.fn(async ({ create }) => { state.ledgers.push(create); return create }),
    },
    roster: {
      findMany: vi.fn(async ({ where }) => structuredClone(state.rosters.filter(r => where.id.in.includes(r.id)))),
      findUnique: vi.fn(async ({ where }) => structuredClone(state.rosters.find(r => r.id === where.id) ?? null)),
      update: vi.fn(async ({ where, data }) => { Object.assign(state.rosters.find(r => r.id === where.id)!, data) }),
    },
    afLeagueTrade: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    tradeExecutionSnapshot: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    tradeReversal: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'rev' })) },
    // Rollback harness verifies that errors propagate out of the shared transaction, with no partial state.
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _options?: { isolationLevel: string; timeout: number }) => {
      const before = structuredClone(state)
      try { return await fn(db) } catch (error) { Object.assign(state, before); throw error }
    }),
  }
  Object.assign(mocks.db, db)
  return { db, state }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.config.mockResolvedValue(rules)
  mocks.emit.mockResolvedValue({ eventId: 'event' })
})

describe('native salary contract settlement', () => {
  it('moves stored salaries with players, preserves terms and records before/after evidence', async () => {
    const { db, state } = world()
    const evidence = await applyTradeAssetsInTransaction(db as never, {
      leagueId: 'L', proposerRosterId: 'a', receiverRosterId: 'b', assets: [
        { itemType: 'player', itemReference: 'p', fromRosterId: 'a', toRosterId: 'b', metadata: { salary: 1 } },
      ],
    })
    expect(state.contracts[0]).toEqual(contract('p', 'b', 30))
    expect(state.rosters[0].playerData.players).toEqual([])
    expect(state.rosters[1].playerData.players).toEqual(['q', 'p'])
    expect(evidence?.before[0].rosterId).toBe('a')
    expect(evidence?.after[0].rosterId).toBe('b')
    expect(state.ledgers.find(l => l.rosterId === 'b' && l.capYear === 2027)).toMatchObject({ totalCapHit: 80, capSpace: 20 })
    expect(mocks.config).toHaveBeenCalledWith('L', db)
  })

  it('checks a simultaneous three-team swap rather than temporary pairwise balances', async () => {
    const { db, state } = world([contract('p', 'a', 80), contract('q', 'b', 80), contract('r', 'c', 80)])
    await settleTradeContracts(db as never, 'L', ['a', 'b', 'c'], [
      ...moves, { playerId: 'q', fromRosterId: 'b', toRosterId: 'c' },
      { playerId: 'r', fromRosterId: 'c', toRosterId: 'a' },
    ])
    expect(state.contracts.map(c => c.rosterId)).toEqual(['b', 'c', 'a'])
    expect(state.ledgers).toHaveLength(6)
    expect(state.ledgers.every(l => l.totalCapHit === 80)).toBe(true)
    expect(db.salaryCapTeamLedger.findMany).toHaveBeenCalledTimes(1)
  })

  it('retains dead money on its original team and stops salary after expiry', async () => {
    const { db, state } = world([contract('p', 'a', 30, { yearsTotal: 1 }),
      contract('cut', 'a', 90, { status: 'cut', deadMoneyRemaining: { '2028': 15 } })])
    await settleTradeContracts(db as never, 'L', ['a', 'b'], moves)
    expect(state.contracts[1].rosterId).toBe('a')
    expect(state.ledgers.find(l => l.rosterId === 'a' && l.capYear === 2028)).toMatchObject({ deadMoneyHit: 15, totalCapHit: 0 })
    expect(state.ledgers.find(l => l.rosterId === 'b' && l.capYear === 2027)).toMatchObject({ totalCapHit: 0 })
  })

  it('rejects future cap excess before any contract or ledger is written', async () => {
    const { db } = world([contract('p', 'a', 30), contract('q', 'b', 80, { yearSigned: 2027 })])
    await expect(settleTradeContracts(db as never, 'L', ['a', 'b'], moves)).rejects.toThrow('2027')
    expect(db.playerContract.updateMany).not.toHaveBeenCalled()
    expect(db.salaryCapTeamLedger.upsert).not.toHaveBeenCalled()
  })

  it('enforces configured cap floors', async () => {
    mocks.config.mockResolvedValue({ ...rules, capFloorEnabled: true, capFloorAmount: 20 })
    const { db } = world()
    await expect(settleTradeContracts(db as never, 'L', ['a', 'b'], moves)).rejects.toThrow('cap floor')
    expect(db.playerContract.updateMany).not.toHaveBeenCalled()
  })

  it('preserves recorded rollover in refreshed ledgers', async () => {
    const { db, state } = world([contract('p', 'a', 30), contract('q', 'b', 80)])
    db.salaryCapTeamLedger.findMany.mockResolvedValue(['a', 'b'].flatMap(rosterId => [2026, 2027]
      .map(capYear => ({ leagueId: 'L', rosterId, capYear, rolloverUsed: 20 }))))
    await settleTradeContracts(db as never, 'L', ['a', 'b'], moves)
    expect(state.ledgers.find(l => l.rosterId === 'b')).toMatchObject({ rolloverUsed: 20, capSpace: 10 })
  })

  it('refuses an inconsistent ledger instead of reusing another league’s rollover', async () => {
    const { db } = world()
    db.salaryCapTeamLedger.findMany.mockResolvedValue([{ leagueId: 'other', rosterId: 'b', capYear: 2026, rolloverUsed: 50 }])
    await expect(settleTradeContracts(db as never, 'L', ['a', 'b'], moves)).rejects.toThrow('ledger league mismatch')
    expect(db.playerContract.updateMany).not.toHaveBeenCalled()
    expect(db.salaryCapTeamLedger.upsert).not.toHaveBeenCalled()
  })

  it.each(['missing', 'expired', 'wrong owner', 'duplicate elsewhere', 'repeated player'])('rejects %s contracts', async kind => {
    let rows = [contract('p', 'a', 30)]
    if (kind === 'missing') rows = []
    if (kind === 'expired') rows[0].yearSigned = 2023
    if (kind === 'wrong owner') rows[0].rosterId = 'b'
    if (kind === 'duplicate elsewhere') rows.push(contract('other', 'outside', 10, { playerId: 'p' }))
    const { db } = world(rows)
    await expect(settleTradeContracts(db as never, 'L', ['a', 'b'], kind === 'repeated player' ? [...moves, ...moves] : moves)).rejects.toThrow()
    expect(db.playerContract.updateMany).not.toHaveBeenCalled()
  })

  it.each([{ '2027': -10 }, { '2027': '10' }, { unknown: 10 }])('rejects invalid stored dead money %j', async deadMoneyRemaining => {
    const { db } = world([contract('p', 'a', 30), contract('cut', 'b', 5, { status: 'cut', deadMoneyRemaining })])
    await expect(settleTradeContracts(db as never, 'L', ['a', 'b'], moves)).rejects.toThrow('dead money')
    expect(db.salaryCapTeamLedger.upsert).not.toHaveBeenCalled()
  })

  it('rolls back ledgers if a contract changed after validation', async () => {
    const { db, state } = world()
    const original = structuredClone(state)
    db.playerContract.updateMany.mockResolvedValue({ count: 0 })
    await expect(db.$transaction(tx => settleTradeContracts(tx as never, 'L', ['a', 'b'], moves))).rejects.toThrow('changed')
    expect(state).toEqual(original)
  })

  it('rolls back contract and cap writes when the roster write fails', async () => {
    const { db, state } = world()
    const original = structuredClone(state)
    db.roster.update.mockRejectedValue(new Error('roster write failed'))
    await expect(db.$transaction(tx => applyTradeAssetsInTransaction(tx as never, {
      leagueId: 'L', proposerRosterId: 'a', receiverRosterId: 'b', assets: [
        { itemType: 'player', itemReference: 'p', fromRosterId: 'a', toRosterId: 'b' },
      ],
    }))).rejects.toThrow('roster write failed')
    expect(state).toEqual(original)
  })

  it('leaves ordinary leagues outside salary settlement', async () => {
    mocks.config.mockResolvedValue(null)
    const { db } = world()
    expect(await settleTradeContracts(db as never, 'L', ['a', 'b'], moves)).toBeUndefined()
    expect(db.playerContract.findMany).not.toHaveBeenCalled()
  })

  it('refuses unpersisted salary rules', async () => {
    mocks.config.mockResolvedValue({ ...rules, configId: '' })
    const { db } = world()
    await expect(settleTradeContracts(db as never, 'L', ['a', 'b'], moves)).rejects.toThrow('Persist')
  })
})

describe('salary contract reversal', () => {
  async function executed() {
    const { db, state } = world()
    const beforeRosters = structuredClone(state.rosters.slice(0, 2))
    const evidence = await applyTradeAssetsInTransaction(db as never, {
      leagueId: 'L', proposerRosterId: 'a', receiverRosterId: 'b', assets: [
        { itemType: 'player', itemReference: 'p', fromRosterId: 'a', toRosterId: 'b' },
      ],
    })
    const rosters = (rows: typeof state.rosters) => rows.map(r => ({ ...r, rosterId: r.id, platformUserId: r.id }))
    const snapshot = { id: 'snap', tradeSource: 'af_league_generic',
      beforeState: { rosters: rosters(beforeRosters), salaryContracts: evidence!.before },
      afterState: { rosters: rosters(structuredClone(state.rosters.slice(0, 2))), salaryContracts: evidence!.after } }
    const trade = { id: 'trade', leagueId: 'L', status: 'processed', items: [] }
    db.afLeagueTrade.findUnique.mockResolvedValue(trade)
    db.afLeagueTrade.findUniqueOrThrow.mockResolvedValue(trade)
    db.tradeExecutionSnapshot.findUnique.mockResolvedValue(snapshot)
    db.tradeExecutionSnapshot.findUniqueOrThrow.mockResolvedValue(snapshot)
    return { db, state, snapshot }
  }

  it('restores contracts with players and refreshes both teams cap ledgers', async () => {
    const { db, state } = await executed()
    expect((await reverseGenericTrade({ tradeId: 'trade', actorUserId: 'commissioner', actorRole: 'commissioner', reason: 'review' })).ok).toBe(true)
    expect(state.contracts[0].rosterId).toBe('a')
    expect(state.rosters[0].playerData.players).toEqual(['p'])
    expect(state.ledgers.at(-1)).toMatchObject({ rosterId: 'b', totalCapHit: 50 })
    expect(db.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable', timeout: 20_000 })
  })

  it('refuses a later extension despite unchanged roster membership', async () => {
    const { db, state } = await executed()
    state.contracts[0].salary = 35
    const result = await evaluateGenericTradeReversalReadiness(db as never, 'trade')
    expect(result.blockers).toContain('CONTRACT_CHANGED_SINCE_EXECUTION')
  })

  it('refuses legacy salary snapshots without contract evidence', async () => {
    const { db, snapshot } = await executed()
    db.tradeExecutionSnapshot.findUnique.mockResolvedValue({ ...snapshot, afterState: { rosters: snapshot.afterState.rosters } })
    expect((await evaluateGenericTradeReversalReadiness(db as never, 'trade')).blockers).toContain('CONTRACT_SNAPSHOT_MISSING')
  })

  it('refuses restoration under changed cap rules without partially restoring assets', async () => {
    const { state } = await executed()
    const original = structuredClone(state)
    mocks.config.mockResolvedValue({ ...rules, startupCap: 20 })
    const result = await reverseGenericTrade({ tradeId: 'trade', actorUserId: 'commissioner', actorRole: 'commissioner', reason: 'review' })
    expect(result).toMatchObject({ ok: false, readiness: { blockers: ['CONTRACT_RESTORATION_ILLEGAL'] } })
    expect(state).toEqual(original)
  })
})
