import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn() },
    draftSession: { findFirst: vi.fn() },
    roster: { findFirst: vi.fn() },
  },
  canViewLeague: vi.fn(),
  isElevatedCommissioner: vi.fn(),
  assertLifecycleActionAllowed: vi.fn(),
  finalizeRosterAssignments: vi.fn(),
  getLeagueDraftTemplatePayload: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/server/services/permissionService', () => ({
  canViewLeague: (...a: unknown[]) => mocks.canViewLeague(...a),
  isElevatedCommissioner: (...a: unknown[]) => mocks.isElevatedCommissioner(...a),
}))

vi.mock('@/server/services/leagueLifecycleService', () => ({
  assertLifecycleActionAllowed: (...a: unknown[]) => mocks.assertLifecycleActionAllowed(...a),
}))

vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({
  finalizeRosterAssignments: (...a: unknown[]) => mocks.finalizeRosterAssignments(...a),
}))

vi.mock('@/lib/league/league-draft-template-payload', () => ({
  getLeagueDraftTemplatePayload: (...a: unknown[]) => mocks.getLeagueDraftTemplatePayload(...a),
}))

const nflRedraftLeague = {
  sport: 'NFL',
  leagueType: 'redraft',
  isDynasty: false,
  leagueVariant: null,
  bestBallMode: false,
  guillotineMode: false,
  keeperPhaseActive: false,
}

describe('syncDraftPicksToRoster', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.canViewLeague.mockResolvedValue(true)
    mocks.isElevatedCommissioner.mockResolvedValue(true)
    mocks.assertLifecycleActionAllowed.mockResolvedValue({ ok: true })
    mocks.getLeagueDraftTemplatePayload.mockResolvedValue({ template: null })
    mocks.finalizeRosterAssignments.mockResolvedValue({
      teamsSynced: 2,
      playersSynced: 30,
      skippedPlayers: 0,
      missingRosterRows: 0,
    })
  })

  it('rejects when actor is missing', async () => {
    const { syncDraftPicksToRoster } = await import('@/lib/league/roster/draft-to-roster-sync')
    const r = await syncDraftPicksToRoster({
      leagueId: 'L1',
      draftId: 'D1',
      actorUserId: null,
    })
    expect(r).toEqual(
      expect.objectContaining({ ok: false, code: 'UNAUTHORIZED' }),
    )
    expect(mocks.finalizeRosterAssignments).not.toHaveBeenCalled()
  })

  it('returns NOT_NFL_REDRAFT_CORE for non–NFL-redraft leagues', async () => {
    mocks.prisma.league.findFirst.mockResolvedValue({
      sport: 'NBA',
      leagueType: 'redraft',
      isDynasty: false,
      leagueVariant: null,
      bestBallMode: false,
      guillotineMode: false,
      keeperPhaseActive: false,
    })
    const { syncDraftPicksToRoster } = await import('@/lib/league/roster/draft-to-roster-sync')
    const r = await syncDraftPicksToRoster({
      leagueId: 'L1',
      draftId: 'D1',
      actorUserId: 'u1',
    })
    expect(r).toMatchObject({ ok: false, code: 'NOT_NFL_REDRAFT_CORE' })
    expect(mocks.finalizeRosterAssignments).not.toHaveBeenCalled()
  })

  it('calls finalizeRosterAssignments for completed NFL redraft session', async () => {
    mocks.prisma.league.findFirst.mockResolvedValue(nflRedraftLeague)
    mocks.prisma.draftSession.findFirst.mockResolvedValue({
      id: 'sess1',
      leagueId: 'L1',
      status: 'completed',
      picks: [
        {
          rosterId: 'r1',
          playerName: 'A',
          position: 'QB',
          playerId: 'p1',
          pickMetadata: null,
          team: 'BUF',
          byeWeek: null,
        },
      ],
    })
    mocks.prisma.roster.findFirst.mockResolvedValue({
      playerData: {
        draftPicks: [],
      },
    })

    const { syncDraftPicksToRoster } = await import('@/lib/league/roster/draft-to-roster-sync')
    const r = await syncDraftPicksToRoster({
      leagueId: 'L1',
      draftId: 'sess1',
      actorUserId: 'comm1',
    })

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.leagueId).toBe('L1')
      expect(r.summary.draftId).toBe('sess1')
      expect(r.summary.playersSynced).toBe(30)
      expect(r.summary.alreadySynced).toBe(false)
    }
    expect(mocks.finalizeRosterAssignments).toHaveBeenCalledWith('L1', 'sess1')
  })

  it('skips finalize when roster already matches session (alreadySynced)', async () => {
    mocks.getLeagueDraftTemplatePayload.mockResolvedValue({ template: null })
    mocks.prisma.league.findFirst.mockResolvedValue(nflRedraftLeague)
    const pick = {
      rosterId: 'r1',
      playerName: 'Test Player',
      position: 'RB',
      playerId: 'pid1',
      pickMetadata: null,
      team: 'DAL',
      byeWeek: null,
    }
    mocks.prisma.draftSession.findFirst.mockResolvedValue({
      id: 'sess1',
      leagueId: 'L1',
      status: 'completed',
      picks: [pick],
    })
    mocks.prisma.roster.findFirst.mockResolvedValue({
      playerData: {
        draftPicks: [
          {
            playerId: 'pid1',
            playerName: 'Test Player',
            position: 'RB',
            team: 'DAL',
          },
        ],
      },
    })

    const { syncDraftPicksToRoster } = await import('@/lib/league/roster/draft-to-roster-sync')
    const r = await syncDraftPicksToRoster({
      leagueId: 'L1',
      draftId: 'sess1',
      actorUserId: 'comm1',
    })

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.alreadySynced).toBe(true)
      expect(r.summary.teamsSynced).toBe(0)
    }
    expect(mocks.finalizeRosterAssignments).not.toHaveBeenCalled()
  })

  it('is idempotent when called twice — second call uses alreadySynced path', async () => {
    mocks.prisma.league.findFirst.mockResolvedValue(nflRedraftLeague)
    const pick = {
      rosterId: 'r1',
      playerName: 'X',
      position: 'WR',
      playerId: 'px',
      pickMetadata: null,
      team: 'NYG',
      byeWeek: null,
    }
    mocks.prisma.draftSession.findFirst.mockResolvedValue({
      id: 'sess1',
      status: 'completed',
      picks: [pick],
    })

    // First run: roster empty → not materialized → finalize called
    mocks.prisma.roster.findFirst.mockResolvedValueOnce({
      playerData: {},
    })
    const { syncDraftPicksToRoster } = await import('@/lib/league/roster/draft-to-roster-sync')
    await syncDraftPicksToRoster({ leagueId: 'L1', draftId: 'sess1', actorUserId: 'c1' })
    expect(mocks.finalizeRosterAssignments).toHaveBeenCalledTimes(1)

    // Second run: roster matches picks → skip finalize
    mocks.prisma.roster.findFirst.mockResolvedValue({
      playerData: {
        draftPicks: [{ playerId: 'px', playerName: 'X', position: 'WR', team: 'NYG' }],
      },
    })
    const r2 = await syncDraftPicksToRoster({ leagueId: 'L1', draftId: 'sess1', actorUserId: 'c1' })
    expect(r2.ok && r2.summary.alreadySynced).toBe(true)
    expect(mocks.finalizeRosterAssignments).toHaveBeenCalledTimes(1)
  })
})
