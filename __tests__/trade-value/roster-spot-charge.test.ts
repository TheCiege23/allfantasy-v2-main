/**
 * The roster-spot charge (trade grade audit, 2026-10-09). An uneven deal costs roster spots: the side
 * receiving more players drops, the side receiving fewer gains room. Fitted on 447 real trades, the price
 * of one spot is the chart value of the league's LAST rostered player (rank teams × roster spots).
 */
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ board: [] as unknown[] }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerValueSnapshot: { findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => []),
    playerAnalyticsSnapshot: { findFirst: vi.fn(async () => null) },
    sportsDataCache: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    tradeAnalysisSnapshot: { findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({ count: 0 })) },
  },
}))
vi.mock('@/lib/trade-value-console/league-loader', () => ({
  loadLeagueForTrade: async ({ leagueId }: { leagueId: string }) => ({
    id: leagueId,
    platformLeagueId: null,
    name: 'Ten-team dynasty',
    sport: 'NFL',
    leagueSize: 10,
    isDynasty: true,
    leagueType: 'dynasty',
    scoring: 'ppr',
    // 8 active spots per team (IR does not count): rank 10 × 8 = 80 is the last rostered player.
    settings: { scoring_settings: { rec: 1 }, roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'IR'] },
    waiverBudget: 100,
    taxiSlots: 0,
    leagueVariant: 'dynasty',
    bestBallMode: false,
    starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
  }),
}))
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: async () => ({ ok: false }) }))
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: async () => h.board,
  getFantasyCalcChartDbFirst: async () => ({ players: h.board, syncedAt: '2026-10-09T04:00:00.000Z' }),
}))
vi.mock('@/lib/league-values/leagueTradeValues', () => ({ loadLeagueTradeValues: async () => null }))
vi.mock('@/lib/data/players', () => ({ getPlayer: async () => null, searchPlayers: async () => [] }))
vi.mock('@/lib/shared-services/player-identity/PlayerIdentityResolver', () => ({ resolvePlayer: async () => ({ confidence: 'none' }) }))

