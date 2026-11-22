import { describe, expect, it } from 'vitest'
import {
  aiCeiling,
  auctionValues,
  createMockAuction,
  mockAuctionTiming,
  nextNominatorIndex,
  nominateForUser,
  pickAiBid,
  placeUserBid,
  sellLot,
  tickMockAuction,
  type MockAuctionContext,
  type MockAuctionState,
} from '@/lib/mock-draft/mockAuction'

function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const POSITIONS = ['RB', 'WR', 'WR', 'QB', 'TE', 'RB', 'WR']
function players(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    adp: i + 1,
    projectedPts: 400 - i,
    position: POSITIONS[i % POSITIONS.length]!,
  }))
}

const TEAMS = 12
const ROSTER = 16
const BUDGET = 200
const USER = 3
const ORDER = Array.from({ length: TEAMS }, (_, i) => i + 1)

function ctxFor(input: {
  now: number
  rand: () => number
  spotsLeft: Record<number, number>
  values: Record<string, number>
  available: { id: string; position: string }[]
  autoNominateId?: string | null
  speed?: number
}): MockAuctionContext {
  const needs: Record<number, string[]> = {}
  for (const slot of ORDER) needs[slot] = ['RB', 'WR']
  return {
    now: input.now,
    rand: input.rand,
    userSlot: USER,
    order: ORDER,
    spotsLeft: input.spotsLeft,
    needs,
    values: input.values,
    available: input.available,
    autoNominateId: input.autoNominateId ?? null,
    timing: mockAuctionTiming(input.speed ?? 15),
  }
}

describe('auctionValues', () => {
  it('spends the league budget on a steep curve, a dollar minimum for everyone', () => {
    const pool = players(260)
    const values = auctionValues(pool, { teamCount: TEAMS, rosterSize: ROSTER, budgetPerTeam: BUDGET })
    expect(values.p1).toBeGreaterThanOrEqual(50)
    expect(values.p1).toBeLessThanOrEqual(70)
    expect(values.p1).toBeGreaterThan(values.p12!)
    expect(values.p12).toBeGreaterThan(values.p50!)
    expect(values.p150).toBeLessThanOrEqual(3)
    expect(values.p260).toBe(1)
    const draftableTotal = pool.slice(0, TEAMS * ROSTER).reduce((sum, p) => sum + values[p.id]!, 0)
    expect(Math.abs(draftableTotal - TEAMS * BUDGET)).toBeLessThan(TEAMS * BUDGET * 0.05)
  })

  it('ranks by ADP, then projection for players with no ADP', () => {
    const values = auctionValues(
      [
        { id: 'late', adp: null, projectedPts: 10 },
        { id: 'top', adp: 1, projectedPts: 50 },
        { id: 'proj', adp: null, projectedPts: 300 },
      ],
      { teamCount: 1, rosterSize: 3, budgetPerTeam: 100 },
    )
    expect(values.top).toBeGreaterThan(values.proj!)
    expect(values.proj).toBeGreaterThan(values.late!)
  })
})

describe('aiCeiling', () => {
  const base = { value: 40, budget: 200, spotsLeft: 16, budgetPerTeam: 200, rosterSize: 16, minBid: 1, rand: () => 0.5 }
  it('pays more for a position it needs', () => {
    expect(aiCeiling({ ...base, needsPosition: true })).toBeGreaterThan(aiCeiling({ ...base, needsPosition: false }))
  })
  it('never goes above the max bid', () => {
    expect(aiCeiling({ ...base, value: 500, needsPosition: true, budget: 30, spotsLeft: 10 })).toBe(21)
  })
  it('a full roster does not bid', () => {
    expect(aiCeiling({ ...base, needsPosition: true, spotsLeft: 0 })).toBe(0)
  })
})

describe('nomination order', () => {
  it('skips teams with full rosters and wraps', () => {
    expect(nextNominatorIndex([1, 2, 3], 1, { 1: 2, 2: 0, 3: 0 })).toBe(0)
    expect(nextNominatorIndex([1, 2, 3], 0, { 1: 0, 2: 0, 3: 0 })).toBeNull()
  })
})

