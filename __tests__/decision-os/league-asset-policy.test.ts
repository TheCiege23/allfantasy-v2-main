import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PricedAsset } from '@/lib/hybrid-valuation'
import type { TradeAssetInput, TradeConsolePlayerLine } from '@/lib/trade-value-console/types'

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
import { createLeagueAssetPolicy, loadHeldDevyPlayers } from '@/lib/decision-os/trade/leagueAssetPolicy'
import { DEVY_BASIS_NOTE, REDRAFT_PICKS_REASON } from '@/lib/decision-os/trade/leagueAssetRules'

const dynasty = { type: 'dynasty', label: 'Dynasty', source: 'confirmed' as const, platform: null }

const league = (over: Record<string, unknown> = {}) => ({
  id: 'L1', platformLeagueId: null, platform: null, name: 'Test', sport: 'NFL', leagueSize: 12, isDynasty: true,
  leagueType: 'devy', scoring: 'ppr', settings: {}, waiverBudget: 100, taxiSlots: 0, leagueVariant: null,
  bestBallMode: false, starters: [], season: 2026, status: 'in_season', ...over,
})
const chart = {
  marketCtx: { scoring: { settings: { rec: 1 } } }, chartIsDynasty: true, isSuperFlex: true, leagueSize: 12, pprNfl: 1,
  valuationGaps: [], proposalRules: null, nflCtx: {}, fcPlayers: [], waiverBudget: 100,
}

const line = (name: string, v: number | null): TradeConsolePlayerLine =>
  ({ name, playerId: null, sport: 'NFL', position: 'WR', team: '—', marketValue: v ?? 0, pricedSource: v == null ? 'unknown' : 'fantasycalc', dataSource: 'x', ...(v == null ? { unpriced: true, unpricedReason: { code: 'no_value' } } : {}) }) as unknown as TradeConsolePlayerLine
const asset = (name: string, v: number | null): PricedAsset =>
  ({ name, type: 'player', value: v ?? 0, assetValue: { marketValue: v ?? 0, impactValue: 0, vorpValue: 0, volatility: 0 }, position: 'WR', source: v == null ? 'unknown' : 'fantasycalc', ...(v == null ? { unpriced: true } : {}) })
const side = (...rows: Array<[string, number | null]>) => ({ lines: rows.map(([n, v]) => line(n, v)), priced: rows.map(([n, v]) => asset(n, v)), unresolved: [] as string[] })

const p = (name: string): TradeAssetInput => ({ kind: 'player', name })

beforeEach(() => {
  vi.clearAllMocks()
  loader.loadLeagueForTrade.mockResolvedValue(league())
  pricing.resolveLeagueTradeChart.mockResolvedValue(chart)
  db.devyRights.findMany.mockResolvedValue([{ devyPlayerId: 'd1' }])
  db.devyPlayer.findMany.mockResolvedValue([
    { id: 'd1', name: 'Jeremiah Smith', position: 'WR', ppaSeasonTotal: 60, recruitingComposite: 0.9999, recruitingStars: 5, draftEligibleYear: 2027 },
  ])
})

describe('the one grader applies the league asset rules', () => {
  it('a devy prospect this league holds is priced, and the grade says how', async () => {
    pricing.resolveAssets.mockImplementation(async (assets: TradeAssetInput[]) =>
      (assets[0] as { name: string }).name === 'Jeremiah Smith' ? side(['Jeremiah Smith', null]) : side(['Tee Higgins', 3000]),
    )
    const grader = await createLeagueTradeGrader({ leagueId: 'L1' })
    const view = await grader!.grade({ give: [p('Tee Higgins')], get: [p('Jeremiah Smith')], viewerSide: false })
    expect(view.graded).toBe(true)
    if (!view.graded) return
    expect(view.getValue).toBeGreaterThan(0)
    expect(view.basis).toContain(DEVY_BASIS_NOTE)
  })

  it('without held rights the prospect stays unpriced and the deal is withheld, as before', async () => {
    db.devyRights.findMany.mockResolvedValue([])
    pricing.resolveAssets.mockImplementation(async (assets: TradeAssetInput[]) =>
      (assets[0] as { name: string }).name === 'Jeremiah Smith' ? side(['Jeremiah Smith', null]) : side(['Tee Higgins', 3000]),
    )
    const grader = await createLeagueTradeGrader({ leagueId: 'L1' })
    expect(await grader!.grade({ give: [p('Tee Higgins')], get: [p('Jeremiah Smith')], viewerSide: false })).toMatchObject({ graded: false })
  })

  it('a pick is refused before anything is priced — a used pick in dynasty, any pick in redraft', async () => {
    const grader = await createLeagueTradeGrader({ leagueId: 'L1' })
    expect(await grader!.grade({ give: [p('Tee Higgins')], get: [{ kind: 'pick', year: 2026, round: 1 }], viewerSide: false })).toMatchObject({
      graded: false,
      reason: expect.stringMatching(/2026 draft has already been held/),
    })
    loader.loadLeagueForTrade.mockResolvedValue(league({ leagueType: 'redraft', isDynasty: false }))
    const redraft = await createLeagueTradeGrader({ leagueId: 'L1' })
    expect(await redraft!.grade({ give: [p('Tee Higgins')], get: [{ kind: 'pick', year: 2027, round: 1 }], viewerSide: false })).toMatchObject({ graded: false, reason: REDRAFT_PICKS_REASON })
    expect(pricing.resolveAssets).not.toHaveBeenCalled()
  })
})

describe('createLeagueAssetPolicy', () => {
  const lines = [line('Jeremiah Smith', null)]
  const priced = [asset('Jeremiah Smith', null)]

  it('reads the league’s devy rights once, and only when the chart missed someone in an NFL league', async () => {
    const loadHeld = vi.fn(async () => [])
    const policy = createLeagueAssetPolicy({ id: 'L1', sport: 'NFL', leagueType: dynasty, season: 2026 }, { loadHeld })
    await policy.priceDevy({ inputs: [p('Tee Higgins')], lines: [line('Tee Higgins', 3000)], priced: [asset('Tee Higgins', 3000)] })
    expect(loadHeld).not.toHaveBeenCalled()
    await policy.priceDevy({ inputs: [p('Jeremiah Smith')], lines, priced })
    await policy.priceDevy({ inputs: [p('Jeremiah Smith')], lines, priced })
    expect(loadHeld).toHaveBeenCalledTimes(1)
    const nba = createLeagueAssetPolicy({ id: 'L1', sport: 'NBA', leagueType: dynasty, season: 2026 }, { loadHeld })
    await nba.priceDevy({ inputs: [p('Jeremiah Smith')], lines, priced })
    expect(loadHeld).toHaveBeenCalledTimes(1)
  })

  it('held means rights still held here, on a player still in college', async () => {
    await loadHeldDevyPlayers('L1')
    expect(db.devyRights.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L1', state: { notIn: ['PROMOTED_TO_PRO', 'RIGHTS_EXPIRED'] } } }))
    expect(db.devyPlayer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['d1'] }, graduatedToNFL: false } }))
  })
})
