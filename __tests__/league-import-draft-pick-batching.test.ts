import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedImportResult } from '@/lib/league-import/types'

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
  rosterFindMany: vi.fn(),
  draftSessionFindUnique: vi.fn(),
  draftPickDeleteMany: vi.fn(),
  draftPickCreateMany: vi.fn(),
  draftSessionUpdate: vi.fn(),
  getOrCreateDraftSession: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique, update: mocks.leagueUpdate },
    roster: { findMany: mocks.rosterFindMany },
    draftSession: { findUnique: mocks.draftSessionFindUnique },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      draftPick: {
        deleteMany: mocks.draftPickDeleteMany,
        createMany: mocks.draftPickCreateMany,
      },
      draftSession: { update: mocks.draftSessionUpdate },
    })),
  },
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  getOrCreateDraftSession: mocks.getOrCreateDraftSession,
}))

vi.mock('@/lib/league-import/LeagueCreationBootstrapService', () => ({
  bootstrapLeagueFromImport: vi.fn(),
}))

vi.mock('@/lib/league-import/ImportedLeagueCommitService', () => ({
  mergeCanonicalBundleIntoLeagueSettingsJson: vi.fn((settings) => settings),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.leagueFindUnique
    .mockResolvedValueOnce({ id: 'league-1', name: 'League', settings: {} })
    .mockResolvedValueOnce({ id: 'league-1', name: 'League' })
  mocks.leagueUpdate.mockResolvedValue({})
  mocks.getOrCreateDraftSession.mockResolvedValue({ session: { id: 'session-1' } })
  mocks.rosterFindMany.mockResolvedValue([
    { id: 'roster-1', platformUserId: 'manager-1' },
    { id: 'roster-2', platformUserId: 'manager-2' },
  ])
  mocks.draftSessionFindUnique.mockResolvedValue({
    id: 'session-1',
    sportType: 'NFL',
    rounds: 1,
    teamCount: 2,
    slotOrder: [],
  })
  mocks.draftPickDeleteMany.mockResolvedValue({ count: 0 })
  mocks.draftPickCreateMany.mockResolvedValue({ count: 2 })
  mocks.draftSessionUpdate.mockResolvedValue({})
})

describe('existing-league draft import batching', () => {
  it('replaces the board with one createMany call inside the transaction', async () => {
    const normalized = {
      source: {
        provider: 'sleeper',
        source_league_id: 'source-1',
        imported_at: '2026-09-19T12:00:00.000Z',
      },
      league: { name: 'League', sport: 'NFL', leagueSize: 2, isDynasty: true },
      rosters: [
        { source_manager_id: 'manager-1', source_team_id: 'team-1', team_name: 'One', owner_name: 'One' },
        { source_manager_id: 'manager-2', source_team_id: 'team-2', team_name: 'Two', owner_name: 'Two' },
      ],
      draft_picks: [
        { pick_no: 1, round: 1, source_roster_id: 'team-1', player_name: 'Player One', position: 'RB', team: 'A', source_player_id: 'p1' },
        { pick_no: 2, round: 1, source_roster_id: 'team-2', player_name: 'Player Two', position: 'WR', team: 'B', source_player_id: 'p2' },
      ],
      scoring: null,
      schedule: [],
      transactions: [],
      standings: [],
      player_map: {},
      coverage: {},
    } as unknown as NormalizedImportResult

    const { applyImportedLeagueToExistingLeague } = await import(
      '@/lib/league-import/LeagueImportToExistingService'
    )
    const result = await applyImportedLeagueToExistingLeague({
      leagueId: 'league-1',
      provider: 'sleeper',
      normalized,
      apply: {
        leagueStructure: false,
        rosters: false,
        scoringRules: false,
        leagueName: false,
        draftPicks: true,
      },
    })

    expect(result.summary).toMatchObject({ draftPicksImported: 2, draftPicksSkipped: 0 })
    expect(mocks.draftPickDeleteMany).toHaveBeenCalledOnce()
    expect(mocks.draftPickCreateMany).toHaveBeenCalledOnce()
    expect(mocks.draftPickCreateMany.mock.calls[0][0].data).toHaveLength(2)
    expect(mocks.draftSessionUpdate).toHaveBeenCalledOnce()
  })
})
