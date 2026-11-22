import { describe, expect, it, vi } from 'vitest'

/**
 * Trade learning, step 1 (owner's call, 2026-11-22): every trade the live sync sees is saved with the situation around
 * it — league settings, both rosters just before, records, FAAB — because next week the rosters will have moved.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/dynasty-import/normalize-historical', () => ({ persistTradesForSeason: vi.fn(async () => 2) }))

const { buildTradeContextSnapshot, TRADE_CONTEXT_MAX_LAG_HOURS } = await import('@/lib/trade-market/tradeContextSnapshot')
const { attachTradeContextSnapshots, persistLiveTrades } = await import('@/lib/import-os/collector/persistLiveTrades')

const NOW = new Date('2026-11-22T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

// Team 1 traded Quinn Arrow (QB) for Wade Runner (WR) + Tom Endzone (TE) and a 2027 1st; a day later it claimed Kip Waive and dropped Bo Bench.
const trade = {
  source_transaction_id: 'tx-trade', type: 'trade' as const, status: 'complete', created_at: hoursAgo(30), completed_at: hoursAgo(30),
  roster_ids: ['1', '2'], adds: { qb1: '2', wr1: '1', te1: '1' }, drops: { qb1: '1', wr1: '2', te1: '2' },
  draft_picks: [{ season: '2027', round: 1, roster_id: '2', previous_owner_id: '2', owner_id: '1' }], week: 11,
}
const laterWaiver = {
  source_transaction_id: 'tx-waiver', type: 'waiver' as const, status: 'complete', created_at: hoursAgo(6), completed_at: hoursAgo(6),
  roster_ids: ['1'], adds: { kip: '1' }, drops: { bench: '1' }, week: 12,
}
const earlierWaiver = {
  source_transaction_id: 'tx-old', type: 'waiver' as const, status: 'complete', created_at: hoursAgo(90), completed_at: hoursAgo(90),
  roster_ids: ['1'], adds: { old: '1' }, drops: {}, week: 10,
}

const normalized = {
  source: { source_provider: 'sleeper', source_league_id: 'sl-1' },
  league: { name: 'Test League', sport: 'NFL', season: 2026, leagueSize: 12, rosterSize: 30, scoring: 'ppr', isDynasty: true, current_week: 12, trade_deadline_week: 13, faab_budget: 100, huge_unknown_blob: { a: 1 } },
  rosters: [
    {
      source_team_id: '1', source_manager_id: 'mgr-1', owner_name: 'Avery', team_name: 'Comets', avatar_url: null,
      wins: 7, losses: 4, ties: 0, points_for: 1400, faab_remaining: 40, waiver_priority: 3,
      // After both moves: has the trade's arrivals and the waiver claim, not the player traded or dropped.
      player_ids: ['wr1', 'te1', 'kip', 'old', 'qb2'], starter_ids: ['wr1', 'qb2'],
      starter_slot_by_id: { qb2: 'QB', wr1: 'SUPER_FLEX' }, taxi_ids: ['old'],
    },
    {
      source_team_id: '2', source_manager_id: 'mgr-2', owner_name: 'Blake', team_name: 'Rockets', avatar_url: null,
      wins: 3, losses: 8, ties: 0, points_for: 1100, faab_remaining: 75, waiver_priority: 9,
      player_ids: ['qb1', 'rb2'], starter_ids: ['qb1', 'rb2'], starter_slot_by_id: { qb1: 'QB', rb2: 'RB' },
    },
  ],
  standings: [{ source_team_id: '1', rank: 2, wins: 7, losses: 4, ties: 0, points_for: 1400 }],
  scoring: { scoring_format: 'ppr', rules: [{ stat_key: 'rec', points_value: 1 }, { stat_key: 'bonus_rec_te', points_value: 0.5, positions: ['TE'] }] },
  transactions: [laterWaiver, trade, earlierWaiver],
  player_map: {
    qb1: { name: 'Quinn Arrow', position: 'QB', team: 'AAA' }, qb2: { name: 'Max Pocket', position: 'QB', team: 'BBB' },
    wr1: { name: 'Wade Runner', position: 'WR', team: 'CCC' }, te1: { name: 'Tom Endzone', position: 'TE', team: 'DDD' },
    kip: { name: 'Kip Waive', position: 'RB', team: 'EEE' }, bench: { name: 'Bo Bench', position: 'WR', team: 'FFF' },
    old: { name: 'Ollie Taxi', position: 'RB', team: 'GGG' }, rb2: { name: 'Ray Ground', position: 'RB', team: 'HHH' },
  },
} as never

describe('the context of one trade', () => {
  const snap = buildTradeContextSnapshot(normalized, trade as never, NOW)!

  it('rebuilds each roster just before the trade: this trade and every later move undone, earlier moves kept', () => {
    const before = (rid: string) => snap.sides.find((s) => s.rosterId === rid)!.rosterBefore.map((p) => p.id)
    // Team 1 had Quinn Arrow and Bo Bench, not the arrivals or Kip Waive; the earlier claim (Ollie Taxi) stays.
    expect(before('1')).toEqual(['bench', 'old', 'qb1', 'qb2'])
    expect(before('2')).toEqual(['rb2', 'te1', 'wr1'])
    expect(snap.movesUndone).toBe(2)
  })

  it('keeps the facts a learner needs: positions, records, FAAB, lineup slots, scoring rules and the league settings', () => {
    const one = snap.sides.find((s) => s.rosterId === '1')!
    expect(one.rosterBefore.find((p) => p.id === 'qb1')).toMatchObject({ position: 'QB', team: 'AAA' })
    expect(one.rosterBefore.find((p) => p.id === 'old')).toMatchObject({ taxi: true })
    expect(one.record).toMatchObject({ wins: 7, losses: 4, rank: 2 })
    expect(one.faabRemaining).toBe(40)
    expect(snap.sides.find((s) => s.rosterId === '2')!.record.rank).toBeNull()
    expect(snap.starterSlots).toEqual({ QB: 1, SUPER_FLEX: 1 })
    expect(snap.scoring?.rules).toContainEqual({ stat: 'bonus_rec_te', points: 0.5, positions: ['TE'] })
    expect(snap.league).toMatchObject({ sport: 'NFL', isDynasty: true, leagueSize: 12, trade_deadline_week: 13, faab_budget: 100 })
    expect(snap.league).not.toHaveProperty('huge_unknown_blob')
    expect(snap).toMatchObject({ version: 1, source: 'live_sync', provider: 'sleeper', lagHours: 30, tradeAt: hoursAgo(30) })
  })

  it('no snapshot it cannot stand behind: seen too late, no time on the trade, or neither team in the sync', () => {
    const late = { ...trade, completed_at: hoursAgo(TRADE_CONTEXT_MAX_LAG_HOURS + 1), created_at: hoursAgo(TRADE_CONTEXT_MAX_LAG_HOURS + 1) }
    expect(buildTradeContextSnapshot(normalized, late as never, NOW)).toBeNull()
    expect(buildTradeContextSnapshot(normalized, { ...trade, completed_at: undefined, created_at: 'not a date' } as never, NOW)).toBeNull()
    expect(buildTradeContextSnapshot(normalized, { ...trade, roster_ids: ['8', '9'] } as never, NOW)).toBeNull()
  })
})

describe('saving it beside the trade', () => {
  const db = () => ({ leagueTrade: { updateMany: vi.fn(async () => ({ count: 2 })) } })

  it('writes only a row whose snapshot is still empty — the first capture, closest to the trade, is kept', async () => {
    const d = db()
    const saved = await attachTradeContextSnapshots({ platformLeagueId: 'sl-1', normalized, trades: [trade as never] }, { db: d as never, now: NOW, env: {} })
    expect(saved).toBe(2)
    const call = d.leagueTrade.updateMany.mock.calls[0]![0] as { where: Record<string, unknown>; data: { contextSnapshot: { sides: unknown[] } } }
    expect(call.where).toMatchObject({ transactionId: 'tx-trade', history: { sleeperLeagueId: 'sl-1' } })
    expect(call.where.contextSnapshot).toBeDefined()
    expect(call.data.contextSnapshot.sides).toHaveLength(2)
  })

  it('a trade with no honest snapshot writes nothing; TRADE_CONTEXT_SNAPSHOT=off writes nothing; a failed write costs only that row', async () => {
    const d = db()
    const stale = { ...trade, completed_at: hoursAgo(1000), created_at: hoursAgo(1000) }
    expect(await attachTradeContextSnapshots({ platformLeagueId: 'sl-1', normalized, trades: [stale as never] }, { db: d as never, now: NOW, env: {} })).toBe(0)
    expect(await attachTradeContextSnapshots({ platformLeagueId: 'sl-1', normalized, trades: [trade as never] }, { db: d as never, now: NOW, env: { TRADE_CONTEXT_SNAPSHOT: 'off' } })).toBe(0)
    expect(d.leagueTrade.updateMany).not.toHaveBeenCalled()
    const failing = { leagueTrade: { updateMany: vi.fn(async () => { throw new Error('column "contextSnapshot" does not exist') }) } }
    expect(await attachTradeContextSnapshots({ platformLeagueId: 'sl-1', normalized, trades: [trade as never] }, { db: failing as never, now: NOW, env: {} })).toBe(0)
  })

  it('the live sync still writes the trade when saving its context fails', async () => {
    // `prisma` is mocked empty, so the snapshot write throws — the trade rows are still reported written.
    const r = await persistLiveTrades({ platformLeagueId: 'sl-1', season: 2026, normalized })
    expect(r).toMatchObject({ tradesSeen: 1, rowsWritten: 2, contextsSaved: 0 })
  })
})
