import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 `executeSeasonCarryover` HAD ZERO CALLERS, AND SO DID `triggerKeeperOffseason`.
 *
 * A manager could submit keeper selections, a commissioner could lock them, and
 * nothing would ever copy a kept player onto next season's roster — the season
 * genuinely had nowhere to carry over TO, because nothing in the live app ever
 * created a "next" RedraftSeason either (the only service that did,
 * `lib/redraft/renewal/createNextSeason.ts`, existed only on an unmerged rescue
 * branch, never on main).
 *
 * These tests pin the three fixes: `ensureNextRedraftSeasonShell` creates the
 * next season's roster shells when none exist, `triggerKeeperOffseason` calls
 * it instead of silently returning, and `lockKeeperSelections` fires
 * `executeSeasonCarryover` exactly once per lock (never twice, since carryover
 * creates roster-player rows rather than upserting them).
 */

const {
  mockRedraftSeasonFindFirst,
  mockRedraftSeasonFindUnique,
  mockLeagueFindFirst,
  mockTxRedraftSeasonCreate,
  mockTxRedraftRosterCreate,
  mockTxRedraftMatchupCreate,
  mockTxLeagueUpdate,
  mockTransaction,
  mockKeeperSelectionSessionFindFirst,
  mockKeeperSelectionSessionUpdate,
  mockKeeperRecordUpdateMany,
  mockLeagueUpdate,
  mockExecuteSeasonCarryover,
  mockGenerateSchedule,
} = vi.hoisted(() => ({
  mockRedraftSeasonFindFirst: vi.fn(),
  mockRedraftSeasonFindUnique: vi.fn(),
  mockLeagueFindFirst: vi.fn(),
  mockTxRedraftSeasonCreate: vi.fn(),
  mockTxRedraftRosterCreate: vi.fn(),
  mockTxRedraftMatchupCreate: vi.fn(),
  mockTxLeagueUpdate: vi.fn(),
  mockTransaction: vi.fn(),
  mockKeeperSelectionSessionFindFirst: vi.fn(),
  mockKeeperSelectionSessionUpdate: vi.fn(),
  mockKeeperRecordUpdateMany: vi.fn(),
  mockLeagueUpdate: vi.fn(),
  mockExecuteSeasonCarryover: vi.fn(),
  mockGenerateSchedule: vi.fn(() => [{ week: 1, home: 'r1', away: 'r2', type: 'regular', sport: 'nfl' }]),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: mockRedraftSeasonFindFirst, findUnique: mockRedraftSeasonFindUnique },
    league: { findFirst: mockLeagueFindFirst, update: mockLeagueUpdate },
    $transaction: mockTransaction,
    keeperSelectionSession: { findFirst: mockKeeperSelectionSessionFindFirst, update: mockKeeperSelectionSessionUpdate },
    keeperRecord: { updateMany: mockKeeperRecordUpdateMany },
  },
}))

vi.mock('@/lib/redraft/scheduleEngine', () => ({
  generateSchedule: mockGenerateSchedule,
}))

vi.mock('@/lib/keeper/carryoverEngine', () => ({
  executeSeasonCarryover: mockExecuteSeasonCarryover,
}))

vi.mock('@/lib/keeper/eligibilityEngine', () => ({
  computeKeeperEligibility: vi.fn(),
}))

import { ensureNextRedraftSeasonShell } from '@/lib/redraft/offseason/ensureNextRedraftSeasonShell'
import { lockKeeperSelections } from '@/lib/keeper/selectionEngine'

beforeEach(() => {
  vi.clearAllMocks()
  mockExecuteSeasonCarryover.mockResolvedValue({ totalKept: 0, byTeam: [] })
})

