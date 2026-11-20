import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  leagueFindFirst: vi.fn(),
  rosterFindFirst: vi.fn(),
  eligFindMany: vi.fn(),
  draftFindFirst: vi.fn(),
  recordUpsert: vi.fn(),
  recordDeleteMany: vi.fn(),
  recordFindMany: vi.fn(async (): Promise<Array<{ rosterId: string }>> => []),
  auditFindMany: vi.fn(async (): Promise<Array<{ metadata: unknown }>> => []),
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
    keeperRecord: { upsert: m.recordUpsert, deleteMany: m.recordDeleteMany, findMany: m.recordFindMany },
    keeperSelectionSession: { updateMany: m.sessionUpdateMany, findFirst: m.sessionFindFirst },
    leagueAuditLog: { create: m.auditCreate, findMany: m.auditFindMany },
    // No season before this one: the ids already hold the roster (lib/keeper/keeperSourceRoster.ts).
    redraftSeason: { findFirst: vi.fn(async () => null) },
    $executeRaw: m.executeRaw,
  }
  return { prisma: { ...db, $transaction: vi.fn(async (action) => action(db)) } }
})

import { submitKeeperSelections } from '@/lib/keeper/selectionEngine'

const player = (playerId: string) => ({ playerId, playerName: playerId.toUpperCase(), position: 'RB', team: 'X', sport: 'NFL', acquisitionType: 'draft', droppedAt: null })
const elig = (playerId: string, round: number) => ({ playerId, isEligible: true, ineligibleReason: null, projectedCostRound: round, projectedCost: `Round ${round}`, projectedCostAuction: null })

/** Removals of a clashing pair name one player; the "no longer selected" sweep names the list kept. */
const clashRemovals = () => m.recordDeleteMany.mock.calls.filter(([arg]) => typeof arg.where.playerId === 'string')
const sweeps = () => m.recordDeleteMany.mock.calls.filter(([arg]) => typeof arg.where.playerId !== 'string').map(([arg]) => arg.where)

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
    expect(clashRemovals()).toHaveLength(0)
  })

  it('reject both: the clashing pair is removed from earlier submissions too', async () => {
    setup('reject_both')
    await submitKeeperSelections('R', 'L', 'S', ['a', 'b', 'c'])
    expect(clashRemovals()).toHaveLength(2)
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

/*
 * A record's yearsKept was the constant 1, so every keeper read as "first year" in the commissioner
 * records and the trade notes. It is now this keep's season as a keeper: the eligibility row's
 * history count (seasons already kept, the max-years rule's own count) plus this one.
 */
describe('submitKeeperSelections — the year a keep represents', () => {
  it("writes the player's year as a keeper on create and on a resubmission", async () => {
    setup('player_chooses')
    m.eligFindMany.mockResolvedValue([
      { ...elig('a', 5), yearsKept: 2 },
      { ...elig('b', 7), yearsKept: 0 },
      // An older eligibility row with no count reads as never kept.
      { ...elig('c', 9), yearsKept: null },
    ])
    await submitKeeperSelections('R', 'L', 'S', ['a', 'b', 'c'])
    const written = m.recordUpsert.mock.calls.map(([arg]) => [arg.create.playerId, arg.create.yearsKept, arg.update.yearsKept])
    expect(written).toEqual([['a', 3, 3], ['b', 1, 1], ['c', 1, 1]])
  })
})

/*
 * The Keepers tab posts every ticked player. A save only ever added, so an unticked player stayed on
 * file and was locked with the rest; and the "teams submitted" count went up on every save.
 */
describe('submitKeeperSelections — the saved list is the selection', () => {
  it('removes this team\'s pending keepers the list no longer names, and nobody else\'s', async () => {
    setup('player_chooses')
    await submitKeeperSelections('R', 'L', 'S', ['c'])
    expect(sweeps()).toEqual([{ leagueId: 'L', seasonId: 'S', rosterId: 'R', status: { in: ['pending', 'confirmed'] }, playerId: { notIn: ['c'] } }])
  })

  it('saving nobody clears every pending keeper', async () => {
    setup('player_chooses')
    await submitKeeperSelections('R', 'L', 'S', [])
    expect(sweeps()).toEqual([{ leagueId: 'L', seasonId: 'S', rosterId: 'R', status: { in: ['pending', 'confirmed'] }, playerId: { notIn: [] } }])
  })

  it('a keeper the commissioner rejected stays rejected: saving him again is refused and writes nothing for him', async () => {
    setup('player_chooses')
    m.recordFindMany.mockImplementation(async (args?: { where?: { status?: unknown } }) => (args?.where?.status === 'rejected' ? [{ rosterId: 'R', playerId: 'c' }] : []) as never)
    const out = await submitKeeperSelections('R', 'L', 'S', ['c'])
    expect(out.conflicted).toEqual([{ playerIds: ['c'], reason: 'rejected_by_commissioner' }])
    expect(m.recordUpsert).not.toHaveBeenCalled()
    m.recordFindMany.mockImplementation(async () => [])
  })

  it('counts teams, not saves: one team saving twice is one team; a team that kept nobody counts', async () => {
    setup('player_chooses')
    m.recordFindMany.mockResolvedValue([{ rosterId: 'R' }])
    await submitKeeperSelections('R', 'L', 'S', ['c'])
    await submitKeeperSelections('R', 'L', 'S', ['c'])
    expect(m.sessionUpdateMany.mock.calls.map(([arg]) => arg.data)).toEqual([{ teamsSubmitted: 1 }, { teamsSubmitted: 1 }])

    m.auditFindMany.mockResolvedValue([{ metadata: { rosterId: 'R2' } }, { metadata: { rosterId: 'R' } }, { metadata: null }])
    await submitKeeperSelections('R', 'L', 'S', ['c'])
    expect(m.sessionUpdateMany.mock.calls.at(-1)![0].data).toEqual({ teamsSubmitted: 2 })
  })
})
