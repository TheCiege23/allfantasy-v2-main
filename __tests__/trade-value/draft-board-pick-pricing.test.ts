/**
 * Startup and redraft live-draft picks, priced from THIS draft's remaining board (owner's call, 2026-11-26).
 *
 * 1. PURE (`draftBoardPickPricing.ts`): slot → board index (open picks only), the centred ±2 window shrunk at
 *    the ends, exhaustion / a made pick → withheld with a reason, drafted players off a chart-ranked board,
 *    and the order rule (an earlier pick is never worth less).
 * 2. THE ONE GRADER, end to end with the data layer stubbed (the `league-trade-grader.test.ts` harness): a
 *    board pick is priced on the league's own player values, in a REDRAFT league (whose pick policy refuses
 *    every other pick) and a dynasty startup; 1.04 and 1.09 price apart; no board → withheld.
 * 3. THE DRAFT-ROOM REVIEW on that real grader: a startup swap now grades; with no board it keeps the old
 *    `NOT_A_ROOKIE_DRAFT_REASON`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  prices: new Map<string, number>(),
  chart: [] as Array<{ player: { name: string; position: string; sleeperId?: string }; value: number }>,
  leagueType: 'redraft',
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
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

import {
  DRAFT_BOARD_UNAVAILABLE_REASON,
  draftBoardExhaustedReason,
  draftBoardIndexOf,
  draftBoardPickMadeReason,
  draftBoardPlayers,
  draftBoardWindow,
  priceDraftBoardPicks,
  type LiveDraftBoard,
} from '@/lib/trade-value-console/draftBoardPickPricing'
import { draftBoardFromPickRows, expectedBoardFromPool } from '@/lib/live-draft-engine/draftBoardProjection'
import { createLeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { REDRAFT_PICKS_REASON } from '@/lib/decision-os/trade/leagueAssetRules'
import { draftPickBoardAsset, isBoardPricedDraft, NOT_A_ROOKIE_DRAFT_REASON } from '@/lib/live-draft-engine/draftPickTradeGrade'
import { draftPickTradeGraderSource, reviewDraftPickSwap, type DraftPickSwapSession } from '@/lib/live-draft-engine/draftPickTradeCanonicalReview'

/** 24 players, P0 best; values fall 500 per player so every window mean is easy to read. */
const PLAYERS = Array.from({ length: 24 }, (_, i) => ({ name: `Player ${i}`, value: 12000 - 500 * i }))
const ALL_OPEN = Array.from({ length: 36 }, (_, i) => i + 1)
const board = (extra: Partial<LiveDraftBoard> = {}): LiveDraftBoard => ({
  openOveralls: ALL_OPEN,
  expected: PLAYERS.map((p) => ({ name: p.name, position: 'WR' })),
  drafted: { names: [], playerIds: [] },
  ...extra,
})
const meanOf = (from: number, to: number) => {
  const xs = PLAYERS.slice(from, to + 1).map((p) => p.value)
  return Math.round(xs.reduce((s, v) => s + v, 0) / xs.length)
}
const valueOf = async (players: Array<{ name: string }>) =>
  players.map((p) => ({ value: PLAYERS.find((x) => x.name === p.name)?.value ?? null, source: 'fantasycalc' }))