describe('ensureNextRedraftSeasonShell', () => {
  it('returns an already-existing next season without creating anything', async () => {
    mockRedraftSeasonFindFirst.mockResolvedValueOnce({ id: 'season-2', season: 2025 })

    const result = await ensureNextRedraftSeasonShell('league-1', 'season-1')

    expect(result).toEqual({ id: 'season-2', season: 2025 })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('creates the next season, roster shells (ownership preserved), schedule, and bumps League.season when none exists', async () => {
    mockRedraftSeasonFindFirst.mockResolvedValueOnce(null)
    mockRedraftSeasonFindUnique.mockResolvedValueOnce({
      sport: 'nfl',
      season: 2024,
      totalWeeks: 17,
      playoffStartWeek: 15,
      medianGame: false,
    })
    mockLeagueFindFirst.mockResolvedValueOnce({
      id: 'league-1',
      userId: 'commish-1',
      teams: [
        { claimedByUserId: 'user-a', ownerName: 'A', teamName: 'Team A', avatarUrl: null },
        { claimedByUserId: null, ownerName: 'B (commish)', teamName: 'Team B', avatarUrl: null },
      ],
    })
    mockTxRedraftSeasonCreate.mockResolvedValueOnce({ id: 'season-2' })
    mockTxRedraftRosterCreate.mockResolvedValueOnce({ id: 'r1' }).mockResolvedValueOnce({ id: 'r2' })
    mockTransaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) =>
      cb({
        redraftSeason: { create: mockTxRedraftSeasonCreate },
        redraftRoster: { create: mockTxRedraftRosterCreate },
        redraftMatchup: { create: mockTxRedraftMatchupCreate },
        league: { update: mockTxLeagueUpdate },
      }),
    )

    const result = await ensureNextRedraftSeasonShell('league-1', 'season-1')

    expect(result).toEqual({ id: 'season-2', season: 2025 })
    expect(mockTxRedraftSeasonCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ leagueId: 'league-1', season: 2025, status: 'setup', sport: 'nfl' }),
    })
    expect(mockTxRedraftRosterCreate).toHaveBeenCalledTimes(2)
    expect(mockTxRedraftRosterCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ seasonId: 'season-2', ownerId: 'user-a' }),
    })
    // Unclaimed team falls back to the league owner, preserving the same
    // ownership rule the (frontend-uncalled) POST /api/redraft/season route uses.
    expect(mockTxRedraftRosterCreate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ seasonId: 'season-2', ownerId: 'commish-1' }),
    })
    expect(mockTxLeagueUpdate).toHaveBeenCalledWith({ where: { id: 'league-1' }, data: { season: 2025 } })
  })
})

describe('lockKeeperSelections — carryover wiring', () => {
  it('fires executeSeasonCarryover exactly once when locking an open session', async () => {
    mockKeeperSelectionSessionFindFirst.mockResolvedValueOnce({
      id: 'sess-1',
      leagueId: 'league-1',
      seasonId: 'season-2',
      status: 'open',
    })
    mockRedraftSeasonFindFirst.mockResolvedValueOnce({ id: 'season-1' })

    await lockKeeperSelections('league-1', 'sess-1')

    expect(mockExecuteSeasonCarryover).toHaveBeenCalledTimes(1)
    expect(mockExecuteSeasonCarryover).toHaveBeenCalledWith('league-1', 'season-1', 'season-2')
  })

  it('does not re-fire carryover when the session was already locked (duplicate-row guard)', async () => {
    mockKeeperSelectionSessionFindFirst.mockResolvedValueOnce({
      id: 'sess-1',
      leagueId: 'league-1',
      seasonId: 'season-2',
      status: 'locked',
    })

    await lockKeeperSelections('league-1', 'sess-1')

    expect(mockExecuteSeasonCarryover).not.toHaveBeenCalled()
    // No outgoing-season lookup should even be attempted once already locked.
    expect(mockRedraftSeasonFindFirst).not.toHaveBeenCalled()
  })

  it('does not throw when carryover fails — locking must still succeed', async () => {
    mockKeeperSelectionSessionFindFirst.mockResolvedValueOnce({
      id: 'sess-1',
      leagueId: 'league-1',
      seasonId: 'season-2',
      status: 'open',
    })
    mockRedraftSeasonFindFirst.mockResolvedValueOnce({ id: 'season-1' })
    mockExecuteSeasonCarryover.mockRejectedValueOnce(new Error('boom'))

    await expect(lockKeeperSelections('league-1', 'sess-1')).resolves.toBeUndefined()
    expect(mockKeeperSelectionSessionUpdate).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: expect.objectContaining({ status: 'locked' }),
    })
  })
})
