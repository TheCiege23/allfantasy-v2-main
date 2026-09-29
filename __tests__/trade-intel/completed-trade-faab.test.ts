/**
 * FAAB in completed trades (2026-09-29). Sleeper carries a budget transfer in `waiver_budget`, and
 * the completed-trade ledger read only `adds` and `draft_picks` — so "Jameis Winston for $35 FAAB"
 * (Pirate League twinty, 2026 week 3, transaction 1408624950075535360) reached every surface as
 * Winston for nothing, and the grade was withheld as a trade with an empty side.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { faabFor, type GradedTrade, type TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { completedTradeInputs, giveawayReason, oneGradeForCompletedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import type { LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'

/** Sleeper's own record of the Winston trade: roster 3 sent Winston to 8, roster 8 sent $35 to 3. */
const WINSTON_WAIVER_BUDGET = [{ amount: 35, sender: 8, receiver: 3 }]

describe('faabFor — dollars a roster received and sent in one trade', () => {
  it('reads Sleeper’s waiver_budget from each side', () => {
    expect(faabFor(WINSTON_WAIVER_BUDGET, 3)).toEqual({ faabIn: 35, faabOut: 0 })
    expect(faabFor(WINSTON_WAIVER_BUDGET, 8)).toEqual({ faabIn: 0, faabOut: 35 })
  })

  it('sums several transfers, and a roster outside the trade moves nothing', () => {
    const wb = [{ amount: 10, sender: 1, receiver: 2 }, { amount: 5, sender: 1, receiver: 2 }, { amount: 3, sender: 2, receiver: 1 }]
    expect(faabFor(wb, 2)).toEqual({ faabIn: 15, faabOut: 3 })
    expect(faabFor(wb, 9)).toEqual({ faabIn: 0, faabOut: 0 })
  })

  it('an absent, empty or malformed list is no FAAB — never NaN', () => {
    expect(faabFor(null, 1)).toEqual({ faabIn: 0, faabOut: 0 })
    expect(faabFor(undefined, 1)).toEqual({ faabIn: 0, faabOut: 0 })
    expect(faabFor([], 1)).toEqual({ faabIn: 0, faabOut: 0 })
    expect(faabFor([{ amount: Number.NaN, sender: 2, receiver: 1 }, { amount: -4, sender: 2, receiver: 1 }], 1)).toEqual({ faabIn: 0, faabOut: 0 })
  })
})

const player = (name: string, playerId: string, position: string) => ({
  playerId, name, position, pointsBySeason: {}, creditedBySeason: {}, departed: null, gamesMissedBySeason: {},
})

function side(o: Partial<TradeSideGrade> & { rosterId: number; managerName: string }): TradeSideGrade {
  return {
    ownerId: String(o.rosterId), teamName: null, avatar: null,
    playersIn: [], playersOut: [], picksIn: [], picksOut: [],
    madePlayoffs: null, seasonNets: [], cumulativeNet: 0, initialGrade: 'C', currentGrade: 'C', trend: 'steady',
    ...o,
  }
}

const trade = (sides: TradeSideGrade[]): GradedTrade => ({
  id: 'L:1408624950075535360', season: '2026', week: 3, createdIso: '2026-09-20T00:00:00.000Z',
  multiTeam: false, tie: true, hasPendingPicks: false, sides,
})

const WINSTON = player('Jameis Winston', '2306', 'QB')
const WINSTON_TRADE = trade([
  side({ rosterId: 3, managerName: 'sender', playersOut: [WINSTON], ...faabFor(WINSTON_WAIVER_BUDGET, 3) }),
  side({ rosterId: 8, managerName: 'buyer', playersIn: [WINSTON], ...faabFor(WINSTON_WAIVER_BUDGET, 8) }),
])

