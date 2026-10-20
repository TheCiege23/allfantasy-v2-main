import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  leagueFindFirst: vi.fn(),
  rosterFindFirst: vi.fn(),
  eligFindMany: vi.fn(),
  draftFindFirst: vi.fn(),
  recordUpsert: vi.fn(),
  recordDeleteMany: vi.fn(),
  sessionUpdateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: m.leagueFindFirst },
    redraftRoster: { findFirst: m.rosterFindFirst },
    keeperEligibility: { findMany: m.eligFindMany },
    draftSession: { findFirst: m.draftFindFirst },
    keeperRecord: { upsert: m.recordUpsert, deleteMany: m.recordDeleteMany },
    keeperSelectionSession: { updateMany: m.sessionUpdateMany },
  },
}))

import { submitKeeperSelections } from '@/lib/keeper/selectionEngine'

const player = (playerId: string) => ({ playerId, playerName: playerId.toUpperCase(), position: 'RB', team: 'X', sport: 'NFL', acquisitionType: 'draft', droppedAt: null })
const elig = (playerId: string, round: number) => ({ playerId, isEligible: true, ineligibleReason: null, projectedCostRound: round, projectedCost: `Round ${round}`, projectedCostAuction: null })

function setup(rule: string) {
  m.leagueFindFirst.mockResolvedValue({ id: 'L', keeperCount: 3, keeperConflictRule: rule, keeperCostSystem: 'round_based', settings: {} })
  m.rosterFindFirst.mockResolvedValue({ id: 'R', players: [player('a'), player('b'), player('c')] })
  m.eligFindMany.mockResolvedValue([elig('a', 5), elig('b', 5), elig('c', 9)])
  m.draftFindFirst.mockResolvedValue({ rounds: 15 })
  m.recordUpsert.mockImplementation(async ({ create }) => ({ id: create.playerId, ...create }))
  m.sessionUpdateMany.mockResolvedValue({ count: 1 })
}

beforeEach(() => vi.clearAllMocks())

describe('submitKeeperSelections — two keepers costing the same round', () => {
  it('lose the round before: both are kept, the second one costs (and forfeits) round 4', async () => {
    setup('lose_round_before')
    const out = await submitKeeperSelections('R', 'L', 'S', ['a', 'b', 'c'])

    expect(out.conflicted).toEqual([])
    expect(out.cost).toEqual([
      { playerId: 'a', costLabel: 'Round 5', costRound: 5 },
      { playerId: 'b', costLabel: 'Round 4 (moved from Round 5: two keepers cost Round 5)', costRound: 4 },
      { playerId: 'c', costLabel: 'Round 9', costRound: 9 },
    ])
    const stored = m.recordUpsert.mock.calls.map(([arg]) => [arg.create.playerId, arg.create.costRound])
    expect(stored).toEqual([['a', 5], ['b', 4], ['c', 9]])
  })

  it('player chooses (the existing default): both are refused and reported, the rest are kept', async () => {
    setup('player_chooses')
    const out = await submitKeeperSelections('R', 'L', 'S', ['a', 'b', 'c'])

    expect(out.conflicted).toEqual([{ playerIds: ['a', 'b'], reason: 'duplicate_round_5' }])
    expect(out.cost.map((c) => c.playerId)).toEqual(['c'])
    expect(m.recordDeleteMany).not.toHaveBeenCalled()
  })

  it('reject both: the clashing pair is removed from earlier submissions too', async () => {
    setup('reject_both')
    await submitKeeperSelections('R', 'L', 'S', ['a', 'b', 'c'])
    expect(m.recordDeleteMany).toHaveBeenCalledTimes(2)
  })
})
