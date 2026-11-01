import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  leagueFindFirst: vi.fn(),
  rosterFindFirst: vi.fn(),
  eligFindMany: vi.fn(),
  draftFindFirst: vi.fn(),
  recordUpsert: vi.fn(),
  recordDeleteMany: vi.fn(),
  sessionUpdateMany: vi.fn(),
  sessionFindFirst: vi.fn(async () => ({ status: 'open' })),
  executeRaw: vi.fn(async () => 1),
  auditCreate: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', () => {
  const db = {
    league: { findFirst: m.leagueFindFirst },
    redraftRoster: { findFirst: m.rosterFindFirst },
    keeperEligibility: { findMany: m.eligFindMany },
    draftSession: { findFirst: m.draftFindFirst },
    keeperRecord: { upsert: m.recordUpsert, deleteMany: m.recordDeleteMany },
    keeperSelectionSession: { updateMany: m.sessionUpdateMany, findFirst: m.sessionFindFirst },
    leagueAuditLog: { create: m.auditCreate },
    $executeRaw: m.executeRaw,
  }
  return { prisma: { ...db, $transaction: vi.fn(async (action) => action(db)) } }
})

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

beforeEach(() => {
  vi.clearAllMocks()
  m.sessionFindFirst.mockResolvedValue({ status: 'open' })
  m.auditCreate.mockResolvedValue({})
})

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

describe('submitKeeperSelections — choosing to keep nobody', () => {
  it('leaves a marker so the missed-deadline rule never treats the choice as silence', async () => {
    setup('player_chooses')
    await submitKeeperSelections('R', 'L', 'S', [])
    expect(m.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ leagueId: 'L', actionType: 'keeper_submitted_none', entityId: 'S', metadata: { rosterId: 'R' } }) })
  })
  it('a normal submission leaves no marker', async () => {
    setup('player_chooses')
    await submitKeeperSelections('R', 'L', 'S', ['c'])
    expect(m.auditCreate).not.toHaveBeenCalled()
  })
  it('does not accept an empty choice if its marker cannot be persisted', async () => {
    setup('player_chooses')
    m.auditCreate.mockRejectedValueOnce(new Error('write failed'))
    await expect(submitKeeperSelections('R', 'L', 'S', [])).rejects.toThrow('write failed')
    expect(m.sessionUpdateMany).not.toHaveBeenCalled()
  })
  it('does not write an empty marker for a roster outside the requested season', async () => {
    setup('player_chooses')
    m.rosterFindFirst.mockResolvedValueOnce(null)
    await expect(submitKeeperSelections('R', 'L', 'wrong', [])).rejects.toThrow('Roster not found')
    expect(m.auditCreate).not.toHaveBeenCalled()
  })
  it('refuses a submission after the session is locked', async () => {
    setup('player_chooses')
    m.sessionFindFirst.mockResolvedValueOnce({ status: 'locked' })
    await expect(submitKeeperSelections('R', 'L', 'S', ['c'])).rejects.toThrow('closed')
    expect(m.recordUpsert).not.toHaveBeenCalled()
  })
})
