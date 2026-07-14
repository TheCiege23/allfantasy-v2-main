import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression + contract tests for the schedule-generation path inside
 * finalizeDraftToRedraftSeason.
 *
 * Bug: ensureScheduleForNewSeason queried RedraftRoster with
 *   orderBy: { createdAt: 'asc' }
 * but RedraftRoster has no createdAt column, producing a Prisma runtime error
 * for any real league whose auto-schedule runs after draft finalization.
 * Fixed to orderBy: { id: 'asc' } — cuid is monotonically issued, so the
 * ordering is deterministic and schema-valid.
 *
 * Tests:
 *   1. orderBy regression — findMany must use { id: 'asc' }, never createdAt
 *   2. Schedule rows are created when no schedule exists yet
 *   3. Rerunning finalization does not duplicate rows (idempotent via count check)
 *   4. Schedule creation is skipped when fewer than 2 rosters are present
 */

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  draftSessionFindUnique: vi.fn(),
  redraftSeasonFindFirst: vi.fn(),
  redraftSeasonCreate: vi.fn(),
  redraftSeasonUpdate: vi.fn(),
  redraftRosterFindFirst: vi.fn(),
  redraftRosterCreate: vi.fn(),
  redraftRosterUpdate: vi.fn(),
  redraftRosterFindMany: vi.fn(),
  redraftRosterPlayerFindFirst: vi.fn(),
  redraftRosterPlayerCreate: vi.fn(),
  rosterFindFirst: vi.fn(),
  leagueTeamFindFirst: vi.fn(),
  redraftMatchupCount: vi.fn(),
  redraftMatchupCreateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    draftSession: { findUnique: mocks.draftSessionFindUnique },
    redraftSeason: {
      findFirst: mocks.redraftSeasonFindFirst,
      create: mocks.redraftSeasonCreate,
      update: mocks.redraftSeasonUpdate,
    },
    redraftRoster: {
      findFirst: mocks.redraftRosterFindFirst,
      create: mocks.redraftRosterCreate,
      update: mocks.redraftRosterUpdate,
      findMany: mocks.redraftRosterFindMany,
    },
    redraftRosterPlayer: {
      findFirst: mocks.redraftRosterPlayerFindFirst,
      create: mocks.redraftRosterPlayerCreate,
    },
    roster: { findFirst: mocks.rosterFindFirst },
    leagueTeam: { findFirst: mocks.leagueTeamFindFirst },
    redraftMatchup: {
      count: mocks.redraftMatchupCount,
      createMany: mocks.redraftMatchupCreateMany,
    },
  },
}))

import { syncCompletedDraftToRedraftSeason } from '@/lib/redraft/finalizeDraftToRedraftSeason'

// Two minimal picks across two distinct rosterIds — enough to yield two
// RedraftRosters, which satisfies the ≥2 guard before schedule generation.
const PICKS = [
  {
    id: 'P1', overall: 1, round: 1, rosterId: 'GR1',
    playerId: 'player-1', playerName: 'Alice QB', position: 'QB',
    team: 'KC', byeWeek: 7, pickMetadata: null,
  },
  {
    id: 'P2', overall: 2, round: 1, rosterId: 'GR2',
    playerId: 'player-2', playerName: 'Bob RB', position: 'RB',
    team: 'SF', byeWeek: 9, pickMetadata: null,
  },
]

