/**
 * `lib/sleeper-sync.ts` — the OTHER legacy writer, behind `/api/league/sleeper-sync`.
 *
 * ⚠ IT HAS NO CALLER TODAY, AND THAT IS NOT A REASON TO LEAVE IT KEYED BY OWNER. The route is live
 * and authenticated; only the UI has stopped calling it (verified: no fetch of that path anywhere in
 * app/, components/, lib/ or the test tree). A caller added tomorrow would write the ghost rows
 * `importedRosterIdentity.ts` exists to prevent — 33 of them were deleted from production on
 * 2026-09-17 — so the row lookup is made team-first here exactly as it is in the live legacy path.
 *
 * The suite drives the real `syncSleeperLeague` with the provider stubbed and Prisma doubled, so it
 * exercises the lookup itself rather than a copy of its rule.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rosterFindMany: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterUpdate: vi.fn(),
  rosterCreate: vi.fn(),
  leagueUpsert: vi.fn(),
  leagueCreate: vi.fn(),
  leagueUpdate: vi.fn(),
  leagueFindFirst: vi.fn(),
  leagueFindUnique: vi.fn(),
  sleeperLeagueUpsert: vi.fn(),
  sleeperRosterUpsert: vi.fn(),
  leagueTeamFindMany: vi.fn(),
  leagueTeamUpsert: vi.fn(),
  leagueTeamUpdate: vi.fn(),
  cacheFindFirst: vi.fn(),
  cacheUpsert: vi.fn(),
  appUserFindMany: vi.fn(),
  userProfileFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: {
      findMany: h.rosterFindMany,
      findFirst: h.rosterFindFirst,
      update: h.rosterUpdate,
      create: h.rosterCreate,
    },
    league: {
      upsert: h.leagueUpsert,
      create: h.leagueCreate,
      update: h.leagueUpdate,
      findFirst: h.leagueFindFirst,
      findUnique: h.leagueFindUnique,
    },
    sleeperLeague: { upsert: h.sleeperLeagueUpsert },
    sleeperRoster: { upsert: h.sleeperRosterUpsert },
    leagueTeam: {
      findMany: h.leagueTeamFindMany,
      upsert: h.leagueTeamUpsert,
      update: h.leagueTeamUpdate,
    },
    sportsDataCache: { findFirst: h.cacheFindFirst, upsert: h.cacheUpsert },
    appUser: { findMany: h.appUserFindMany },
    userProfile: { findMany: h.userProfileFindMany },
  },
}))
vi.mock('@/lib/league-delete/leagueTombstones', () => ({
  isLeagueTombstoned: async () => false,
  LeagueDeletedByUserError: class extends Error {},
}))

import { syncSleeperLeague } from '@/lib/sleeper-sync'

const OLD_MANAGER = '111111111111111111'
const NEW_MANAGER = '222222222222222222'

const respond = (rosters: unknown[]) => (url: string) => {
  if (url.endsWith('/rosters')) return { ok: true, json: async () => rosters }
  if (url.endsWith('/users')) return { ok: true, json: async () => [] }
  return {
    ok: true,
    json: async () => ({
      name: 'A League',
      total_rosters: 12,
      season: '2026',
      sport: 'nfl',
      settings: {},
      scoring_settings: {},
      status: 'in_season',
    }),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  const leagueRow = { id: 'L1', name: 'A League', totalTeams: 12, scoringType: 'ppr', isDynasty: false }
  h.leagueFindFirst.mockResolvedValue(null)
  h.leagueFindUnique.mockResolvedValue(null)
  h.leagueUpsert.mockResolvedValue(leagueRow)
  h.leagueCreate.mockResolvedValue(leagueRow)
  h.leagueUpdate.mockResolvedValue(leagueRow)
  h.sleeperLeagueUpsert.mockResolvedValue({ id: 'SL1', name: 'A League', totalTeams: 12, scoringType: 'ppr' })
  h.sleeperRosterUpsert.mockResolvedValue({})
  h.leagueTeamFindMany.mockResolvedValue([])
  h.leagueTeamUpsert.mockResolvedValue({ id: 'team-7' })
  h.leagueTeamUpdate.mockResolvedValue({})
  h.rosterFindMany.mockResolvedValue([])
  h.rosterFindFirst.mockResolvedValue(null)
  h.rosterUpdate.mockResolvedValue({})
  h.rosterCreate.mockResolvedValue({})
  h.cacheFindFirst.mockResolvedValue(null)
  h.cacheUpsert.mockResolvedValue({})
  h.appUserFindMany.mockResolvedValue([])
  h.userProfileFindMany.mockResolvedValue([])
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      respond([{ roster_id: 7, owner_id: NEW_MANAGER, players: ['4034'], starters: ['4034'], settings: {} }])(
        String(url),
      ),
    ),
  )
})

describe('the legacy Sleeper sync finds a team by its team id', () => {
  it('🛑 updates the team row whose manager has changed, instead of creating a second one', async () => {
    h.rosterFindMany.mockResolvedValue([
      { id: 'existing-row', playerData: { players: ['old'], source_team_id: '7' } },
    ])

    await syncSleeperLeague('999', 'u1')

    expect(h.rosterUpdate).toHaveBeenCalledTimes(1)
    expect(h.rosterUpdate.mock.calls[0][0].where).toEqual({ id: 'existing-row' })
    expect(h.rosterCreate).not.toHaveBeenCalled()
  })

  it('🛑 refuses to choose when two rows carry the same team id, and falls back to the manager', async () => {
    h.rosterFindMany.mockResolvedValue([
      { id: 'a', playerData: { source_team_id: '7' } },
      { id: 'b', playerData: { source_team_id: '7' } },
    ])
    h.rosterFindFirst.mockResolvedValue({ id: 'by-manager' })

    await syncSleeperLeague('999', 'u1')

    expect(h.rosterFindFirst).toHaveBeenCalledTimes(1)
    expect(h.rosterUpdate.mock.calls[0][0].where).toEqual({ id: 'by-manager' })
  })

  it('falls back to the manager lookup when no row carries this team id', async () => {
    h.rosterFindMany.mockResolvedValue([{ id: 'other', playerData: { source_team_id: '9' } }])
    h.rosterFindFirst.mockResolvedValue(null)

    await syncSleeperLeague('999', 'u1')

    expect(h.rosterFindFirst).toHaveBeenCalledTimes(1)
    expect(h.rosterCreate).toHaveBeenCalledTimes(1)
  })

  it('still stamps the team id on what it writes, so the next run can find this row', async () => {
    h.rosterFindMany.mockResolvedValue([])
    await syncSleeperLeague('999', 'u1')
    expect(h.rosterCreate.mock.calls[0][0].data.playerData).toMatchObject({ source_team_id: '7' })
  })
})