describe('a single lot', () => {
  function openWithCeilings(ceilings: Record<number, number>): { state: MockAuctionState; ctx: MockAuctionContext } {
    const pool = players(40)
    const spotsLeft: Record<number, number> = {}
    for (const slot of ORDER) spotsLeft[slot] = ROSTER
    const ctx = ctxFor({ now: 0, rand: seeded(7), spotsLeft, values: auctionValues(pool, { teamCount: TEAMS, rosterSize: ROSTER, budgetPerTeam: BUDGET }), available: pool })
    let state = createMockAuction({ teamSlots: ORDER, order: ORDER, budgetPerTeam: BUDGET, rosterSize: ROSTER, userSlot: USER, now: 0, timing: ctx.timing })
    state = { ...state, nominationIndex: USER - 1 }
    state = nominateForUser(state, ctx, 'p1')
    return { state: { ...state, lot: { ...state.lot!, ceilings } }, ctx }
  }

  it('the user nominates and leads at the minimum bid', () => {
    const { state } = openWithCeilings({})
    expect(state.lot).toMatchObject({ playerId: 'p1', nominatorSlot: USER, leaderSlot: USER, bid: 1 })
  })

  it('AI teams raise until nobody will go higher, then the leader wins at their bid', () => {
    let { state, ctx } = openWithCeilings({ 1: 30, 2: 22, 4: 5 })
    let now = 0
    for (let i = 0; i < 400 && state.lot; i += 1) {
      now += 250
      const tick = tickMockAuction(state, { ...ctx, now })
      state = tick.state
      if (tick.sale) {
        expect(tick.sale.winnerSlot).toBe(1)
        expect(tick.sale.price).toBeGreaterThanOrEqual(23)
        expect(tick.sale.price).toBeLessThanOrEqual(30)
        expect(state.budgets[1]).toBe(BUDGET - tick.sale.price)
      }
    }
    expect(state.lot).toBeNull()
    expect(state.lastSale?.winnerSlot).toBe(1)
  })

  it('a user bid above every AI ceiling wins once the bid clock runs out', () => {
    let { state, ctx } = openWithCeilings({ 1: 10 })
    state = { ...state, lot: { ...state.lot!, leaderSlot: 1, bid: 8 } }
    const bid = placeUserBid(state, ctx, 11)
    expect(bid.ok).toBe(true)
    if (!bid.ok) return
    state = bid.state
    let sale = null
    for (let now = 250; now <= 20_000 && !sale; now += 250) {
      const tick = tickMockAuction(state, { ...ctx, now })
      state = tick.state
      sale = tick.sale
    }
    expect(sale).toMatchObject({ winnerSlot: USER, price: 11 })
    expect(state.budgets[USER]).toBe(BUDGET - 11)
  })

  it('rejects a user bid that is too low, over the max bid, or while already leading', () => {
    const { state, ctx } = openWithCeilings({})
    expect(placeUserBid(state, ctx, 5)).toEqual({ ok: false, reason: 'leading' })
    const outbid = { ...state, lot: { ...state.lot!, leaderSlot: 1, bid: 9 } }
    expect(placeUserBid(outbid, ctx, 9)).toEqual({ ok: false, reason: 'too-low' })
    expect(placeUserBid(outbid, ctx, 186)).toEqual({ ok: false, reason: 'over-max' })
    expect(placeUserBid(outbid, ctx, 185).ok).toBe(true)
  })

  it('selling hands the nomination to the next team with an open spot', () => {
    const { state, ctx } = openWithCeilings({})
    const spots = { ...ctx.spotsLeft, 4: 0 }
    const { state: after, sale } = sellLot(state, { ...ctx, spotsLeft: spots })
    expect(sale).toMatchObject({ winnerSlot: USER, price: 1 })
    expect(ORDER[after.nominationIndex]).toBe(5)
    expect(after.nextAiNominationAtMs).not.toBeNull()
  })

  it('an AI raise never lands on the leader or the user', () => {
    const { state, ctx } = openWithCeilings({ 1: 50, [USER]: 99 })
    const leadBy1 = { ...state.lot!, leaderSlot: 1, bid: 5 }
    expect(pickAiBid(leadBy1, ctx)).toBeNull()
  })
})

describe('a whole mock auction with a passive user', () => {
  it('fills every roster, never overspends, and spends most of the money', () => {
    const rand = seeded(42)
    const pool = players(260)
    const values = auctionValues(pool, { teamCount: TEAMS, rosterSize: ROSTER, budgetPerTeam: BUDGET })
    const owned: Record<number, string[]> = {}
    for (const slot of ORDER) owned[slot] = []
    const sold = new Set<string>()
    const timing = mockAuctionTiming(5)
    let state = createMockAuction({ teamSlots: ORDER, order: ORDER, budgetPerTeam: BUDGET, rosterSize: ROSTER, userSlot: USER, now: 0, timing })
    let now = 0
    let complete = false
    let sales = 0
    for (let i = 0; i < 200_000 && !complete; i += 1) {
      now += 200
      const spotsLeft: Record<number, number> = {}
      for (const slot of ORDER) spotsLeft[slot] = ROSTER - owned[slot]!.length
      const available = pool.filter((p) => !sold.has(p.id)).sort((a, b) => values[b.id]! - values[a.id]!)
      const ctx = ctxFor({ now, rand, spotsLeft, values, available, speed: 5 })
      const tick = tickMockAuction(state, ctx)
      if (tick.sale) {
        expect(sold.has(tick.sale.playerId)).toBe(false)
        expect(tick.sale.price).toBeLessThanOrEqual(
          Math.max(1, state.budgets[tick.sale.winnerSlot]! - (spotsLeft[tick.sale.winnerSlot]! - 1)),
        )
        sold.add(tick.sale.playerId)
        owned[tick.sale.winnerSlot]!.push(tick.sale.playerId)
        sales += 1
      }
      state = tick.state
      complete = tick.complete
    }
    expect(complete).toBe(true)
    expect(sales).toBe(TEAMS * ROSTER)
    for (const slot of ORDER) {
      expect(owned[slot]).toHaveLength(ROSTER)
      expect(state.budgets[slot]).toBeGreaterThanOrEqual(0)
    }
    const aiSpend = ORDER.filter((s) => s !== USER).map((s) => BUDGET - state.budgets[s]!)
    const avg = aiSpend.reduce((a, b) => a + b, 0) / aiSpend.length
    expect(avg).toBeGreaterThan(BUDGET * 0.7)
  })
})