describe('draft board pricing (pure)', () => {
  it('a slot is its index among the OPEN picks; a made pick is not on the board', () => {
    // #3 and #5 already made (a keeper pre-filled at #5): #6 is the 4th open pick → index 3.
    const b = board({ openOveralls: [1, 2, 4, 6, 7] })
    expect(draftBoardIndexOf(b, 1)).toBe(0)
    expect(draftBoardIndexOf(b, 6)).toBe(3)
    expect(draftBoardIndexOf(b, 5)).toBeNull()
  })

  it('the window is centred ±2 and shrinks symmetrically at the ends; past the end is null', () => {
    expect(draftBoardWindow(24, 3)).toEqual([1, 2, 3, 4, 5])
    expect(draftBoardWindow(24, 0)).toEqual([0]) // the pick on the clock is its one player, not a top-3 mean
    expect(draftBoardWindow(24, 1)).toEqual([0, 1, 2])
    expect(draftBoardWindow(24, 23)).toEqual([23])
    expect(draftBoardWindow(24, 24)).toBeNull()
  })

  it('prices 1.04 and 1.09 from the players expected there, and they differ', async () => {
    const { quotes, order } = await priceDraftBoardPicks({ overalls: [4, 9], board: board(), fcPlayers: [], valueOf })
    expect(order).toBe('draft_room_adp')
    expect(quotes.get(4)).toMatchObject({ value: meanOf(1, 5), expected: ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'] })
    expect(quotes.get(9)).toMatchObject({ value: meanOf(6, 10) })
    expect(meanOf(1, 5)).toBeGreaterThan(meanOf(6, 10))
  })

  it('board exhaustion and a made pick are withheld with their reasons, never priced', async () => {
    const { quotes } = await priceDraftBoardPicks({ overalls: [30, 5], board: board({ openOveralls: [1, 2, 3, 4, ...Array.from({ length: 30 }, (_, i) => i + 6)] }), fcPlayers: [], valueOf })
    expect(quotes.get(30)).toEqual({ overall: 30, value: null, reason: draftBoardExhaustedReason(30) })
    expect(quotes.get(5)).toEqual({ overall: 5, value: null, reason: draftBoardPickMadeReason(5) })
  })

  it('drafted players leave a chart-ranked board; PICK rows are never on it', () => {
    const fc = [
      { player: { name: '2026 Pick 1.01', position: 'PICK' }, value: 99999 },
      { player: { name: 'Low', position: 'WR', sleeperId: '3' }, value: 100 },
      { player: { name: 'Top', position: 'RB', sleeperId: '1' }, value: 900 },
      { player: { name: 'Mid', position: 'WR', sleeperId: '2' }, value: 500 },
    ]
    const r = draftBoardPlayers(board({ expected: null, drafted: { names: [], playerIds: ['1'] } }), fc)
    expect(r.order).toBe('league_chart')
    expect(r.players.map((p) => p.name)).toEqual(['Mid', 'Low'])
    // An ADP board drops drafted names too.
    expect(draftBoardPlayers(board({ drafted: { names: ['player 0'], playerIds: [] } }), []).players[0]!.name).toBe('Player 1')
  })

  it('an earlier pick is never worth less than a later one, even when ADP order dips', async () => {
    // ADP says Player 20 goes 2nd: the 1.02 window would read lower than 1.04's. It is raised.
    const expected = [PLAYERS[0], PLAYERS[20], PLAYERS[21], PLAYERS[22], PLAYERS[1], PLAYERS[2], PLAYERS[3]].map((p) => ({ name: p!.name }))
    const { quotes } = await priceDraftBoardPicks({ overalls: [2, 5], board: board({ expected }), fcPlayers: [], valueOf })
    const v2 = quotes.get(2)!.value!
    const v5 = quotes.get(5)!.value!
    expect(v2).toBeGreaterThanOrEqual(v5)
    expect(v2).toBe(v5)
  })

  it('the loader’s pure halves: open overalls skip filled rows (cleared rows are open); the pool keeps the room’s ADP order', () => {
    const rows = draftBoardFromPickRows({
      rounds: 1,
      teamCount: 4,
      picks: [
        { overall: 1, playerName: 'A', position: 'WR', playerId: '9' },
        { overall: 3, playerName: '', position: 'EMPTY' },
        { overall: 4, playerName: '(Skipped)', position: 'SKIP' },
      ],
    })
    expect(rows.openOveralls).toEqual([2, 3])
    expect(rows.drafted).toEqual({ names: ['A'], playerIds: ['9'] })
    const byAdp = (a: { adp?: number | null }, b: { adp?: number | null }) => (a.adp ?? 999) - (b.adp ?? 999)
    expect(expectedBoardFromPool([{ name: 'Late', adp: 30 }, { name: 'Early', adp: 2 }, { name: '' }], byAdp).map((p) => p.name)).toEqual(['Early', 'Late'])
  })

  it('only startup/redraft full-pool drafts are board-priced', () => {
    expect(isBoardPricedDraft({ draftModeLabel: 'startup', playerPool: 'all' })).toBe(true)
    expect(isBoardPricedDraft({ draftModeLabel: null, playerPool: null })).toBe(true)
    expect(isBoardPricedDraft({ draftModeLabel: 'standard' })).toBe(true)
    expect(isBoardPricedDraft({ draftModeLabel: 'rookie', playerPool: 'rookies_only' })).toBe(false)
    expect(isBoardPricedDraft({ draftModeLabel: 'dispersal' })).toBe(false)
    expect(isBoardPricedDraft({ draftModeLabel: 'startup', playerPool: 'veterans_only' })).toBe(false)
    expect(isBoardPricedDraft({ draftModeLabel: 'startup', draftType: 'auction' })).toBe(false)
  })
})

const pick = (overall: number) => draftPickBoardAsset({ season: 2026, round: Math.ceil(overall / 12), overall, slot: ((overall - 1) % 12) + 1, teamCount: 12 })

beforeEach(() => {
  h.leagueType = 'redraft'
  h.prices = new Map(PLAYERS.map((p) => [p.name, p.value]))
  h.chart = PLAYERS.map((p, i) => ({ player: { name: p.name, position: 'WR', sleeperId: String(i + 100) }, value: p.value }))
})

const graded = <T extends { graded: boolean }>(v: T) => {
  if (!v.graded) throw new Error(`withheld: ${JSON.stringify(v)}`)
  return v as Extract<T, { graded: true }>
}

describe('the one grader prices a board pick', () => {
  it.each(['redraft', 'dynasty'])('%s: 1.09 for 1.04 grades on the players expected there, and says so', async (type) => {
    h.leagueType = type
    const grader = (await createLeagueTradeGrader({ leagueId: 'L1' }))!
    expect(grader.pricesDraftBoard).toBe(true)
    const view = graded(await grader.grade({ give: [pick(9)], get: [pick(4)], viewerSide: false, draftBoard: board() }))
    expect([view.giveValue, view.getValue]).toEqual([meanOf(6, 10), meanOf(1, 5)])
    expect(view.basis).toMatch(/priced from this draft's remaining board/)
    expect(view.basis).toMatch(/draft room's ADP/)
    expect(view.lines?.map((l) => l.name)).toEqual(['2026 Pick 1.09 (#9)', '2026 Pick 1.04 (#4)'])
  })

  it('with no ADP board it ranks the league chart, minus the players already drafted', async () => {
    const grader = (await createLeagueTradeGrader({ leagueId: 'L1' }))!
    const view = graded(await grader.grade({
      give: [pick(4)],
      get: [pick(2)],
      viewerSide: false,
      draftBoard: board({ expected: null, openOveralls: ALL_OPEN.slice(1), drafted: { names: ['Player 0'], playerIds: [] } }),
    }))
    // #1 took Player 0, so #2 is on the clock (index 0 → Player 1 alone) and #4 is index 2 → Players 1..5.
    expect([view.giveValue, view.getValue]).toEqual([meanOf(1, 5), PLAYERS[1]!.value])
    expect(view.basis).toMatch(/this league's chart ranks at that pick/)
  })

  it('withholds with the board’s reason: a made pick, the board running out, or no board at all', async () => {
    const grader = (await createLeagueTradeGrader({ leagueId: 'L1' }))!
    const made = await grader.grade({ give: [pick(1)], get: [pick(4)], viewerSide: false, draftBoard: board({ openOveralls: ALL_OPEN.slice(1) }) })
    expect(made).toMatchObject({ graded: false, reason: draftBoardPickMadeReason(1) })
    const out = await grader.grade({ give: [pick(30)], get: [pick(4)], viewerSide: false, draftBoard: board() })
    expect(out).toMatchObject({ graded: false, reason: draftBoardExhaustedReason(30) })
    const none = await grader.grade({ give: [pick(9)], get: [pick(4)], viewerSide: false })
    expect(none).toMatchObject({ graded: false, reason: DRAFT_BOARD_UNAVAILABLE_REASON })
  })

  it('🛑 unchanged: an ordinary pick in a redraft league is still refused by the pick policy', async () => {
    const grader = (await createLeagueTradeGrader({ leagueId: 'L1' }))!
    const v = await grader.grade({ give: [{ kind: 'pick', year: 2026, round: 1, tier: 'early' }], get: [pick(4)], viewerSide: false, draftBoard: board() })
    expect(v).toMatchObject({ graded: false, reason: REDRAFT_PICKS_REASON })
  })
})

const STARTUP: DraftPickSwapSession = {
  id: 's1',
  teamCount: 12,
  draftType: 'snake',
  thirdRoundReversal: false,
  draftModeLabel: 'startup',
  playerPool: 'all',
  startedAt: '2026-08-20T00:00:00.000Z',
}

describe('the draft-room review on the real grader', () => {
  it('a startup swap now grades, and 1.04 and 1.09 price differently', async () => {
    h.leagueType = 'dynasty'
    const loadBoard = vi.fn(async () => board())
    const src = draftPickTradeGraderSource({ leagueId: 'L1', loadBoard })
    const back = await reviewDraftPickSwap(src, STARTUP, { give: { round: 1, slot: 4 }, get: { round: 1, slot: 9 } })
    expect(back.tradeGrade).toMatchObject({ graded: true, giveValue: meanOf(1, 5), getValue: meanOf(6, 10) })
    expect(back.review.verdict).not.toBe('not_graded')
    expect(back.review.reasons).toContain(`League value: you send ${meanOf(1, 5).toLocaleString()} and get ${meanOf(6, 10).toLocaleString()}.`)
    // The other side of the same swap reads the mirror image.
    const up = await reviewDraftPickSwap(src, STARTUP, { give: { round: 1, slot: 9 }, get: { round: 1, slot: 4 } })
    expect(up.tradeGrade).toMatchObject({ graded: true, giveValue: meanOf(6, 10), getValue: meanOf(1, 5) })
    // One board read for the draft, keyed on its session.
    expect(loadBoard).toHaveBeenCalledTimes(1)
    expect(loadBoard).toHaveBeenCalledWith({ leagueId: 'L1', sessionId: 's1' })
  })

  it('🛑 no board → the old withheld reason, unchanged', async () => {
    const src = draftPickTradeGraderSource({ leagueId: 'L1', loadBoard: async () => null })
    const r = await reviewDraftPickSwap(src, STARTUP, { give: { round: 1, slot: 4 }, get: { round: 1, slot: 9 } })
    expect(r.tradeGrade).toEqual({ graded: false, reason: NOT_A_ROOKIE_DRAFT_REASON })
    expect(r.review.verdict).toBe('not_graded')
  })
})