function setupFinalizePath(opts: { matchupCount?: number; rosterCount?: number } = {}) {
  const matchupCount = opts.matchupCount ?? 0
  const rosterCount = opts.rosterCount ?? 2

  mocks.leagueFindUnique.mockResolvedValue({ id: 'L1', leagueType: 'redraft', isDynasty: false })

  mocks.draftSessionFindUnique.mockResolvedValue({
    id: 'DS1', status: 'completed', sportType: 'NFL', picks: PICKS,
  })

  // Season already exists — skip the create branch and sportConfig lookup.
  mocks.redraftSeasonFindFirst.mockResolvedValue({
    id: 'SEASON1', sport: 'NFL', status: 'active', currentWeek: 1,
    totalWeeks: 14, playoffStartWeek: 14, medianGame: false,
  })

  // Generic roster lookup — one call per unique rosterId (GR1 then GR2).
  mocks.rosterFindFirst
    .mockResolvedValueOnce({ id: 'GR1', platformUserId: 'U1', playerData: null, faabRemaining: 100, waiverPriority: 1 })
    .mockResolvedValueOnce({ id: 'GR2', platformUserId: 'U2', playerData: null, faabRemaining: 100, waiverPriority: 2 })

  // LeagueTeam lookup — one call per rosterId.
  mocks.leagueTeamFindFirst
    .mockResolvedValueOnce({ ownerName: 'Owner 1', teamName: 'Team 1', avatarUrl: null, claimedByUserId: 'U1', platformUserId: 'U1' })
    .mockResolvedValueOnce({ ownerName: 'Owner 2', teamName: 'Team 2', avatarUrl: null, claimedByUserId: 'U2', platformUserId: 'U2' })

  // RedraftRoster.findFirst: existing rosters found → no new creation, but a
  // metadata-refresh update still runs (ownerId matches, so no conflict branch).
  mocks.redraftRosterFindFirst
    .mockResolvedValueOnce({ id: 'RR1', ownerId: 'U1', ownerName: 'Owner 1', teamName: 'Team 1', avatarUrl: null, faabBalance: 100, waiverPriority: 1 })
    .mockResolvedValueOnce({ id: 'RR2', ownerId: 'U2', ownerName: 'Owner 2', teamName: 'Team 2', avatarUrl: null, faabBalance: 100, waiverPriority: 2 })

  mocks.redraftRosterUpdate
    .mockResolvedValueOnce({ id: 'RR1', ownerId: 'U1', ownerName: 'Owner 1', teamName: 'Team 1', avatarUrl: null })
    .mockResolvedValueOnce({ id: 'RR2', ownerId: 'U2', ownerName: 'Owner 2', teamName: 'Team 2', avatarUrl: null })

  // Players already on rosters → skip redraftRosterPlayer.create.
  mocks.redraftRosterPlayerFindFirst
    .mockResolvedValueOnce({ id: 'RRP1' })
    .mockResolvedValueOnce({ id: 'RRP2' })

  // Schedule section
  mocks.redraftMatchupCount.mockResolvedValue(matchupCount)
  mocks.redraftRosterFindMany.mockResolvedValue(
    ['RR1', 'RR2'].slice(0, rosterCount).map((id) => ({ id })),
  )
  mocks.redraftMatchupCreateMany.mockResolvedValue({ count: 14 })
}

describe('draft finalize: schedule generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries RedraftRoster with orderBy { id: asc }, not createdAt', async () => {
    setupFinalizePath()
    await syncCompletedDraftToRedraftSeason('L1')

    expect(mocks.redraftRosterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'asc' } }),
    )
    // Regression pin: createdAt must never appear in the orderBy arg.
    expect(mocks.redraftRosterFindMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: expect.objectContaining({ createdAt: expect.anything() }),
      }),
    )
  })

  it('creates schedule matchups after a completed draft finalization', async () => {
    setupFinalizePath({ matchupCount: 0 })
    const result = await syncCompletedDraftToRedraftSeason('L1')

    expect(result.skipped).toBe(false)
    expect(mocks.redraftMatchupCreateMany).toHaveBeenCalledOnce()

    const [callArgs] = mocks.redraftMatchupCreateMany.mock.calls
    const rows = (callArgs as [{ data: Array<{ seasonId: string; leagueId: string; week: number }> }])[0].data
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]!.seasonId).toBe('SEASON1')
    expect(rows[0]!.leagueId).toBe('L1')
    expect(typeof rows[0]!.week).toBe('number')
  })

  it('does not duplicate schedule rows when matchups already exist (idempotent)', async () => {
    // Simulate a previous run that already created 14 matchups.
    setupFinalizePath({ matchupCount: 14 })
    await syncCompletedDraftToRedraftSeason('L1')

    expect(mocks.redraftMatchupCreateMany).not.toHaveBeenCalled()
    // findMany is also skipped — we short-circuit before roster ordering.
    expect(mocks.redraftRosterFindMany).not.toHaveBeenCalled()
  })

  it('skips schedule creation when fewer than 2 rosters are present', async () => {
    setupFinalizePath({ matchupCount: 0, rosterCount: 1 })
    await syncCompletedDraftToRedraftSeason('L1')

    expect(mocks.redraftMatchupCreateMany).not.toHaveBeenCalled()
  })
})