describe('completedTradeInputs prices FAAB', () => {
  it('the side paid in FAAB receives it — the side that no longer reads as empty', () => {
    const inputs = completedTradeInputs(WINSTON_TRADE, 2026)!
    expect(inputs.get.assets).toEqual([{ kind: 'faab', amount: 35 }])
    expect(inputs.give.assets).toEqual([expect.objectContaining({ kind: 'player', name: 'Jameis Winston' })])
  })

  it('FAAB is LAST on a side, after players and picks — the order the email aligns values to', () => {
    const t = trade([
      side({ rosterId: 1, managerName: 'a', playersIn: [player('Zay Flowers', '9997', 'WR')], faabIn: 20, faabOut: 0,
        picksIn: [{ season: '2027', round: 2, originalRosterId: 1, label: '2027 round 2', resolved: null, pending: true, rerouted: false }] }),
      side({ rosterId: 2, managerName: 'b', playersOut: [player('Zay Flowers', '9997', 'WR')], faabIn: 0, faabOut: 20 }),
    ])
    expect(completedTradeInputs(t, 2026)!.get.assets.map((a) => a.kind)).toEqual(['player', 'pick', 'faab'])
  })

  it('a payload cached before FAAB was read (no faabIn) is priced exactly as before', () => {
    const old = trade([side({ rosterId: 3, managerName: 's', playersOut: [WINSTON] }), side({ rosterId: 8, managerName: 'b', playersIn: [WINSTON] })])
    expect(completedTradeInputs(old, 2026)!.get.assets).toEqual([])
  })
})

describe('the one grade sees the FAAB', () => {
  it('hands the grader the $35 and grades the deal instead of withholding it', async () => {
    const seen: Array<{ give: TradeAssetInput[]; get: TradeAssetInput[] }> = []
    const grader = {
      grade: async (deal: { give: TradeAssetInput[]; get: TradeAssetInput[] }) => {
        seen.push(deal)
        return { graded: false as const, reason: 'stub', basis: null }
      },
    } as unknown as LeagueTradeGrader
    const view = await oneGradeForCompletedTrade('row-1', WINSTON_TRADE, 2026, { graderFor: async () => grader })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.get).toEqual([{ kind: 'faab', amount: 35 }])
    expect(view).toMatchObject({ reason: 'stub' })
  })
})

describe('a real giveaway says so', () => {
  // Zay Flowers for nothing (same league, transaction 1410573737530503168): no picks, no waiver_budget.
  const ZAY = player('Zay Flowers', '9997', 'WR')
  const GIVEAWAY = trade([
    side({ rosterId: 4, managerName: 'BigTzzy57', playersOut: [ZAY], faabIn: 0, faabOut: 0 }),
    side({ rosterId: 11, managerName: 'cstanhope12', playersIn: [ZAY], faabIn: 0, faabOut: 0 }),
  ])

  it('names who received nothing, as Sleeper’s record — not as missing data', async () => {
    expect(giveawayReason(GIVEAWAY)).toBe(
      'BigTzzy57 received nothing in return — no player, pick or FAAB on Sleeper’s record — so there is no value gap to grade.',
    )
    const grader = { grade: vi.fn() } as unknown as LeagueTradeGrader
    const view = await oneGradeForCompletedTrade('row-1', GIVEAWAY, 2026, { graderFor: async () => grader })
    expect(view).toMatchObject({ graded: false, reason: expect.stringContaining('BigTzzy57 received nothing') })
    expect((grader as unknown as { grade: ReturnType<typeof vi.fn> }).grade).not.toHaveBeenCalled()
  })

  it('a side paid only in FAAB is NOT a giveaway', () => {
    expect(giveawayReason(WINSTON_TRADE)).toBeNull()
  })

  it('an old payload cannot claim "no FAAB" — it falls through to the grader’s own reason', () => {
    const old = trade([
      side({ rosterId: 4, managerName: 'BigTzzy57', playersOut: [ZAY] }),
      side({ rosterId: 11, managerName: 'cstanhope12', playersIn: [ZAY] }),
    ])
    expect(giveawayReason(old)).toBeNull()
  })
})
