import { describe, expect, it, vi } from 'vitest'

/**
 * Trade learning, step 1b (owner's call, 2026-11-22): trades the live sync never saw get their context rebuilt from
 * stored weekly rows — rosters from the week before, records from the weeks before — flagged as rebuilt, never
 * overwriting a live capture, and marked when they cannot be rebuilt so the run moves on to older trades.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const { sidesOf, buildRebuiltTradeContext, backfillTradeContexts, TRADE_CONTEXT_BACKFILL_MIN_AGE_MS, TRADE_CONTEXT_BACKFILL_MIN_RUNWAY_MS } =
  await import('@/lib/trade-market/tradeContextBackfill')

const NOW = new Date('2026-11-22T12:00:00Z')

// Manager A (roster 3) traded with manager B (roster 7) in week 9: A's row names roster 7 as its partner, B's names roster 3.
const candidate = {
  leagueId: 'sl-1', transactionId: 'tx-1', season: 2026, week: 9, tradeAt: new Date('2026-11-01T18:00:00Z'), platform: 'sleeper', sport: 'nfl',
  rows: [{ managerId: 'mgr-a', partnerRosterId: 7 }, { managerId: 'mgr-b', partnerRosterId: 3 }],
}
const rosterRows = [
  { playerId: 'qb1', rosterId: '3', isStarter: true },
  { playerId: 'te9', rosterId: '3', isStarter: false },
  { playerId: 'wr5', rosterId: '7', isStarter: true },
  { playerId: 'rb2', rosterId: '1', isStarter: true },
]
const resultRows = [
  { rosterId: '3', week: 7, win: 1, pointsFor: 120.5, pointsAgainst: 100 },
  { rosterId: '3', week: 8, win: 0, pointsFor: 90, pointsAgainst: 110.25 },
  { rosterId: '3', week: 9, win: 1, pointsFor: 140, pointsAgainst: 80 },
  { rosterId: '7', week: 8, win: 1, pointsFor: 101, pointsAgainst: 99 },
]
const league = { sport: 'NFL', season: 2026, leagueSize: 12, scoring: 'ppr', isDynasty: true, leagueVariant: null, leagueType: 'dynasty', settings: { roster_positions: ['QB', 'RB', 'WR', 'SUPER_FLEX', 'BN', 'BN'] } }
const positions = new Map([['qb1', { position: 'QB', team: 'AAA' }], ['te9', { position: 'TE', team: 'BBB' }], ['wr5', { position: 'WR', team: 'CCC' }]])

describe('pairing the two sides', () => {
  it('each row names its partner, so a team\'s roster comes from the other row', () => {
    expect(sidesOf(candidate.rows)).toEqual([{ rosterId: '3', managerId: 'mgr-a' }, { rosterId: '7', managerId: 'mgr-b' }])
    expect(sidesOf([candidate.rows[0]!])).toBeNull()
    expect(sidesOf([{ managerId: 'a', partnerRosterId: null }, { managerId: 'b', partnerRosterId: 3 }])).toBeNull()
  })
})

describe('rebuilding one trade', () => {
  const ctx = buildRebuiltTradeContext({ candidate, rosterRows, resultRows, league, positions, now: NOW })

  it('rosters from the week before, records from the weeks before, flagged as rebuilt', () => {
    if ('unavailable' in ctx) throw new Error('expected a rebuild')
    expect(ctx).toMatchObject({ source: 'backfill_rebuilt', rosterBasis: { kind: 'weekly_rows', week: 8 }, provider: 'sleeper', tradeAt: '2026-11-01T18:00:00.000Z' })
    const a = ctx.sides.find((s) => s.rosterId === '3')!
    expect(a.managerId).toBe('mgr-a')
    expect(a.rosterBefore.map((p) => [p.id, p.position, p.starter, p.taxi])).toEqual([['qb1', 'QB', true, null], ['te9', 'TE', false, null]])
    // Week 9's result is the trade's own week, so it is not "before".
    expect(a.record).toMatchObject({ wins: 1, losses: 1, ties: 0, pointsFor: 210.5, pointsAgainst: 210.25 })
    expect(ctx.sides.find((s) => s.rosterId === '7')!.rosterBefore.map((p) => p.id)).toEqual(['wr5'])
  })

  it('keeps the league\'s settings, including the lineup slots that show superflex', () => {
    if ('unavailable' in ctx) throw new Error('expected a rebuild')
    expect(ctx.league).toMatchObject({ sport: 'NFL', season: 2026, isDynasty: true, leagueSize: 12, roster_positions: ['QB', 'RB', 'WR', 'SUPER_FLEX', 'BN', 'BN'] })
    expect(ctx.starterSlots).toEqual({ QB: 1, RB: 1, WR: 1, SUPER_FLEX: 1 })
  })

  it('says why when it cannot: one side stored, no week before, or no roster rows for a team', () => {
    const reason = (over: Partial<typeof candidate>, rows = rosterRows) => {
      const r = buildRebuiltTradeContext({ candidate: { ...candidate, ...over }, rosterRows: rows, resultRows, league, positions, now: NOW })
      return 'unavailable' in r ? r.unavailable : 'rebuilt'
    }
    expect(reason({ rows: [candidate.rows[0]!] })).toBe('one_side_stored')
    expect(reason({ week: 1 })).toBe('no_trade_week')
    expect(reason({ week: 0 })).toBe('no_trade_week')
    expect(reason({}, rosterRows.filter((r) => r.rosterId !== '7'))).toBe('no_roster_rows')
  })
})

describe('a run', () => {
  const deps = (over: Record<string, unknown> = {}) => ({
    listCandidates: vi.fn(async () => [candidate, { ...candidate, transactionId: 'tx-2', rows: [candidate.rows[0]!] }]),
    loadRosterRows: vi.fn(async () => rosterRows),
    loadResultRows: vi.fn(async () => resultRows),
    loadLeague: vi.fn(async () => league),
    loadPositions: vi.fn(async () => positions),
    save: vi.fn(async () => 2),
    remainingMs: () => 200_000,
    now: () => NOW,
    ...over,
  })

  it('leaves the last day to the live sync, rebuilds what it can, marks what it cannot, and reads each league-season once', async () => {
    const d = deps()
    const r = await backfillTradeContexts(d, {})
    expect(d.listCandidates).toHaveBeenCalledWith(200, new Date(NOW.getTime() - TRADE_CONTEXT_BACKFILL_MIN_AGE_MS))
    expect(r).toMatchObject({ considered: 2, rebuilt: 1, unavailable: { one_side_stored: 1 }, rowsWritten: 4, errors: [] })
    expect(d.save).toHaveBeenCalledWith('sl-1', 'tx-2', expect.objectContaining({ unavailable: 'one_side_stored' }))
    expect(d.loadResultRows).toHaveBeenCalledTimes(1)
    expect(d.loadLeague).toHaveBeenCalledTimes(1)
    expect(d.loadRosterRows).toHaveBeenCalledTimes(1)
  })

  it('stops when the budget runs short, TRADE_CONTEXT_BACKFILL=off reads nothing, and one failure costs only that trade', async () => {
    const short = deps({ remainingMs: () => TRADE_CONTEXT_BACKFILL_MIN_RUNWAY_MS - 1 })
    expect(await backfillTradeContexts(short, {})).toMatchObject({ deferred: 2, rebuilt: 0 })
    expect(short.save).not.toHaveBeenCalled()

    const off = deps()
    expect(await backfillTradeContexts(off, { TRADE_CONTEXT_BACKFILL: 'off' })).toMatchObject({ off: true })
    expect(off.listCandidates).not.toHaveBeenCalled()

    const failing = deps({ save: vi.fn(async (_l: string, tx: string) => { if (tx === 'tx-1') throw new Error('boom'); return 1 }) })
    const r = await backfillTradeContexts(failing, {})
    expect(r.errors).toEqual(['sl-1/tx-1: boom'])
    expect(r.unavailable.one_side_stored).toBe(1)
  })
})
