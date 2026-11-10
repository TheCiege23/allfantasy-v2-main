import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeagueTradeChart } from '@/lib/trade-value-console/leagueTradePricing'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { campusPointsToMarket } from '@/lib/decision-os/trade/footballCampusTradeValue'
import { createFootballTradeFormatGrader } from '@/lib/decision-os/trade/footballTradeFormatGrade'
import { gradeTrade, type TradeGradeLine } from '@/lib/decision-os/trade/tradeGrade'

const db = vi.hoisted(() => ({
  keeperEligibility: { findMany: vi.fn() },
  playerContract: { findMany: vi.fn() },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const assets: TradeAssetInput[] = [
  { kind: 'player', rosterPlayerId: 'a' },
  { kind: 'player', rosterPlayerId: 'b' },
]
const lines: TradeGradeLine[] = [
  { side: 'give', name: 'Alpha', marketValue: 500, leagueValue: 500 },
  { side: 'get', name: 'Beta', marketValue: 500, leagueValue: 500 },
]
const neutral = (priced = lines) => gradeTrade({
  giveValue: 500, getValue: 500, giveMarket: 500, getMarket: 500, unpriced: 0,
  giveCount: 1, getCount: 1, basis: 'Chart', scoringApplied: true, needApplied: false, needGap: null, lines: priced, moves: [],
})
const league = { id: 'league', platform: 'native', season: 2026 }
const chart = {
  leagueSize: 12,
  fcPlayers: [
    { player: { sleeperId: 'a', name: 'Alpha', position: 'WR' }, value: 500 },
    { player: { sleeperId: 'b', name: 'Beta', position: 'WR' }, value: 500 },
    ...Array.from({ length: 48 }, (_, i) => ({
      player: { sleeperId: 'anchor-' + i, name: 'Anchor ' + i, position: 'WR' }, value: 1000 - i * 20,
    })),
  ],
} as LeagueTradeChart

beforeEach(() => vi.resetAllMocks())

describe('Football format trade grades', () => {
  it('uses measured campus and pro boards to calibrate the campus premium', () => {
    const campus = Array.from({ length: 8 }, () => 10)
    const pro = Array.from({ length: 8 }, () => 1000)
    const rate = campusPointsToMarket(campus, pro)
    expect(rate).toBeGreaterThan(0)
    expect(rate).toBeLessThan(1000 / 120)
    expect(campusPointsToMarket(campus.slice(1), pro)).toBeNull()
  })

  it('adds a keeper option using the actual round cost on the same chart', async () => {
    db.keeperEligibility.findMany.mockResolvedValue([
      { playerId: 'a', isEligible: true, projectedCostRound: 1 },
      { playerId: 'b', isEligible: true, projectedCostRound: 4 },
    ])
    const grade = createFootballTradeFormatGrader({ ...league, type: 'keeper' })!
    expect(await grade(neutral(), chart, assets)).toMatchObject({ graded: true, giveValue: 500, getValue: 755 })
    expect(db.keeperEligibility.findMany).toHaveBeenCalledOnce()
    expect(await grade(neutral(), chart, assets, true)).toMatchObject({ graded: false, reason: expect.stringContaining('trade-date') })
  })

  it('subtracts active cap obligations using an auction-calibrated scale', async () => {
    db.playerContract.findMany.mockResolvedValue([
      { playerId: 'a', salary: 20, yearSigned: 2026, yearsTotal: 1, source: 'rookie' },
      { playerId: 'b', salary: 40, yearSigned: 2026, yearsTotal: 1, source: 'rookie' },
      ...Array.from({ length: 5 }, (_, i) => ({
        playerId: 'anchor-' + i, salary: 100 - 2 * i, yearSigned: 2026, yearsTotal: 1, source: 'startup_auction',
      })),
    ])
    const grade = createFootballTradeFormatGrader({ ...league, type: 'salary_cap' })!
    expect(await grade(neutral(), chart, assets)).toMatchObject({ graded: true, giveValue: 300, getValue: 100, giveMarket: 500, getMarket: 500 })
  })

  it('withholds a keeper or cap letter without measured league terms', async () => {
    db.keeperEligibility.findMany.mockResolvedValue([])
    db.playerContract.findMany.mockResolvedValue([])
    expect(await createFootballTradeFormatGrader({ ...league, type: 'keeper' })!(neutral(), chart, assets))
      .toMatchObject({ graded: false, reason: expect.stringContaining('keeper cost') })
    expect(await createFootballTradeFormatGrader({ ...league, type: 'salary_cap' })!(neutral(), chart, assets))
      .toMatchObject({ graded: false, reason: expect.stringContaining('startup auction') })
  })

  it('withholds a Campus-to-Canton grade when a college asset has only a pro option price', async () => {
    const grade = createFootballTradeFormatGrader({ ...league, type: 'c2c' }, async () => null)!
    const prospect = { ...lines[0]!, valueSource: 'devy_option' as const }
    expect(await grade(neutral([prospect, lines[1]!]), chart, assets))
      .toMatchObject({ graded: false, reason: expect.stringContaining('common value scale') })
    expect(await grade(neutral(), chart, assets)).toEqual(neutral())
  })

  it('combines the measured campus production premium with the pro option', async () => {
    const grade = createFootballTradeFormatGrader({ ...league, type: 'c2c' }, async () => ({ season: 2026, weeks: 5, separate: false, combinedPick: async () => null, price: () => 725 }))!
    const prospect = { ...lines[0]!, valueSource: 'devy_option' as const }
    expect(await grade(neutral([prospect, lines[1]!]), chart, assets)).toMatchObject({ graded: true, giveValue: 725, getValue: 500, basis: expect.stringContaining('5 weeks') })
  })
})
