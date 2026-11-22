import { describe, expect, it, vi } from 'vitest'

/**
 * Injury and bye capture (owner's call, 2026-11-22): a team whose tight end is out this week — injured, on reserve or on
 * a bye — trades like a team without one. Captured live, read only where the context can say who was out, and measured
 * as its own need level ("short this week") against normal-depth teams.
 */

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({ injuries: vi.fn(), leagueTrade: vi.fn(async () => ({ count: 2 })) }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsInjury: { findMany: m.injuries }, leagueTrade: { updateMany: m.leagueTrade } } }))
vi.mock('@/lib/dynasty-import/normalize-historical', () => ({ persistTradesForSeason: vi.fn(async () => 2) }))

const { withInjuryStatus } = await import('@/lib/trade-market/tradeContextSnapshot')
const { attachTradeContextSnapshots, loadInjuryLookup } = await import('@/lib/import-os/collector/persistLiveTrades')
const { availableNeedAt, computeNeedMarket } = await import('@/lib/trade-market/needMarketLearner')
const { byeLookupFrom, needObservationsFor } = await import('@/lib/trade-market/formatMarkets')

const NOW = new Date('2026-11-22T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

describe('capturing who was out', () => {
  const snapshot = {
    version: 1, source: 'live_sync', sides: [{ rosterId: '1', rosterBefore: [{ id: 'te1', position: 'TE', team: 'AAA' }, { id: 'te2', position: 'TE', team: 'BBB' }] }],
  } as never

  it('each roster player\'s designation; one the lookup cannot tell leaves the snapshot unmarked, never "healthy"', () => {
    const read = withInjuryStatus(snapshot, (p) => (p.id === 'te1' ? 'Out' : null)) as { injuriesRead: boolean; sides: Array<{ rosterBefore: Array<{ injuryStatus?: string | null }> }> }
    expect(read.injuriesRead).toBe(true)
    expect(read.sides[0]!.rosterBefore.map((p) => p.injuryStatus)).toEqual(['Out', null])
    const unsure = withInjuryStatus(snapshot, (p) => (p.id === 'te1' ? undefined : null)) as typeof read
    expect(unsure.injuriesRead).toBe(false)
    expect('injuryStatus' in unsure.sides[0]!.rosterBefore[0]!).toBe(false)
  })

  it('the lookup: matched by name, verified by team; a shared name is refused; no report is null', async () => {
    m.injuries.mockResolvedValue([
      { playerName: 'Tom Endzone', team: 'AAA', position: 'TE', status: 'Out', date: NOW, fetchedAt: NOW },
      { playerName: 'Sam Same', team: 'AAA', position: 'WR', status: 'Out', date: NOW, fetchedAt: NOW },
      { playerName: 'Sam Same', team: 'BBB', position: 'WR', status: 'Active', date: NOW, fetchedAt: NOW },
    ])
    const lookup = await loadInjuryLookup(NOW)
    expect(lookup({ id: 'x', name: 'Tom Endzone', team: 'AAA', position: 'TE' })).toBe('Out')
    expect(lookup({ id: 'y', name: 'Nobody Hurt', team: 'CCC', position: 'RB' })).toBeNull()
    expect(lookup({ id: 'z', name: 'Sam Same', team: null, position: 'WR' })).toBeUndefined()
    expect(lookup({ id: 'w', team: 'AAA', position: 'WR' })).toBeUndefined()
    // Only fresh NFL reports are read.
    expect(m.injuries.mock.calls[0]![0].where).toMatchObject({ sport: 'NFL' })
  })

  const trade = {
    source_transaction_id: 'tx', type: 'trade' as const, status: 'complete', created_at: hoursAgo(10), completed_at: hoursAgo(10),
    roster_ids: ['1', '2'], adds: { qb1: '2' }, drops: { qb1: '1' }, week: 9,
  }
  const normalized = (sport: string) => ({
    source: { source_provider: 'sleeper', source_league_id: 'sl-1' },
    league: { name: 'L', sport, season: 2026, isDynasty: true },
    rosters: [
      { source_team_id: '1', source_manager_id: 'a', player_ids: ['te1'], starter_ids: [] },
      { source_team_id: '2', source_manager_id: 'b', player_ids: ['qb1'], starter_ids: [] },
    ],
    transactions: [trade],
    player_map: { te1: { name: 'Tom Endzone', position: 'TE', team: 'AAA' }, qb1: { name: 'Quinn Arrow', position: 'QB', team: 'BBB' } },
  }) as never

  it('the live sync saves the designations with the snapshot (NFL only); a failed read saves it exactly as before', async () => {
    const db = { leagueTrade: { updateMany: vi.fn(async () => ({ count: 2 })) } }
    const injuries = vi.fn(async () => (p: { name?: string | null }) => (p.name === 'Tom Endzone' ? 'IR' : null))
    await attachTradeContextSnapshots({ platformLeagueId: 'sl-1', normalized: normalized('NFL'), trades: [trade as never] }, { db: db as never, now: NOW, env: {}, injuries })
    const saved = (db.leagueTrade.updateMany.mock.calls[0] as unknown as [{ data: { contextSnapshot: { injuriesRead: boolean; sides: Array<{ rosterId: string; rosterBefore: Array<{ id: string; injuryStatus?: string | null }> }> } } }])[0].data.contextSnapshot
    expect(saved.injuriesRead).toBe(true)
    expect(saved.sides.flatMap((s) => s.rosterBefore).find((p) => p.id === 'te1')!.injuryStatus).toBe('IR')

    const nba = vi.fn(async () => () => null)
    await attachTradeContextSnapshots({ platformLeagueId: 'sl-1', normalized: normalized('NBA'), trades: [trade as never] }, { db: db as never, now: NOW, env: {}, injuries: nba })
    expect(nba).not.toHaveBeenCalled()

    const failingDb = { leagueTrade: { updateMany: vi.fn(async () => ({ count: 2 })) } }
    await attachTradeContextSnapshots({ platformLeagueId: 'sl-1', normalized: normalized('NFL'), trades: [trade as never] }, { db: failingDb as never, now: NOW, env: {}, injuries: async () => { throw new Error('down') } })
    const plain = (failingDb.leagueTrade.updateMany.mock.calls[0] as unknown as [{ data: { contextSnapshot: Record<string, unknown> } }])[0].data.contextSnapshot
    expect(plain.injuriesRead).toBeUndefined()
  })
})

describe('byes', () => {
  // Week 9 of 2026: 13 games stored, and team ZZZ is not in any of them.
  const teams = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LV', 'LAC', 'LAR', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI']
  const rows = Array.from({ length: 13 }, (_, i) => ({ season: 2026, weekOrRound: 9, homeTeam: teams[2 * i]!, awayTeam: teams[2 * i + 1]! }))
  const byes = byeLookupFrom([...rows, { season: 2026, weekOrRound: 10, homeTeam: 'SEA', awayTeam: 'SF' }])

  it('no game in a full week is a bye; a team that plays is not; a thin week or an unknown team cannot say', () => {
    expect(byes('SEA', 2026, 9)).toBe(true)
    expect(byes('KC', 2026, 9)).toBe(false)
    expect(byes('SEA', 2026, 10)).toBeNull()
    expect(byes(null, 2026, 9)).toBeNull()
  })
})

