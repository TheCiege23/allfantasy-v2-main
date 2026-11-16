/**
 * The FAAB plan outside the NFL (2026-11-16, re-score item 12). The NFL market chart is keyed by Sleeper
 * id, which Sleeper reuses across sports, so an NBA league must never read it: it is planned from its
 * own value board — the Waivers board's per-game lineup gain × games left — and any sport without a
 * board is refused in words.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ league: vi.fn(), teams: vi.fn(), rosters: vi.fn(), values: vi.fn(), weekly: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.league },
    leagueTeam: { findMany: h.teams },
    roster: { findMany: h.rosters },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    weeklyMatchup: { findFirst: h.weekly, findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/trade-intel/marketValueService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade-intel/marketValueService')>('@/lib/trade-intel/marketValueService')
  return { ...actual, getMarketValues: h.values }
})

import { computeFaabBidPlan, renderFaabBidText, type FaabPlanDeps } from '@/lib/chimmy/tools/faabBidTool'
import type { LeagueValueBoard } from '@/lib/sport-values/leagueValueBoard'
import type { WaiverBoard } from '@/lib/waivers/waiverBoard'
import type { SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'

const LEAGUE = {
  id: 'N1', name: 'Hoops', platform: 'sleeper', platformLeagueId: '777', sport: 'NBA', season: 2026, isDynasty: false,
  leagueType: 'guillotine', settings: { faab_budget: 100, roster_positions: ['PG', 'SG', 'UTIL', 'UTIL', 'BN'] },
}
const ME = { externalId: '2', platformUserId: 'u-me', claimedByUserId: 'me', ownerName: 'me', teamName: 'Mine', wins: 1, losses: 1, ties: 0, pointsFor: 200 }
const MY_ROSTER = { platformUserId: 'u-me', faabRemaining: 80, playerData: { players: ['s1', 's2'], starters: ['s1', 's2'] } }

const ctx = (over: Partial<SportPointsContext> = {}): SportPointsContext => ({
  sport: 'NBA', board: [], replacementByPosition: new Map(), scoringBasis: 'league', teams: 2,
  window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 50 },
  ...over,
})
const board = (c: SportPointsContext = ctx()): FaabPlanDeps['valueBoard'] => async (): Promise<LeagueValueBoard> => ({ kind: 'ok', sport: 'NBA', ctx: c, byId: new Map() })

const cand = (key: string, name: string, gain: number, displaced: string | null = 'My Guard') => ({
  sleeperId: null, playerKey: key, name, position: 'PG', team: 'BOS', projectedPoints: 30, gain, basis: 'season_rate' as const,
  displaces: displaced ? { sleeperId: null, playerKey: 'k-mine', name: displaced, projectedPoints: 25 } : null,
})
const wire = (candidates: ReturnType<typeof cand>[], state: WaiverBoard['state'] = 'ok', notes: string[] = []): FaabPlanDeps['waiverBoard'] =>
  vi.fn(async () => ({ state, season: '2026', week: null, currentLineupPoints: 100, candidates, notes, sport: 'NBA', basis: 'league_value_board' as const }))

beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockResolvedValue(LEAGUE)
  h.teams.mockResolvedValue([ME])
  h.rosters.mockResolvedValue([MY_ROSTER])
  h.weekly.mockResolvedValue(null)
})

describe('get_faab_bid_plan in an NBA league', () => {
  it('🛑 never reads the NFL market chart', async () => {
    await computeFaabBidPlan('N1', 'me', { valueBoard: board(), waiverBoard: wire([]) })
    expect(h.values).not.toHaveBeenCalled()
  })

  it('bids from the Waivers board’s own lineup gain × games left, under the league’s board', async () => {
    const waiverBoard = wire([cand('k-a', 'Wire Star', 6), cand('k-b', 'Spot Starter', 2, null)])
    const plan = await computeFaabBidPlan('N1', 'me', { valueBoard: board(), waiverBoard, now: new Date('2026-11-16T12:00:00Z') })
    if (plan.status !== 'ok') throw new Error(plan.line)
    // The board the plan read is the one handed to the wire — one board, one number per player.
    expect(waiverBoard).toHaveBeenCalledWith(expect.objectContaining({ userId: 'me', limit: 100 }))
    expect(plan.valueUnit).toBe('fantasy points')
    expect(plan.outcome).toBe('bid') // a guillotine: dollars
    // 6 × 50 = 300 and 2 × 50 = 100: shares 75% and 25%.
    expect(plan.upgrades.map((b) => [b.name, b.marginalValue, Math.round(b.shareOfSupply * 100), b.displacedName])).toEqual([
      ['Wire Star', 300, 75, 'My Guard'],
      ['Spot Starter', 100, 25, null],
    ])
    expect(plan.seatsLabel).toBe('PG, SG, UTIL ×2')
    const text = renderFaabBidText(plan)
    expect(text).toContain("values from this league's own NBA value board (2026-27, 50 games left) as of 2026-11-16")
    expect(text).toContain('Values are rest-of-season fantasy points added to the user\'s best lineup (per-game gain × games left)')
    expect(text).not.toContain('market-value units')
    expect(text).not.toContain('1 QB / 2 RB')
  })

  it('a category league says category score', async () => {
    const plan = await computeFaabBidPlan('N1', 'me', { valueBoard: board(ctx({ valueKind: 'categories', categoryList: 'PTS and REB' })), waiverBoard: wire([cand('k-a', 'A', 1)]) })
    if (plan.status !== 'ok') throw new Error(plan.line)
    expect(plan.valueUnit).toBe('category score')
    expect(renderFaabBidText(plan)).toContain('Values are rest-of-season category score added')
  })

  it('nobody on the wire would start: save the FAAB — not "nothing valued is unrostered"', async () => {
    const plan = await computeFaabBidPlan('N1', 'me', { valueBoard: board(), waiverBoard: wire([]) })
    if (plan.status !== 'ok') throw new Error(plan.line)
    expect(plan.outcome).toBe('save')
    expect(renderFaabBidText(plan)).toContain("No free agent would improve the user's starting lineup. The answer is: do not spend FAAB this week; save it.")
  })

  it('a board that cannot be built, a season with no games left, or a wire that will not build, is refused in words', async () => {
    const unavailable = await computeFaabBidPlan('N1', 'me', { valueBoard: async () => ({ kind: 'unavailable', sport: 'NBA', reason: 'Only 40% of the board clears the sample bar.' }) })
    expect(unavailable).toEqual({ status: 'refused', line: "FAAB BID PLAN: this league's NBA value board is not available — Only 40% of the board clears the sample bar. Say so; do not estimate bids." })
    const over = await computeFaabBidPlan('N1', 'me', { valueBoard: board(ctx({ window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 0 } })) })
    expect(over.status === 'refused' && over.line).toContain('has no games left')
    const ids = await computeFaabBidPlan('N1', 'me', { valueBoard: board(), waiverBoard: wire([], 'ids_unreadable', ["This league's NBA player ids can't be matched to our projections yet."]) })
    expect(ids).toEqual({ status: 'refused', line: "FAAB BID PLAN: This league's NBA player ids can't be matched to our projections yet. Say so; do not estimate bids." })
  })
})

describe('get_faab_bid_plan in a sport with no value board', () => {
  it('🛑 refuses in words and never reads the NFL chart', async () => {
    h.league.mockResolvedValue({ ...LEAGUE, sport: 'MLB' })
    const plan = await computeFaabBidPlan('N1', 'me')
    expect(plan).toEqual({
      status: 'refused',
      line: 'FAAB BID PLAN: AllFantasy has no MLB player values to bid with yet, so bids cannot be priced in this league. Say so; do not estimate bids, and never use NFL values.',
    })
    expect(h.values).not.toHaveBeenCalled()
  })
})
