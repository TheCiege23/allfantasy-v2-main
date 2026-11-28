/**
 * Step 4a of a switching league: once official, the Matchup screens read AllFantasy's schedule (copied in at
 * "Make it official", lib/league/switching/takeOverSchedule.ts), find the viewer's team through their
 * `Roster`, and a team that has not switched cannot have its lineup changed here, since the next copy from
 * the old platform would replace it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  rosterFindFirst: vi.fn(),
  leagueTeamFindFirst: vi.fn(),
  seasonFindMany: vi.fn(),
  resolveViewingRoster: vi.fn(),
  template: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    roster: { findFirst: h.rosterFindFirst },
    leagueTeam: { findFirst: h.leagueTeamFindFirst },
    redraftSeason: { findMany: h.seasonFindMany },
  },
}))
vi.mock('@/lib/league/viewerTeams', () => ({ resolveViewingRoster: h.resolveViewingRoster }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: vi.fn(async () => false) }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: h.template }))

import { loadNativeMatchupSeason, viewerSeasonRosterId } from '@/server/services/nativeMatchupCenter'
import { mirroredTeamOfRoster } from '@/lib/league/switching/switchedTeamsServer'
import { TEAM_NOT_SWITCHED_CODE } from '@/lib/league/switching/switchingLeague'
import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'

const stamp = { at: '2026-11-27T00:00:00.000Z', byUserId: 'commish' }
const official = { switching: { official: stamp, teams: { 'team-1': stamp } } }
const notOfficial = { switching: { official: null, teams: { 'team-1': stamp } } }

const leagueRow = (platform: string, settings: unknown) => ({ id: 'L1', season: 2026, sport: 'NFL', settings, leagueVariant: null, platform })
const roster = (id: string, ownerId: string) => ({ id, ownerId, managerUserId: null, ownerName: '', teamName: id, avatarUrl: null, wins: 0, losses: 0, ties: 0 })
const season = { id: 's1', season: 2026, currentWeek: 12, playoffStartWeek: 15, rosters: [roster('rr-1', 'sleeper-user-1'), roster('rr-2', 'sleeper-user-2')] }

beforeEach(() => vi.resetAllMocks())

describe('the Matchup screens read AllFantasy for an official league', () => {
  it('reads the AllFantasy season for an official imported league and a native one, never for one not official', async () => {
    h.seasonFindMany.mockResolvedValue([season])
    expect(await loadNativeMatchupSeason(leagueRow('sleeper', notOfficial))).toBeNull()
    expect(await loadNativeMatchupSeason(leagueRow('sleeper', null))).toBeNull()
    expect(h.seasonFindMany).not.toHaveBeenCalled()

    expect((await loadNativeMatchupSeason(leagueRow('sleeper', official)))?.id).toBe('s1')
    expect((await loadNativeMatchupSeason(leagueRow('allfantasy', null)))?.id).toBe('s1')
  })

  it("finds the viewer's team through their Roster in an imported league, where the team names the platform's user", async () => {
    h.resolveViewingRoster.mockResolvedValue({ rosterId: 'legacy-2', redraftRosterId: 'rr-2', heldCount: 1 })
    expect(await viewerSeasonRosterId(leagueRow('sleeper', official), season, 'af-user')).toBe('rr-2')
    // Control: the owner match alone finds nothing for this viewer.
    h.resolveViewingRoster.mockResolvedValue(null)
    expect(await viewerSeasonRosterId(leagueRow('sleeper', official), season, 'af-user')).toBeNull()
  })

  it('keeps the owner match for a native league, without the Roster read', async () => {
    expect(await viewerSeasonRosterId(leagueRow('allfantasy', null), season, 'sleeper-user-1')).toBe('rr-1')
    expect(h.resolveViewingRoster).not.toHaveBeenCalled()
  })
})

describe('a team that has not switched keeps its lineup on the old platform', () => {
  it('names the team when the league is official and it has not switched, and nothing otherwise', async () => {
    h.leagueTeamFindFirst.mockImplementation(async ({ where }: { where: { externalId: string } }) =>
      where.externalId === '1' ? { id: 'team-1', teamName: 'Switched' } : { id: 'team-2', teamName: 'Still on Sleeper' })

    expect(await mirroredTeamOfRoster('L1', official, { source_team_id: '2' })).toEqual({ name: 'Still on Sleeper' })
    expect(await mirroredTeamOfRoster('L1', official, { source_team_id: '1' })).toBeNull()
    // A roster whose team cannot be found is read as not switched.
    expect(await mirroredTeamOfRoster('L1', official, {})).toEqual({ name: 'This team' })

    h.leagueTeamFindFirst.mockClear()
    expect(await mirroredTeamOfRoster('L1', notOfficial, { source_team_id: '2' })).toBeNull()
    expect(h.leagueTeamFindFirst).not.toHaveBeenCalled()
  })

  const save = (source: 'user_save' | 'commissioner_override' | 'import' | 'system') =>
    persistRosterLineupWithEngine({ leagueId: 'L1', rosterId: 'legacy-2', actorUserId: 'u', nextPlayerData: {}, season: 2026, week: 12, source })

  beforeEach(() => {
    h.leagueFindUnique.mockResolvedValue({ id: 'L1', sport: 'NFL', platform: 'sleeper', settings: official, bestBallMode: false, guillotineMode: false })
    h.rosterFindFirst.mockResolvedValue({ id: 'legacy-2', leagueId: 'L1', playerData: { source_team_id: '2' } })
    // Reaching the template read means the save got past the switching gate.
    h.template.mockRejectedValue(new Error('past the gate'))
  })

  it("refuses every lineup save for that team, the manager's, the commissioner's and an automation's", async () => {
    h.leagueTeamFindFirst.mockResolvedValue({ id: 'team-2', teamName: 'Still on Sleeper' })
    for (const source of ['user_save', 'commissioner_override', 'system'] as const) {
      const out = await save(source)
      expect(out).toMatchObject({ ok: false, status: 409, code: TEAM_NOT_SWITCHED_CODE })
      expect(out.ok === false && out.error).toBe("Still on Sleeper hasn't switched to AllFantasy yet, so its lineup is set on Sleeper. AllFantasy copies it from there.")
    }
    expect(h.template).not.toHaveBeenCalled()
  })

  it("lets the copy from the old platform write it, and lets a switched team save", async () => {
    h.leagueTeamFindFirst.mockResolvedValue({ id: 'team-2', teamName: 'Still on Sleeper' })
    expect(await save('import')).not.toMatchObject({ code: TEAM_NOT_SWITCHED_CODE })

    h.leagueTeamFindFirst.mockResolvedValue({ id: 'team-1', teamName: 'Switched' })
    expect(await save('user_save')).not.toMatchObject({ code: TEAM_NOT_SWITCHED_CODE })
    expect(h.template).toHaveBeenCalledTimes(2)
  })

  it('changes nothing before the league is official', async () => {
    h.leagueFindUnique.mockResolvedValue({ id: 'L1', sport: 'NFL', platform: 'sleeper', settings: notOfficial, bestBallMode: false, guillotineMode: false })
    expect(await save('user_save')).not.toMatchObject({ code: TEAM_NOT_SWITCHED_CODE })
    expect(h.leagueTeamFindFirst).not.toHaveBeenCalled()
  })
})