describe('short this week', () => {
  const slots = { QB: 1, TE: 1, WR: 2 }
  const roster = [{ position: 'TE', out: true }, { position: 'TE', out: false }, { position: 'TE', out: true }]

  it('the depth is there but the players out leave no spare; an unknown verdict falls back to depth', () => {
    const isOut = (p: { out?: boolean | null }) => p.out ?? null
    expect(availableNeedAt(roster, slots, 'TE', isOut)).toBe('short_this_week')
    expect(availableNeedAt([{ position: 'TE', out: false }, { position: 'TE', out: false }], slots, 'TE', isOut)).toBe('normal')
    expect(availableNeedAt([{ position: 'TE', out: null }, { position: 'TE', out: false }], slots, 'TE', isOut)).toBe('normal')
    // Already short on depth stays short — "this week" is only for the depth that is not enough this week.
    expect(availableNeedAt([{ position: 'TE', out: true }], slots, 'TE', isOut)).toBe('short')
  })

  // Week 9: roster 3 (two TEs, one ruled out) takes on a TE from roster 7.
  const tradeRow = (source: string, injuriesRead: boolean, ownTe: Array<Record<string, unknown>>) => ({
    transactionId: 'tx', partnerRosterId: 7, season: 2026, week: 9,
    contextSnapshot: {
      source, injuriesRead, starterSlots: slots,
      sides: [
        { rosterId: '3', rosterBefore: ownTe },
        { rosterId: '7', rosterBefore: [{ position: 'QB', team: 'KC', injuryStatus: null }, { position: 'QB', team: 'KC', injuryStatus: null }] },
      ],
    },
    playersGiven: ['qbx'], playersReceived: ['tex'], picksGiven: [], picksReceived: [],
  })
  const chart = new Map([['qbx', 3000], ['tex', 3000]])
  const meta = new Map([['qbx', { position: 'QB' }], ['tex', { position: 'TE' }]])
  const read = (row: ReturnType<typeof tradeRow>, byes: Parameters<typeof needObservationsFor>[6] = null) => {
    const r = needObservationsFor(row as never, chart, meta, null, { faabBudget: 100 }, 1, byes)
    if (!Array.isArray(r)) throw new Error(r)
    return r.find((o) => o.position === 'TE')!.need
  }

  it('a live capture with injuries read: a ruled-out tight end, or one on a bye, makes the buyer short this week', () => {
    const injured = [{ position: 'TE', team: 'KC', injuryStatus: 'Out' }, { position: 'TE', team: 'KC', injuryStatus: null }]
    expect(read(tradeRow('live_sync', true, injured))).toBe('short_this_week')
    const onBye = [{ position: 'TE', team: 'SEA', injuryStatus: null }, { position: 'TE', team: 'KC', injuryStatus: null }]
    expect(read(tradeRow('live_sync', true, onBye), (team) => team === 'SEA')).toBe('short_this_week')
    expect(read(tradeRow('live_sync', true, onBye), () => false)).toBe('normal')
    // One ruled out, the other on a team the schedule cannot place: that week cannot be read, so depth decides.
    const halfKnown = [{ position: 'TE', team: 'KC', injuryStatus: 'Out' }, { position: 'TE', team: 'XYZ', injuryStatus: null }]
    expect(read(tradeRow('live_sync', true, halfKnown), (team) => (team === 'XYZ' ? null : false))).toBe('normal')
  })

  it('never claimed where the context cannot say: a rebuilt roster, or a capture that did not read injuries', () => {
    const injured = [{ position: 'TE', team: 'KC', injuryStatus: 'Out' }, { position: 'TE', team: 'KC', injuryStatus: null }]
    expect(read(tradeRow('backfill_rebuilt', true, injured))).toBe('normal')
    expect(read(tradeRow('live_sync', false, injured))).toBe('normal')
  })

  it('measured as its own level against normal-depth teams', () => {
    const obs = (need: 'normal' | 'short_this_week', ratio: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ transactionId: `${need}-${i}`, position: 'TE' as const, need, ratio: ratio * (1 + ((i % 5) - 2) / 100), weight: 1 }))
    const market = computeNeedMarket([...obs('normal', 1, 40), ...obs('short_this_week', 1.15, 40)], NOW)
    const p = market.premiums.find((x) => x.position === 'TE' && x.need === 'short_this_week')!
    expect(p.published).toBe(true)
    expect(p.premiumPct!).toBeGreaterThan(12)
    expect(market.premiums).toHaveLength(12)
  })
})
