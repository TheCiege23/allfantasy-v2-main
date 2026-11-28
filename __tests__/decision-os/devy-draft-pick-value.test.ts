import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { TradeAssetInput, TradeConsolePlayerLine } from '@/lib/trade-value-console/types'

/**
 * DEVY-DRAFT PICKS ON THE PROSPECTS' SCALE (2026-11-28).
 *
 * A native `devy_pick` used to reach the grade as a plain rookie pick and price off the chart's NFL
 * rookie rows, beside prospects priced by `devyOptionValue`. Now a devy pick is the expected option value
 * of the prospect taken at its slot — the league's own undrafted pool, ranked by the same
 * `heldDevyOptionValue` call — and a later draft is discounted by FUTURE_DISCOUNT per year.
 */

const db = vi.hoisted(() => ({
  devyRights: { findMany: vi.fn() },
  devyPlayer: { findMany: vi.fn() },
}))
const pricing = vi.hoisted(() => ({
  resolveAssets: vi.fn(),
  resolveLeagueTradeChart: vi.fn(),
  applyChartTePremium: vi.fn((_c: unknown, p: unknown) => p),
}))
const loader = vi.hoisted(() => ({ loadLeagueForTrade: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/trade-value-console/leagueTradePricing', () => pricing)
vi.mock('@/lib/trade-value-console/league-loader', () => loader)
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: vi.fn(async () => ({ ok: false })) }))

import { createLeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { createLeagueAssetPolicy, loadAvailableDevyPool } from '@/lib/decision-os/trade/leagueAssetPolicy'
import {
  applyDevyPickPricing,
  devyDraftPickValue,
  devyPickBoard,
  heldDevyOptionValue,
  type HeldDevyPlayer,
} from '@/lib/decision-os/trade/leagueAssetRules'
import { FUTURE_DISCOUNT } from '@/lib/decision-os/trade/sportDynastyValue'
import { gradeInputsFromNativeItems } from '@/lib/decision-os/trade/tradeGradeInputs'
import { afItemAsset } from '@/lib/decision-os/trade/tradeRecord'
import { gradeInputsOf } from '@/lib/decision-os/trade/evaluateStoredTrade'

const SEASON = 2026
const POSITIONS = ['WR', 'RB', 'QB', 'TE'] as const

/** 30 undrafted prospects with distinct composites — a measured pool. */
const POOL: HeldDevyPlayer[] = Array.from({ length: 30 }, (_, i) => ({
  devyPlayerId: `p${i}`,
  name: `Prospect ${i}`,
  position: POSITIONS[i % 4]!,
  ppaSeasonTotal: null,
  recruitingComposite: Math.round((0.99 - i * 0.008) * 1000) / 1000,
  recruitingStars: 4,
  draftEligibleYear: 2027 + (i % 3),
}))
const BOARD = devyPickBoard(POOL, SEASON)

const pickLine = (name: string, v: number): TradeConsolePlayerLine =>
  ({ name, playerId: null, sport: 'NFL', position: 'PICK', team: '—', marketValue: v, pricedSource: 'pick', dataSource: 'fantasycalc' }) as unknown as TradeConsolePlayerLine
const pickAsset = (name: string, v: number): PricedAsset =>
  ({ name, type: 'pick', value: v, assetValue: { marketValue: v, impactValue: 0, vorpValue: 0, volatility: 0 }, source: 'fantasycalc' })
const playerLine = (name: string, v: number | null): TradeConsolePlayerLine =>
  ({ name, playerId: null, sport: 'NFL', position: 'WR', team: '—', marketValue: v ?? 0, pricedSource: v == null ? 'unknown' : 'fantasycalc', dataSource: 'x', ...(v == null ? { unpriced: true, unpricedReason: { code: 'no_value' } } : {}) }) as unknown as TradeConsolePlayerLine
const playerAsset = (name: string, v: number | null): PricedAsset =>
  ({ name, type: 'player', value: v ?? 0, assetValue: { marketValue: v ?? 0, impactValue: 0, vorpValue: 0, volatility: 0 }, position: 'WR', source: v == null ? 'unknown' : 'fantasycalc', ...(v == null ? { unpriced: true } : {}) })

const devy1st = (year = 2027, tier?: 'early' | 'mid' | 'late'): TradeAssetInput => ({ kind: 'pick', year, round: 1, pool: 'devy', ...(tier ? { tier } : {}) })

describe('the board is the league’s measured undrafted pool, best first', () => {
  it('holds only measured prospects, in descending option value', () => {
    expect(BOARD.length).toBeGreaterThanOrEqual(24)
    expect([...BOARD].sort((a, b) => b - a)).toEqual(BOARD)
    // An unmeasured prospect is left off, never ranked as zero.
    const withUnmeasured = devyPickBoard([...POOL, { ...POOL[0]!, devyPlayerId: 'x', recruitingComposite: null, recruitingStars: null }], SEASON)
    expect(withUnmeasured).toEqual(BOARD)
  })
})

describe('a devy pick and a prospect are valued on one scale', () => {
  it('the 1.01 is exactly the best available prospect’s option value — the same call the grade prices a prospect with', () => {
    const best = Math.max(...POOL.map((p) => heldDevyOptionValue(p, SEASON).value ?? 0))
    const q = devyDraftPickValue({ pick: { year: 2027, round: 1, overall: 1 }, board: BOARD, teams: 12, nextDraftYear: 2027 })
    expect(q.value).toBe(best)
  })

  it('pick N is the Nth-best available prospect', () => {
    for (const n of [1, 6, 12, 18]) {
      const q = devyDraftPickValue({ pick: { year: 2027, round: Math.ceil(n / 12), overall: n }, board: BOARD, teams: 12, nextDraftYear: 2027 })
      expect(q.value).toBe(Math.round(BOARD[n - 1]!))
    }
  })
})

describe('pick 1 is worth more than pick 12', () => {
  it('on the same board', () => {
    const one = devyDraftPickValue({ pick: { year: 2027, round: 1, overall: 1 }, board: BOARD, teams: 12, nextDraftYear: 2027 })
    const twelve = devyDraftPickValue({ pick: { year: 2027, round: 1, overall: 12 }, board: BOARD, teams: 12, nextDraftYear: 2027 })
    expect(one.value).not.toBeNull()
    expect(twelve.value).not.toBeNull()
    expect(one.value!).toBeGreaterThan(twelve.value!)
    // And an early first beats a late one when only the tier is known.
    const early = devyDraftPickValue({ pick: { year: 2027, round: 1, tier: 'early' }, board: BOARD, teams: 12, nextDraftYear: 2027 })
    const late = devyDraftPickValue({ pick: { year: 2027, round: 1, tier: 'late' }, board: BOARD, teams: 12, nextDraftYear: 2027 })
    expect(early.value!).toBeGreaterThan(late.value!)
  })
})

describe('a future-year pick is discounted', () => {
  it('by FUTURE_DISCOUNT per year after the next draft', () => {
    const now = devyDraftPickValue({ pick: { year: 2027, round: 1, overall: 3 }, board: BOARD, teams: 12, nextDraftYear: 2027 })
    const later = devyDraftPickValue({ pick: { year: 2028, round: 1, overall: 3 }, board: BOARD, teams: 12, nextDraftYear: 2027 })
    const twoOn = devyDraftPickValue({ pick: { year: 2029, round: 1, overall: 3 }, board: BOARD, teams: 12, nextDraftYear: 2027 })
    expect(later.value).toBe(Math.round(BOARD[2]! * FUTURE_DISCOUNT))
    expect(twoOn.value).toBe(Math.round(BOARD[2]! * FUTURE_DISCOUNT ** 2))
    expect(now.value!).toBeGreaterThan(later.value!)
  })
})

describe('refuses rather than mixing scales', () => {
  it('a slot past the measured pool is withheld, not priced at the bottom', () => {
    const q = devyDraftPickValue({ pick: { year: 2027, round: 5, overall: 60 }, board: BOARD, teams: 12, nextDraftYear: 2027 })
    expect(q.value).toBeNull()
    if (q.value == null) expect(q.reason).toMatch(/withheld rather than priced at the bottom/)
  })

  it('no league size, no slot', () => {
    expect(devyDraftPickValue({ pick: { year: 2027, round: 1 }, board: BOARD, teams: null, nextDraftYear: 2027 }).value).toBeNull()
  })
})

describe('an NFL rookie pick in the same deal is unaffected', () => {
  it('only the devy pick moves off the rookie chart', () => {
    const inputs: TradeAssetInput[] = [devy1st(), { kind: 'pick', year: 2027, round: 1 }, { kind: 'player', name: 'Tee Higgins' }]
    const lines = [pickLine('2027 Round 1', 2764), pickLine('2027 Round 1', 2764), playerLine('Tee Higgins', 3000)]
    const priced = [pickAsset('2027 Round 1', 2764), pickAsset('2027 Round 1', 2764), playerAsset('Tee Higgins', 3000)]
    const out = applyDevyPickPricing({ inputs, lines, priced, board: BOARD, teams: 12, nextDraftYear: 2027 })
    const mid = Math.round(BOARD[6]!) // mid-first slot in a 12-team round = overall 7
    expect(out.lines[0]!.marketValue).toBe(mid)
    expect(out.lines[0]!.dataSource).toBe('devy-pick')
    expect(out.priced[0]!.value).toBe(mid)
    expect(out.priced[0]!.source).toBe('devy-option')
    // The rookie pick and the player are byte-for-byte the inputs.
    expect(out.lines[1]).toBe(lines[1])
    expect(out.priced[1]).toBe(priced[1])
    expect(out.lines[2]).toBe(lines[2])
    expect(out.devyPicksPriced).toBe(1)
  })

  it('misaligned inputs withhold every pick rather than leave a devy pick on the rookie chart', () => {
    const out = applyDevyPickPricing({
      inputs: [devy1st(), { kind: 'player', name: 'Unnamed' }],
      lines: [pickLine('2027 Round 1', 2764)],
      priced: [pickAsset('2027 Round 1', 2764)],
      board: BOARD, teams: 12, nextDraftYear: 2027,
    })
    expect(out.lines[0]!.unpriced).toBe(true)
  })
})

describe('the native trade item carries the devy pool through to the grade', () => {
  it('devy_pick is marked; rookie_pick is not', () => {
    const g = gradeInputsFromNativeItems([
      { itemType: 'devy_pick', itemReference: null, metadata: { pickSeason: 2027, pickRound: 1 } },
      { itemType: 'rookie_pick', itemReference: null, metadata: { pickSeason: 2027, pickRound: 1 } },
    ] as never)
    expect(g.assets).toEqual([
      { kind: 'pick', year: 2027, round: 1, pool: 'devy' },
      { kind: 'pick', year: 2027, round: 1 },
    ])
  })

  it('a stored trade keeps it too, through to the grade input', () => {
    const raw = afItemAsset({ itemType: 'devy_pick', itemReference: null, faabAmount: null, metadata: { pickSeason: 2027, pickRound: 2 } })
    expect(raw).toMatchObject({ kind: 'pick', season: 2027, round: 2, pool: 'devy' })
    const rookie = afItemAsset({ itemType: 'rookie_pick', itemReference: null, faabAmount: null, metadata: { pickSeason: 2027, pickRound: 2 } })
    expect(rookie).not.toHaveProperty('pool')
    expect(gradeInputsOf([raw as never]).assets[0]).toMatchObject({ kind: 'pick', year: 2027, round: 2, pool: 'devy' })
  })
})

/* ── through the one grader ─────────────────────────────────────────────────────────────────── */

const dynasty = { type: 'devy', label: 'Devy', source: 'confirmed' as const, platform: null }
const league = (over: Record<string, unknown> = {}) => ({
  id: 'L1', platformLeagueId: null, platform: null, name: 'Test', sport: 'NFL', leagueSize: 12, isDynasty: true,
  leagueType: 'devy', scoring: 'ppr', settings: {}, waiverBudget: 100, taxiSlots: 0, leagueVariant: null,
  bestBallMode: false, starters: [], season: SEASON, status: 'in_season', ...over,
})
const chart = {
  marketCtx: { scoring: { settings: { rec: 1 } } }, chartIsDynasty: true, isSuperFlex: true, leagueSize: 12, pprNfl: 1,
  valuationGaps: [], proposalRules: null, nflCtx: {}, fcPlayers: [], waiverBudget: 100,
}
const poolRows = POOL.map((p) => ({ id: p.devyPlayerId, name: p.name, position: p.position, ppaSeasonTotal: p.ppaSeasonTotal, recruitingComposite: p.recruitingComposite, recruitingStars: p.recruitingStars, draftEligibleYear: p.draftEligibleYear }))

beforeEach(() => {
  vi.clearAllMocks()
  loader.loadLeagueForTrade.mockResolvedValue(league())
  pricing.resolveLeagueTradeChart.mockResolvedValue(chart)
  db.devyRights.findMany.mockResolvedValue([])
  db.devyPlayer.findMany.mockResolvedValue(poolRows)
  pricing.resolveAssets.mockImplementation(async (assets: TradeAssetInput[]) => ({
    lines: assets.map((a) => (a.kind === 'pick' ? pickLine(`${a.year} Round ${a.round}`, 2764) : playerLine((a as { name: string }).name, 3000))),
    priced: assets.map((a) => (a.kind === 'pick' ? pickAsset(`${a.year} Round ${a.round}`, 2764) : playerAsset((a as { name: string }).name, 3000))),
    unresolved: [],
  }))
})

describe('the grade prices a devy pick as the prospect it selects', () => {
  it('a 2027 devy 1st (mid) is the 7th-best available prospect, not the 2,764 rookie row', async () => {
    const grader = await createLeagueTradeGrader({ leagueId: 'L1' })
    const view = await grader!.grade({ give: [{ kind: 'player', name: 'Tee Higgins' }], get: [devy1st()], viewerSide: false })
    expect(view.graded).toBe(true)
    if (!view.graded) return
    const pick = view.lines.find((l) => l.side === 'get')!
    expect(pick.marketValue).toBe(Math.round(BOARD[6]!))
    expect(pick.marketValue).not.toBe(2764)
  })

  it('a rookie pick in a devy league still prices off the rookie chart', async () => {
    const grader = await createLeagueTradeGrader({ leagueId: 'L1' })
    const view = await grader!.grade({ give: [{ kind: 'player', name: 'Tee Higgins' }], get: [{ kind: 'pick', year: 2027, round: 1 }], viewerSide: false })
    expect(view.graded).toBe(true)
    if (!view.graded) return
    expect(view.lines.find((l) => l.side === 'get')!.marketValue).toBe(2764)
  })

  it('the pool is every undrafted skill prospect no team here holds', async () => {
    db.devyRights.findMany.mockResolvedValue([{ devyPlayerId: 'p0' }])
    await loadAvailableDevyPool('L1')
    expect(db.devyPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { graduatedToNFL: false, position: { in: ['QB', 'RB', 'WR', 'TE'] }, id: { notIn: ['p0'] } },
    }))
  })

  it('a C2C league keeps its own pick rules', async () => {
    const loadPool = vi.fn(async () => POOL)
    const policy = createLeagueAssetPolicy({ id: 'L1', sport: 'NFL', leagueType: { ...dynasty, type: 'c2c' }, season: SEASON, leagueSize: 12 }, { loadHeld: async () => [], loadPool })
    const lines = [pickLine('2027 Round 1', 2764)]
    const out = await policy.priceDevy({ inputs: [devy1st()], lines, priced: [pickAsset('2027 Round 1', 2764)] })
    expect(out.lines[0]).toBe(lines[0])
    expect(loadPool).not.toHaveBeenCalled()
  })
})