import {
  DEFAULT_ROSTER_SPOTS,
  rosterSpotBasisSentence,
  rosterSpotCredit,
  rosterSpotPrice,
  rosterSpotRowLabel,
  rosterSpotsFromSettings,
} from '@/lib/trade-value/rosterSpotCharge'
import { gradeTrade, mirrorTradeGrade } from '@/lib/decision-os/trade/tradeGrade'
import { tradePackageReview } from '@/lib/decision-os/trade/tradeEvidence'
import { createLeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { fantasyCalcPlayerFromSnapshot } from '@/lib/decision-os/trade/datedMarket'
import { sleeperPlayerInput } from '@/lib/decision-os/trade/completedTradeGrade'

describe('roster size', () => {
  it('counts every active spot in Sleeper’s list, and not IR, taxi or devy', () => {
    expect(rosterSpotsFromSettings({ roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN', 'IR', 'TAXI', 'DEVY'] })).toBe(6)
  })
  it('reads the NAME:count form other importers write', () => {
    expect(rosterSpotsFromSettings({ roster_positions: ['QB:1', 'RB:2', 'WR:3', 'BN:6', 'IR:2'] })).toBe(12)
  })
  it('is null when the league states none — the price then assumes 25', () => {
    expect(rosterSpotsFromSettings({})).toBeNull()
    expect(DEFAULT_ROSTER_SPOTS).toBe(25)
  })
})

describe('the price of one spot', () => {
  const chart = Array.from({ length: 300 }, (_, i) => ({ name: `P${i + 1}`, value: 10_000 - i * 30, position: 'WR' }))

  it('is the player at rank teams × roster spots', () => {
    const price = rosterSpotPrice({ chartPlayers: chart, teams: 12, rosterSpots: 20 })!
    expect(price).toMatchObject({ rank: 240, atPlayer: 'P240', valuePerSpot: 10_000 - 239 * 30, rosterSpotsAssumed: false })
  })
  it('leaves picks out of the ranking — a pick holds no roster spot', () => {
    const withPicks = [{ name: '2027 1st', value: 9_999, position: 'PICK' }, ...chart]
    expect(rosterSpotPrice({ chartPlayers: withPicks, teams: 12, rosterSpots: 20 })!.atPlayer).toBe('P240')
  })
  it('takes the last listed player past the end of a short board (the ~225-player redraft board)', () => {
    expect(rosterSpotPrice({ chartPlayers: chart, teams: 14, rosterSpots: 25 })).toMatchObject({ rank: 350, atPlayer: 'P300' })
  })
  it('assumes 25 spots when the league states none, and says so', () => {
    expect(rosterSpotPrice({ chartPlayers: chart, teams: 12, rosterSpots: null })).toMatchObject({ rank: 300, rosterSpotsAssumed: true })
  })
  it('is null on an empty board', () => {
    expect(rosterSpotPrice({ chartPlayers: [], teams: 12, rosterSpots: 20 })).toBeNull()
  })
})

describe('the credit', () => {
  it('goes to the side receiving fewer players, one spot per player of difference', () => {
    // You receive 2 players for 1: your partner receives fewer, so the credit joins what you SEND.
    expect(rosterSpotCredit({ givePlayers: 1, getPlayers: 2, valuePerSpot: 400 })).toEqual({ side: 'give', spots: 1, valuePerSpot: 400, value: 400 })
    // You consolidate 3 into 1: you receive fewer, so the credit joins what you GET.
    expect(rosterSpotCredit({ givePlayers: 3, getPlayers: 1, valuePerSpot: 400 })).toEqual({ side: 'get', spots: 2, valuePerSpot: 400, value: 800 })
  })
  it('is nothing for an even player count', () => {
    expect(rosterSpotCredit({ givePlayers: 2, getPlayers: 2, valuePerSpot: 400 })).toBeNull()
  })
  it('names what it added, to whom and where the number comes from', () => {
    const credit = rosterSpotCredit({ givePlayers: 2, getPlayers: 1, valuePerSpot: 190 })!
    const text = rosterSpotBasisSentence(credit, { valuePerSpot: 190, rank: 300, atPlayer: 'Some Receiver', rosterSpotsAssumed: true })
    expect(text).toBe('Includes 190 for an open roster spot: you receive fewer players, so your side gains room to add a player. One spot is worth the league’s last rostered player on this chart (rank 300, today Some Receiver) (roster size not stated, 25 assumed).')
    expect(rosterSpotRowLabel(credit, 'viewer')).toMatch(/^The roster spot you gain/)
    expect(rosterSpotRowLabel({ side: 'give', spots: 1 }, 'teams')).toMatch(/^Open roster spot Team B gains/)
  })
})

describe('the grade carries it', () => {
  const lines = [
    { side: 'give' as const, assetKind: 'player' as const, name: 'Star', marketValue: 8000, leagueValue: 8000 },
    { side: 'get' as const, assetKind: 'player' as const, name: 'Depth A', marketValue: 4500, leagueValue: 4500 },
    { side: 'get' as const, assetKind: 'player' as const, name: 'Depth B', marketValue: 4500, leagueValue: 4500 },
  ]
  const base = { giveMarket: 8000, getMarket: 9000, unpriced: 0, giveCount: 1, getCount: 2, basis: 'test', scoringApplied: false, needApplied: false, needGap: null, lines, moves: [] }

  it('turns a straight-sum B into the measured even (C) for 9,000 of depth against an 8,000 star', () => {
    expect(gradeTrade({ ...base, giveValue: 8000, getValue: 9000 })).toMatchObject({ graded: true, letter: 'B' })
    const spot = { side: 'give' as const, spots: 1, valuePerSpot: 1200, value: 1200 }
    const view = gradeTrade({ ...base, giveValue: 8000 + 1200, getValue: 9000, rosterSpot: spot })
    expect(view).toMatchObject({ graded: true, letter: 'C', rosterSpot: spot })
  })

  it('mirrors to the other side with the credit still on the same total', () => {
    const spot = { side: 'give' as const, spots: 1, valuePerSpot: 1200, value: 1200 }
    const view = gradeTrade({ ...base, giveValue: 9200, getValue: 9000, rosterSpot: spot })
    const other = mirrorTradeGrade(view)
    expect(other.graded && other.rosterSpot).toEqual({ ...spot, side: 'get' })
    expect(other.graded && [other.giveValue, other.getValue]).toEqual([9000, 9200])
  })

  it('tells the manager the drop is already counted', () => {
    expect(tradePackageReview(lines, { rosterSpotCharged: true })!.note).toMatch(/already counts the roster spot/)
    expect(tradePackageReview(lines)!.note).toMatch(/sums quoted asset prices/)
  })
})

describe('end to end through the one grader', () => {
  const row = (id: string, name: string, value: number, position = 'WR') =>
    fantasyCalcPlayerFromSnapshot({ sleeperId: id, name, position, value, overallRank: null, positionRank: null, trend30d: null, tradeFrequency: null, marketStdDev: null })

  it('credits the consolidating side with the league’s last-rostered player and grades on that', async () => {
    // 100 players: P1 10,000 down by 50. Rank 80 (10 teams × 8 spots) is P80 at 6,050.
    h.board = Array.from({ length: 100 }, (_, i) => row(String(1000 + i), `P${i + 1}`, 10_000 - i * 50))
    const grader = (await createLeagueTradeGrader({ leagueId: 'L-spot' }))!
    expect(grader.chart.rosterSpots).toBe(8)
    const one = (i: number) => sleeperPlayerInput(`P${i}`, String(1000 + i - 1), 'WR')
    // You send P1 (10,000) and receive P11 + P12 (9,500 + 9,450 = 18,950).
    const view = await grader.grade({ give: [one(1)], get: [one(11), one(12)], viewerSide: false })
    expect(view.graded).toBe(true)
    if (!view.graded) return
    expect(view.rosterSpot).toEqual({ side: 'give', spots: 1, valuePerSpot: 6050, value: 6050 })
    expect(view.giveValue).toBe(10_000 + 6050)
    expect(view.getValue).toBe(18_950)
    expect(view.lines).toHaveLength(3) // one line per traded asset — the credit is not a line
    expect(view.basis).toContain('One spot is worth the league’s last rostered player on this chart (rank 80, today P80)')
    // Even count: no credit.
    const even = await grader.grade({ give: [one(1)], get: [one(11)], viewerSide: false })
    expect(even.graded && even.rosterSpot).toBeFalsy()
  })
})
