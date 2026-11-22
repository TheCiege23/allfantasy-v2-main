import { describe, expect, it, vi } from 'vitest'

/**
 * Trade learning, step 1b (owner's call, 2026-11-22): trades the live sync never saw get their context rebuilt from
 * stored weekly rows — rosters from the week before, records from the weeks before — flagged as rebuilt, never
 * overwriting a live capture, and marked when they cannot be rebuilt so the run moves on to older trades.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const {
  sidesOf, buildRebuiltTradeContext, backfillTradeContexts, rosterWeekFor, week1RowsAfterTrade, tradePlayerIds,
  TRADE_CONTEXT_BACKFILL_MIN_AGE_MS, TRADE_CONTEXT_BACKFILL_MIN_RUNWAY_MS,
} =
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
    expect(reason({}, rosterRows.filter((r) => r.rosterId !== '7'))).toBe('no_roster_rows')
    // An offseason trade with no week-1 rows for a team has nothing to rebuild from.
    expect(reason({ week: 0 }, rosterRows.filter((r) => r.rosterId !== '7'))).toBe('no_roster_rows')
  })
})

describe('an offseason trade', () => {
  // In the offseason A (roster 3) sent qb1 to B (roster 7) for wr5. Week 1's rows show the rosters AFTER it.
  const offseason = {
    ...candidate, week: 0, tradeAt: new Date('2026-05-01T18:00:00Z'),
    rows: [
      { managerId: 'mgr-a', partnerRosterId: 7, playersGiven: ['qb1'], playersReceived: ['wr5'] },
      { managerId: 'mgr-b', partnerRosterId: 3, playersGiven: ['wr5'], playersReceived: ['qb1'] },
    ],
  }
  const week1After = [
    { playerId: 'wr5', rosterId: '3', isStarter: true },
    { playerId: 'te9', rosterId: '3', isStarter: false },
    { playerId: 'qb1', rosterId: '7', isStarter: true },
    { playerId: 'rb4', rosterId: '7', isStarter: true },
  ]
  const build = (rows: typeof week1After, c = offseason) =>
    buildRebuiltTradeContext({ candidate: c, rosterRows: rows, resultRows, league, positions, now: NOW })
  const roster = (ctx: ReturnType<typeof build>, rid: string) => {
    if ('unavailable' in ctx) throw new Error(`expected a rebuild, got ${ctx.unavailable}`)
    return ctx.sides.find((s) => s.rosterId === rid)!.rosterBefore.map((p) => [p.id, p.starter])
  }

  it('reads week 1 and undoes the trade: what a side got comes off, what it gave goes back, lineup unknown for it', () => {
    expect(rosterWeekFor(0)).toBe(1)
    expect(rosterWeekFor(1)).toBe(1)
    expect(rosterWeekFor(9)).toBe(8)
    const ctx = build(week1After)
    if ('unavailable' in ctx) throw new Error('expected a rebuild')
    expect(ctx.rosterBasis).toEqual({ kind: 'week1_unwound', week: 1 })
    expect(roster(ctx, '3')).toEqual([['qb1', null], ['te9', false]])
    expect(roster(ctx, '7')).toEqual([['rb4', true], ['wr5', null]])
    // The record before an offseason trade is 0-0: none of the season's games had been played.
    expect(ctx.sides[0]!.record).toMatchObject({ wins: 0, losses: 0, pointsFor: 0 })
  })

  it('a week-1 trade whose rows already predate it is read as it is, not undone twice', () => {
    const week1Before = [
      { playerId: 'qb1', rosterId: '3', isStarter: true },
      { playerId: 'wr5', rosterId: '7', isStarter: true },
    ]
    const ctx = build(week1Before, { ...offseason, week: 1 })
    if ('unavailable' in ctx) throw new Error('expected a rebuild')
    expect(ctx.rosterBasis).toEqual({ kind: 'weekly_rows', week: 1 })
    expect(roster(ctx, '3')).toEqual([['qb1', true]])
    expect(roster(ctx, '7')).toEqual([['wr5', true]])
  })

  it('evidence is counted, not assumed: no players on either roster reads as after the trade', () => {
    const sides = [{ rosterId: '3' }, { rosterId: '7' }]
    const by = (rows: typeof week1After) => {
      const m = new Map<string, typeof week1After>()
      for (const r of rows) m.set(r.rosterId, [...(m.get(r.rosterId) ?? []), r])
      return m
    }
    expect(week1RowsAfterTrade(offseason.rows, sides, by(week1After))).toBe(true)
    expect(week1RowsAfterTrade(offseason.rows, sides, by([{ playerId: 'qb1', rosterId: '3', isStarter: true }]))).toBe(false)
    expect(week1RowsAfterTrade(offseason.rows, sides, by([{ playerId: 'zz', rosterId: '3', isStarter: true }]))).toBe(true)
  })

  it('stored player columns become ids, whether plain ids or objects carrying one', () => {
    expect(tradePlayerIds(['4046', 17, ' '])).toEqual(['4046', '17'])
    expect(tradePlayerIds([{ id: 'a' }, { playerId: 'b' }, { sleeperId: 9 }, { name: 'no id' }, null])).toEqual(['a', 'b', '9'])
    expect(tradePlayerIds('not a list')).toEqual([])
  })

  it('a run reads week 1 for it and looks up the position of a player it puts back', async () => {
    // B has since dropped qb1, so no week-1 row names him — only the unwind puts him back, and his position is still looked up.
    const loadRosterRows = vi.fn(async () => week1After.filter((r) => r.playerId !== 'qb1'))
    const loadPositions = vi.fn(async () => positions)
    const r = await backfillTradeContexts({
      listCandidates: vi.fn(async () => [offseason]), loadRosterRows, loadResultRows: vi.fn(async () => []),
      loadLeague: vi.fn(async () => league), loadPositions, save: vi.fn(async () => 2), remainingMs: () => 200_000, now: () => NOW,
    }, {})
    expect(r).toMatchObject({ rebuilt: 1, errors: [] })
    expect(loadRosterRows).toHaveBeenCalledWith('sl-1', 2026, 1)
    expect(loadPositions.mock.calls[0]![1]).toEqual(expect.arrayContaining(['qb1', 'wr5', 'te9', 'rb4']))
    expect(loadPositions).toHaveBeenCalledTimes(1)
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
