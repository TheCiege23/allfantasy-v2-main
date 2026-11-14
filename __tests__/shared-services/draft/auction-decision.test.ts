import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The live auction loader (2026-11-14): budgets come from the session through the bid engine's own
 * reader, open slots are `rounds − picks` (the bid engine's rule), the player up for bid is priced,
 * and a Sleeper-mirrored auction says that bid amounts are not mirrored.
 */

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  rosterFindUnique: vi.fn(),
  context: vi.fn(),
  aliases: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findFirst: h.findFirst },
    draftPick: { findMany: h.findMany },
    roster: { findUnique: h.rosterFindUnique },
  },
}))
vi.mock('@/lib/shared-services/draft/DraftContextAssembler', () => ({
  buildDraftDecisionContext: h.context,
  resolveTargetRosterAliases: h.aliases,
}))

import { buildAuctionDecision } from '@/lib/shared-services/draft/auctionDecision'

const AVAILABLE = Array.from({ length: 40 }, (_, i) => ({
  name: `Player ${i + 1}`,
  position: ['RB', 'WR', 'QB', 'TE'][i % 4]!,
  team: 'AAA',
  adp: i + 1,
}))

beforeEach(() => {
  h.context.mockResolvedValue({
    scoringWindow: { startWeek: 11, endWeek: 12, label: 'KBI round 2' },
    engineInput: { available: AVAILABLE, teamRoster: [], rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'], round: 1, pick: 1, totalTeams: 4, sport: 'NFL' },
  })
  h.rosterFindUnique.mockResolvedValue({ platformUserId: 'u1' })
  h.aliases.mockResolvedValue([])
  h.findMany.mockResolvedValue([{ rosterId: 'me' }, { rosterId: 'me' }, { rosterId: 'r2' }])
  h.findFirst.mockResolvedValue({
    id: 's1',
    rounds: 10,
    auctionBudgetPerTeam: 200,
    auctionBudgets: { me: 150, r2: 190, r3: 200, r4: 200 },
    auctionState: { currentNomination: { playerName: 'Player 3', position: 'QB', team: 'AAA', playerId: null }, currentBid: 4 },
    slotOrder: [{ rosterId: 'me' }, { rosterId: 'r2' }, { rosterId: 'r3' }, { rosterId: 'r4' }],
    timerSeconds: 30,
    sleeperDraftId: null,
  })
})

describe('buildAuctionDecision', () => {
  it('prices the nomination against my budget and the room’s', async () => {
    const { advice, scoringWindowInsight } = await buildAuctionDecision({ leagueId: 'lg', rosterId: 'me' })
    // $150 with 8 open slots (10 rounds − 2 picks) → max legal bid 150 − 7 = 143.
    expect(advice.maxLegalBid).toBe(143)
    expect(advice.nominated?.playerName).toBe('Player 3')
    expect(advice.nominated?.currentBid).toBe(4)
    expect(advice.nominated?.verdict).toBe('bid')
    expect(scoringWindowInsight).toContain('KBI round 2 weeks 11–12')
    expect(advice.caveats.join(' ')).not.toContain('mirrored from Sleeper')
  })

  it('says so when the auction is mirrored from Sleeper', async () => {
    h.findFirst.mockResolvedValueOnce({
      id: 's1', rounds: 10, auctionBudgetPerTeam: null, auctionBudgets: null, auctionState: null,
      slotOrder: [{ rosterId: 'me' }, { rosterId: 'r2' }], timerSeconds: 30, sleeperDraftId: 'sl-1',
    })
    const { advice } = await buildAuctionDecision({ leagueId: 'lg', rosterId: 'me' })
    expect(advice.caveats[0]).toContain('mirrored from Sleeper')
    expect(advice.caveats.join(' ')).toContain('assumed to have the default budget')
    expect(advice.nominated).toBeNull()
  })
})
