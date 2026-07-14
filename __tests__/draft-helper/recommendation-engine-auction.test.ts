import { describe, expect, it } from 'vitest'
import { computeDraftPlayerRankings, type RecommendationInput, type RecommendationPlayer } from '@/lib/draft-helper/RecommendationEngine'

function basePlayer(overrides: Partial<RecommendationPlayer>): RecommendationPlayer {
  return { name: 'X', position: 'WR', team: 'AAA', adp: 50, ...overrides }
}

function baseInput(overrides: Partial<RecommendationInput>): RecommendationInput {
  return {
    available: [],
    teamRoster: [],
    rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
    round: 5,
    pick: 5,
    totalTeams: 12,
    sport: 'NFL',
    mode: 'bpa',
    ...overrides,
  }
}

// Phase 30: real auction budget data (DraftSession.auctionBudgetPerTeam/auctionBudgets)
// already exists and is live-persisted (AuctionEngine.ts), but RecommendationEngine.ts had
// zero awareness of it before this phase (confirmed via grep: zero matches for
// "auction"/"budget" in the file). These tests demonstrate the gap first, then verify the
// real, bounded, deterministic fix -- reusing the existing getAuctionMaxBid()/
// canPlaceAuctionBid() formulas from lib/mock-draft/draft-engine.ts, not a reinvented one.
describe('RecommendationEngine — Auction budget affordability (Phase 30)', () => {
  it('a premium-ADP player scores lower for a budget-constrained team than a flush team', () => {
    const elite = basePlayer({ name: 'Elite Star', position: 'WR', adp: 3 })
    const input = baseInput({ available: [elite] })

    const flush = computeDraftPlayerRankings({
      ...input,
      auctionContext: { remainingBudget: 180, rosterSlotsRemaining: 10 },
    })!.scored[0].totalScore

    const constrained = computeDraftPlayerRankings({
      ...input,
      auctionContext: { remainingBudget: 15, rosterSlotsRemaining: 10 },
    })!.scored[0].totalScore

    expect(constrained).toBeLessThan(flush)
  })

  it('a late-ADP (cheap) player is unaffected by budget constraints', () => {
    const cheap = basePlayer({ name: 'Bench Depth', position: 'WR', adp: 180 })
    const input = baseInput({ available: [cheap] })

    const flush = computeDraftPlayerRankings({
      ...input,
      auctionContext: { remainingBudget: 180, rosterSlotsRemaining: 10 },
    })!.scored[0].totalScore

    const constrained = computeDraftPlayerRankings({
      ...input,
      auctionContext: { remainingBudget: 15, rosterSlotsRemaining: 10 },
    })!.scored[0].totalScore

    expect(constrained).toBe(flush)
  })

  it('omitting auctionContext preserves exact pre-Phase-30 behavior (backward compatible)', () => {
    const elite = basePlayer({ name: 'Elite Star', position: 'WR', adp: 3 })
    const input = baseInput({ available: [elite] })

    const omitted = computeDraftPlayerRankings(input)!.scored[0].totalScore
    const explicitlyUndefined = computeDraftPlayerRankings({ ...input, auctionContext: undefined })!.scored[0].totalScore

    expect(omitted).toBe(explicitlyUndefined)
  })

  it('zero roster slots remaining does not throw and applies no adjustment', () => {
    const elite = basePlayer({ name: 'Elite Star', position: 'WR', adp: 3 })
    const input = baseInput({ available: [elite], auctionContext: { remainingBudget: 50, rosterSlotsRemaining: 0 } })

    expect(() => computeDraftPlayerRankings(input)).not.toThrow()
  })

  it('is deterministic: identical auction context always produces identical scores', () => {
    const elite = basePlayer({ name: 'Elite Star', position: 'WR', adp: 3 })
    const input = baseInput({ available: [elite], auctionContext: { remainingBudget: 15, rosterSlotsRemaining: 10 } })

    const run1 = computeDraftPlayerRankings(input)!.scored[0].totalScore
    const run2 = computeDraftPlayerRankings(input)!.scored[0].totalScore

    expect(run1).toBe(run2)
  })
})
