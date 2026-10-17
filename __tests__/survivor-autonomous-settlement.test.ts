import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  survivorTribalCouncil: { findUnique: vi.fn(), update: vi.fn() },
  survivorWeeklyScore: { findMany: vi.fn() },
  survivorGameState: { findUnique: vi.fn() },
  survivorAuditEntry: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/survivorCouncilService', () => ({ loadCouncilContext: vi.fn() }))

import { loadCouncilContext } from '@/lib/survivor/survivorCouncilService'
import { chooseAutonomousCouncilTarget, resolveAutonomousCouncil } from '@/lib/survivor/survivorAutonomousCouncil'
import { verifiedSlateWinners } from '@/lib/survivor/survivorVerifiedSlateChallenges'

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async fn => fn(db))
  db.survivorGameState.findUnique.mockResolvedValue({ immunePlayerId: null })
})

describe('autonomous council fallback', () => {
  it('chooses the lowest verified score among tied vote targets', () => {
    const scores = [{ userId: 'a', finalScore: 120, isFinalized: true }, { userId: 'b', finalScore: 80, isFinalized: true }, { userId: 'c', finalScore: 10, isFinalized: true }]
    expect(chooseAutonomousCouncilTarget('council', ['a', 'b'], scores)?.userId).toBe('b')
  })

  it('uses a reproducible draw on exact score ties regardless of query order', () => {
    const scores = [{ userId: 'a', finalScore: 80, isFinalized: true }, { userId: 'b', finalScore: 80, isFinalized: true }]
    const first = chooseAutonomousCouncilTarget('council', ['b', 'a'], scores)
    expect(first?.method).toBe('lowest_score_seeded_draw')
    expect(chooseAutonomousCouncilTarget('council', ['a', 'b'], [...scores].reverse())).toEqual(first)
  })

  it('blocks missing or unfinalized target scores', () => {
    expect(chooseAutonomousCouncilTarget('council', ['a', 'b'], [{ userId: 'a', finalScore: 0, isFinalized: true }])).toBeNull()
    expect(chooseAutonomousCouncilTarget('council', ['a'], [{ userId: 'a', finalScore: 0, isFinalized: false }])).toBeNull()
  })

  it('resolves an empty planned council without a commissioner action and keeps the decision sealed', async () => {
    vi.mocked(loadCouncilContext).mockResolvedValue({
      council: { idolsPlayed: [] }, eligibility: { targetUserIds: ['a', 'b'] }, userToRoster: { a: 'ra', b: 'rb' },
      scopePlayers: [{ userId: 'a', rosterId: 'ra', displayName: 'A' }, { userId: 'b', rosterId: 'rb', displayName: 'B' }],
    } as never)
    db.survivorTribalCouncil.findUnique.mockResolvedValue({ id: 'c', week: 4, status: 'closed', isRevealed: false, eliminatedUserId: null, isTie: false, revealSequence: [] })
    db.survivorWeeklyScore.findMany.mockResolvedValue([
      { userId: 'a', finalScore: 40, isFinalized: true, wonIndividualImmunity: false },
      { userId: 'b', finalScore: 60, isFinalized: true, wonIndividualImmunity: false },
    ])
    await resolveAutonomousCouncil('league', 'c')
    expect(db.survivorTribalCouncil.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eliminatedUserId: 'a', tiePhase: 'system_score_fallback', isTie: false }) }))
    expect(db.survivorAuditEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isVisibleToCommissioner: false, isVisibleToPublic: false }) }))
  })

  it('never selects the verified individual immunity winner for a no-ballot fallback', async () => {
    vi.mocked(loadCouncilContext).mockResolvedValue({ council: { idolsPlayed: [] }, eligibility: { targetUserIds: ['a', 'b'] }, userToRoster: { a: 'ra', b: 'rb' }, scopePlayers: [{ userId: 'a', rosterId: 'ra', displayName: 'A' }, { userId: 'b', rosterId: 'rb', displayName: 'B' }] } as never)
    db.survivorTribalCouncil.findUnique.mockResolvedValue({ id: 'c', week: 4, status: 'closed', isRevealed: false, eliminatedUserId: null, isTie: false, revealSequence: [] })
    db.survivorGameState.findUnique.mockResolvedValue({ immunePlayerId: 'a' })
    db.survivorWeeklyScore.findMany.mockResolvedValue([{ userId: 'a', finalScore: 5, isFinalized: true, wonIndividualImmunity: false }, { userId: 'b', finalScore: 60, isFinalized: true, wonIndividualImmunity: false }])
    await resolveAutonomousCouncil('league', 'c')
    expect(db.survivorTribalCouncil.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eliminatedUserId: 'b' }) }))
  })
})

describe('verified NBA/NHL slate result', () => {
  it('settles both the tribe aggregate and individual score from the same final rows', () => {
    const rows = [
      { userId: 'a', tribeId: 'east', finalScore: 50, isFinalized: true, countedTowardTribeTotal: true },
      { userId: 'b', tribeId: 'east', finalScore: 40, isFinalized: true, countedTowardTribeTotal: true },
      { userId: 'c', tribeId: 'west', finalScore: 80, isFinalized: true, countedTowardTribeTotal: true },
    ]
    expect(verifiedSlateWinners(rows)).toEqual({ individualUserId: 'c', individualPoints: 80, tribeId: 'east', tribePoints: 90 })
    expect(verifiedSlateWinners([{ ...rows[0], isFinalized: false }, ...rows.slice(1)])).toBeNull()
  })

  it('keeps tied slate results stable across provider row order', () => {
    const rows = [
      { userId: 'b', tribeId: 'west', finalScore: 50, isFinalized: true, countedTowardTribeTotal: true },
      { userId: 'a', tribeId: 'east', finalScore: 50, isFinalized: true, countedTowardTribeTotal: true },
    ]
    expect(verifiedSlateWinners(rows)).toEqual(verifiedSlateWinners([...rows].reverse()))
    expect(verifiedSlateWinners(rows)?.individualUserId).toBe('a')
    expect(verifiedSlateWinners(rows)?.tribeId).toBe('east')
  })
})
