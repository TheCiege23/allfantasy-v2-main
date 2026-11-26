/**
 * The three gaps the draft-board pricing left open (owner-approved, 2026-11-26):
 *   1. keepers on league rosters leave the board, and a keeper-locked slot is not an open pick;
 *   2. an ADP snapshot that runs out before a late pick continues on the league chart's rank, and only an
 *      exhausted chart withholds;
 *   3. the AllFantasy trade market and the lineup move a board pick THROUGH the players expected there
 *      (each by exactly the move his own player line takes — and an NFL grade prices players on the AF market
 *      book, where a line is already at what managers paid and is not moved, so neither is the board), and
 *      the learned PICK market never moves it —
 *      that market prices rookie slots ("2026 Pick 1.04"), not the players of a startup board, so applying
 *      it on top would count a second, unrelated market against the same value.
 *
 * Same data-layer stubs as `draft-board-pick-pricing.test.ts`, plus the market reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  prices: new Map<string, number>(),
  chart: [] as Array<{ player: { name: string; position: string; sleeperId?: string }; value: number }>,
  leagueType: 'redraft',
}))
const m = vi.hoisted(() => ({
  rows: new Map<string, { playerId: string; adjustmentPercent: number; sampleSize: number; generatedAt: Date }>(),
  lineupFactors: null as unknown,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/trade-market/afTradeMarketReads', async (orig) => {
  const real = await orig<typeof import('@/lib/trade-market/afTradeMarketReads')>()
  return {
    ...real,
    loadAfTradeMarketRows: async (_p: unknown, ids: readonly string[]) => new Map([...m.rows].filter(([k]) => ids.includes(k))),
    loadLineupFactors: async () => m.lineupFactors,
  }
})
vi.mock('@/lib/trade-value-console/afLeaguePlayerPrice', () => ({
  loadAfNflMarketQuote: async ({ name }: { name: string }) =>
    h.prices.has(name) ? { marketValue: h.prices.get(name), position: 'WR', generatedAt: new Date('2026-09-28T14:27:28.097Z') } : null,
}))
vi.mock('@/lib/trade-value-console/league-loader', () => ({
  loadLeagueForTrade: async () => ({
    id: 'L1',
    platformLeagueId: null,
    name: 'Board league',
    sport: 'NFL',
    leagueSize: 12,
    isDynasty: h.leagueType === 'dynasty',
    leagueType: h.leagueType,
    scoring: 'ppr',
    settings: { scoring_settings: { rec: 1 }, roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'] },
    waiverBudget: 100,
    taxiSlots: 0,
    leagueVariant: h.leagueType,
    bestBallMode: false,
    starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
  }),
}))
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: async () => ({ ok: false }) }))
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: async () => h.chart,
  getFantasyCalcChartDbFirst: async () => ({ players: h.chart, syncedAt: '2026-09-28T14:27:28.097Z' }),
}))
vi.mock('@/lib/league-values/leagueTradeValues', () => ({ loadLeagueTradeValues: async () => null }))
vi.mock('@/lib/data/players', () => ({ getPlayer: async () => null, searchPlayers: async () => [] }))
vi.mock('@/lib/shared-services/player-identity/PlayerIdentityResolver', () => ({ resolvePlayer: async () => ({ confidence: 'none' }) }))
vi.mock('@/lib/trade-value/viewerNeedFactors', () => ({
  loadViewerNeedFactors: async (a: { give: unknown[]; get: unknown[] }) => ({ give: a.give.map(() => null), get: a.get.map(() => null), gap: null }),
  loadRosterNeedFactors: async (a: { give: unknown[]; get: unknown[] }) => ({ give: a.give.map(() => null), get: a.get.map(() => null), gap: null }),
}))
vi.mock('@/lib/hybrid-valuation', () => {
  const asset = (name: string, mv: number, extra: Record<string, unknown> = {}) => ({
    name,
    type: 'player',
    value: mv,
    assetValue: { marketValue: mv, impactValue: Math.round(mv * 0.5), vorpValue: 50, volatility: 0.1 },
    source: 'fantasycalc',
    position: 'WR',
    ...extra,
  })
  return {
    compositeScore: (v: { marketValue: number }) => v.marketValue,
    pricePlayer: async (name: string) => {
      const mv = h.prices.get(name)
      return mv == null ? { ...asset(name, 0), unpriced: true, source: 'unknown' } : asset(name, mv)
    },
    pricePick: async (p: { year: number; round: number }) => asset(`${p.year} Round ${p.round}`, 999, { type: 'pick', position: 'PICK', source: 'excel' }),
  }
})

import { draftBoardBasisNote, draftBoardPlayers, priceDraftBoardPicks, draftBoardExhaustedReason, type LiveDraftBoard } from '@/lib/trade-value-console/draftBoardPickPricing'
import { draftBoardFromPickRows, draftBoardKeepers } from '@/lib/live-draft-engine/draftBoardProjection'
import { boardPlayerMarketAdjustments, buildTradeMarketOverlay, moveBoardPlayerValues } from '@/lib/trade-value-console/tradeMarketOverlay'
import * as learnedInGrades from '@/lib/trade-market/learnedInGrades'
import { createLeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { draftPickBoardAsset } from '@/lib/live-draft-engine/draftPickTradeGrade'

const PLAYERS = Array.from({ length: 24 }, (_, i) => ({ name: `Player ${i}`, value: 12000 - 500 * i }))
const ALL_OPEN = Array.from({ length: 36 }, (_, i) => i + 1)
const board = (extra: Partial<LiveDraftBoard> = {}): LiveDraftBoard => ({
  openOveralls: ALL_OPEN,
  expected: PLAYERS.map((p) => ({ name: p.name, position: 'WR' })),
  drafted: { names: [], playerIds: [] },
  ...extra,
})
const meanOf = (vals: number[]) => Math.round(vals.reduce((s, x) => s + x, 0) / vals.length)
const v = (i: number) => PLAYERS[i]!.value
const valueOf = async (players: Array<{ name: string }>) =>
  players.map((p) => ({ value: PLAYERS.find((x) => x.name === p.name)?.value ?? null, source: 'fantasycalc' }))
const chartRows = () => PLAYERS.map((p, i) => ({ player: { name: p.name, position: 'WR', sleeperId: String(i + 100) }, value: p.value }))
const pick = (overall: number) =>
  draftPickBoardAsset({ season: 2026, round: Math.ceil(overall / 12), overall, slot: ((overall - 1) % 12) + 1, teamCount: 12 })
const graded = <T extends { graded: boolean }>(x: T) => {
  if (!x.graded) throw new Error(`withheld: ${JSON.stringify(x)}`)
  return x as Extract<T, { graded: true }>
}
const marketRow = (playerId: string, adjustmentPercent: number) => ({ playerId, adjustmentPercent, sampleSize: 40, generatedAt: new Date('2026-11-20') })

beforeEach(() => {
  h.leagueType = 'redraft'
  h.prices = new Map(PLAYERS.map((p) => [p.name, p.value]))
  h.chart = chartRows()
  m.rows = new Map()
  m.lineupFactors = null
  delete process.env.TRADE_MARKET_IN_GRADES
})

describe('1. keepers leave the board', () => {
  it('a keeper lock is a filled slot and his player is off the board, even before his round comes up', () => {
    const rows = draftBoardFromPickRows({
      rounds: 2,
      teamCount: 4,
      picks: [{ overall: 1, playerName: 'A', position: 'WR', playerId: '9' }],
      keepers: [{ overall: 6, playerName: 'Kept Guy', playerId: '77' }],
    })
    expect(rows.openOveralls).toEqual([2, 3, 4, 5, 7, 8])
    expect(rows.drafted).toEqual({ names: ['A', 'Kept Guy'], playerIds: ['9', '77'] })
  })

  it('reads keepers the way the draft room does: the session keeper selections, at their round-cost slot', () => {
    const slotOrder = ['r1', 'r2', 'r3', 'r4'].map((rosterId, i) => ({ slot: i + 1, rosterId, displayName: rosterId }))
    const keepers = draftBoardKeepers({
      keeperConfig: { maxKeepers: 2 },
      keeperSelections: [
        { rosterId: 'r2', roundCost: 2, playerName: 'Kept Guy', position: 'WR', team: null, playerId: '77' },
        // A round cost past the last round keeps no slot, but he is still on a roster.
        { rosterId: 'r1', roundCost: 9, playerName: 'Deep Keep', position: 'RB', team: null, playerId: null },
      ],
      slotOrder,
      tradedPicks: [],
      teamCount: 4,
      rounds: 2,
      draftType: 'snake',
      thirdRoundReversal: false,
    })
    // Snake round 2, slot 2 → 4 + (4 − 2 + 1) = overall 7.
    expect(keepers).toEqual([
      { overall: 7, playerName: 'Kept Guy', playerId: '77' },
      { overall: null, playerName: 'Deep Keep', playerId: null },
    ])
    const none = { keeperSelections: [], slotOrder, tradedPicks: [], teamCount: 4, rounds: 2, draftType: 'snake', thirdRoundReversal: false }
    expect(draftBoardKeepers({ ...none, keeperConfig: null })).toEqual([])
  })

  it('a chart-ranked board no longer prices a kept player into the picks before his slot', async () => {
    const rows = draftBoardFromPickRows({ rounds: 3, teamCount: 12, picks: [], keepers: [{ overall: 30, playerName: 'Player 0', playerId: '100' }] })
    const { quotes } = await priceDraftBoardPicks({ overalls: [1], board: { ...rows, expected: null }, fcPlayers: chartRows(), valueOf })
    expect(quotes.get(1)).toMatchObject({ value: v(1), expected: ['Player 1'] })
  })
})

describe('2. an exhausted ADP snapshot continues on the league chart', () => {
  const short = () => PLAYERS.slice(0, 5).map((p) => ({ name: p.name }))

  it('the board is the ADP list, then the chart rank of everyone not on it and not drafted', () => {
    const r = draftBoardPlayers(board({ expected: short(), drafted: { names: [], playerIds: ['110'] } }), chartRows())
    expect(r.order).toBe('draft_room_adp')
    expect(r.chartTailFrom).toBe(5)
    expect(r.players.map((p) => p.name).slice(0, 7)).toEqual(['Player 0', 'Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5', 'Player 6'])
    expect(r.players.map((p) => p.name)).not.toContain('Player 10') // drafted, by id
    expect(r.players).toHaveLength(23)
  })

  it('a late pick past the ADP list is priced from the chart tail; only an exhausted chart withholds', async () => {
    const late = await priceDraftBoardPicks({ overalls: [12], board: board({ expected: short() }), fcPlayers: chartRows(), valueOf })
    expect(late.quotes.get(12)).toMatchObject({ value: meanOf([v(9), v(10), v(11), v(12), v(13)]) })
    expect(late.chartTail).toBe(true)
    const none = await priceDraftBoardPicks({ overalls: [30], board: board({ expected: short() }), fcPlayers: chartRows(), valueOf })
    expect(none.quotes.get(30)).toEqual({ overall: 30, value: null, reason: draftBoardExhaustedReason(30) })
    // A pick inside the ADP list does not read the tail and does not claim to.
    expect((await priceDraftBoardPicks({ overalls: [1], board: board({ expected: short() }), fcPlayers: chartRows(), valueOf })).chartTail).toBe(false)
  })

  it('the grade carries the chart-tail sentence', async () => {
    const grader = (await createLeagueTradeGrader({ leagueId: 'L1' }))!
    const view = graded(await grader.grade({ give: [pick(12)], get: [pick(4)], viewerSide: false, draftBoard: board({ expected: short() }) }))
    expect(view.giveValue).toBe(meanOf([v(9), v(10), v(11), v(12), v(13)]))
    expect(view.basis).toMatch(/Past the end of the draft room's ADP list, the board continues in this league's chart rank/)
  })
})

describe('3. the trade market moves a board pick through its players; the learned pick market does not', () => {
  const book = { format: 'REDRAFT', qbFormat: 'ONE_QB' } as const

  it('a board player takes exactly the move his own player line would take', () => {
    const rows = new Map([['101', marketRow('101', 10)]])
    const adj = boardPlayerMarketAdjustments({ sleeperId: '101', position: 'WR', rows: rows as never, book, lineup: null, lineupFactors: null })
    expect(adj.market?.factor).toBeCloseTo(1.1)
    expect(adj.lineup).toBeNull()
    const line = { name: 'Player 1', position: 'WR', pricedSource: 'fantasycalc', playerId: '101', unpriced: false } as never
    const priced = { assetValue: { marketValue: v(1) } } as never
    const overlay = buildTradeMarketOverlay({ giveLines: [line], getLines: [], givePriced: [priced], getPriced: [], rows: rows as never, book })
    expect(overlay!.tradeMarket.give[0]).toEqual(adj.market)
    expect(boardPlayerMarketAdjustments({ sleeperId: null, position: 'WR', rows: rows as never, book, lineup: null, lineupFactors: null })).toEqual({
      market: null,
      lineup: null,
    })
  })

  it('a chart-priced board moves player by player, before the mean — the pick is the mean of moved values and the order rule still holds', async () => {
    const rows = new Map([['101', marketRow('101', 20)], ['103', marketRow('103', -10)], ['106', marketRow('106', 90)]])
    const base = PLAYERS.map((p, i) => ({ value: p.value, source: 'fantasycalc', sleeperId: String(i + 100), position: 'WR', chartPriced: true }))
    const { values, moved } = moveBoardPlayerValues(base, { rows: rows as never, book })
    expect(values[1]!.value).toBe(Math.round(v(1) * 1.2))
    expect(values[3]!.value).toBe(Math.round(v(3) * 0.9))
    expect(moved.filter(Boolean)).toHaveLength(3)
    // An AF-book player (not chart-priced) is not moved, as an `allfantasy` line is not.
    expect(moveBoardPlayerValues([{ ...base[1]!, chartPriced: false }], { rows: rows as never, book }).values[0]!.value).toBe(v(1))
    const byName = new Map(PLAYERS.map((p, i) => [p.name, values[i]!.value]))
    const { quotes } = await priceDraftBoardPicks({
      overalls: [4, 9],
      board: board(),
      fcPlayers: [],
      valueOf: async (ps) => ps.map((p) => ({ value: byName.get(p.name) ?? null, source: 'fantasycalc' })),
    })
    expect(quotes.get(4)!.value).toBe(meanOf([Math.round(v(1) * 1.2), v(2), Math.round(v(3) * 0.9), v(4), v(5)]))
    // Player 6 moved +90% lifts 1.09's window: the earlier pick is raised to it, never left below.
    expect(quotes.get(4)!.value).toBeGreaterThanOrEqual(quotes.get(9)!.value!)
  })

  it('the board sentence names the market move when players moved, and nothing when none did', () => {
    expect(draftBoardBasisNote('draft_room_adp', { marketMovedPlayers: 2 })).toMatch(
      /AllFantasy trade market and this lineup move the players expected there \(2 players\)/,
    )
    expect(draftBoardBasisNote('draft_room_adp')).not.toMatch(/trade market/)
  })

  it('a league priced on the AF market book is not moved — exactly as its player lines are not', async () => {
    m.rows = new Map([['101', marketRow('101', 20)]])
    const b = board({ expected: PLAYERS.map((p, i) => ({ name: p.name, position: 'WR', playerId: String(i + 100) })) })
    const view = graded(await (await createLeagueTradeGrader({ leagueId: 'L1' }))!.grade({ give: [pick(9)], get: [pick(4)], viewerSide: false, draftBoard: b }))
    expect(view.getValue).toBe(meanOf([v(1), v(2), v(3), v(4), v(5)]))
    // And a player line on that same grade is not moved either.
    const line = graded(await (await createLeagueTradeGrader({ leagueId: 'L1' }))!.grade({ give: [{ kind: 'player', name: 'Player 1', playerId: '101' }], get: [pick(4)], viewerSide: false, draftBoard: b }))
    expect(line.giveValue).toBe(v(1))
  })

  it('🛑 the learned pick market never moves a board pick (it prices rookie slots), but still moves a rookie-pick line', () => {
    const calls: string[] = []
    const spy = vi.spyOn(learnedInGrades, 'learnedPickAdjustment').mockImplementation((_t, _b, name) => {
      calls.push(String(name))
      return { kind: 'tradeMarket', factor: 1.5, reason: 'learned' }
    })
    try {
      const boardLine = { name: '2026 Pick 1.04 (#4)', position: 'PICK', pricedSource: 'pick', dataSource: 'draft_board', playerId: null, unpriced: false } as never
      const rookieLine = { name: '2026 Pick 1.04', position: 'PICK', pricedSource: 'pick', dataSource: 'excel', playerId: null, unpriced: false } as never
      const priced = { assetValue: { marketValue: 5000 } } as never
      const overlay = buildTradeMarketOverlay({
        giveLines: [boardLine],
        getLines: [rookieLine],
        givePriced: [priced],
        getPriced: [priced],
        rows: new Map(),
        book,
        learned: {} as never,
      })
      expect(overlay!.learnedPicks.give[0]).toBeNull()
      expect(overlay!.learnedPicks.get[0]).toMatchObject({ factor: 1.5 })
      expect(calls).toEqual(['2026 Pick 1.04'])
    } finally {
      spy.mockRestore()
    }
  })
})
