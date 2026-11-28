/**
 * Step 4b of a switching league: the head commissioner's "Make it official" (in season only) and a manager's own
 * "Switch to AllFantasy". lib/league/switching/makeLeagueOfficial.ts, switchTeam.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const db = {
    league: { findUnique: vi.fn(), update: vi.fn() },
    leagueInvite: { findFirst: vi.fn(), create: vi.fn() },
    roster: { findMany: vi.fn(), findFirst: vi.fn() },
    leagueTeam: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  }
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db))
  return {
    db,
    listHeldTeams: vi.fn(),
    resolveActingRoster: vi.fn(),
    currentWeek: vi.fn(),
    copySchedule: vi.fn(),
    writeRoster: vi.fn(),
    layout: vi.fn(),
    nflScoring: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/league/viewerTeams', () => ({ listHeldTeams: h.listHeldTeams, resolveActingRoster: h.resolveActingRoster }))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeekForLeague: h.currentWeek }))
vi.mock('@/lib/league/switching/takeOverSchedule', () => ({ copyPlatformScheduleToAllFantasy: h.copySchedule }))
vi.mock('@/lib/roster-engine/UnifiedRosterConfigService', () => ({ writeLeagueRosterConfig: h.writeRoster }))
vi.mock('@/lib/waiver-defaults/LeagueWaiverBootstrapService', () => ({ bootstrapLeagueWaiverSettings: vi.fn() }))
vi.mock('@/lib/draft-defaults/ensureLeagueSettingsRow', () => ({ ensureLeagueSettingsRow: vi.fn() }))
vi.mock('@/lib/league-creation/canonical/importedNflScoring', () => ({ importedNflScoring: h.nflScoring }))
vi.mock('@/lib/league-creation/canonical/createCanonicalLeagueInTransaction', () => ({ inviteMaxUsesFor: (n: number) => n + 2 }))
vi.mock('@/lib/league/nativeScaffolding', async (orig) => ({
  ...(await orig<typeof import('@/lib/league/nativeScaffolding')>()),
  planImportedRosterLayout: h.layout,
}))

import { isSeasonInProgress, makeLeagueOfficial, planOfficialScoring } from '@/lib/league/switching/makeLeagueOfficial'
import { switchTeamToAllFantasy } from '@/lib/league/switching/switchTeam'

const now = new Date('2026-11-28T12:00:00.000Z')
const baseLeague = {
  id: 'L1', sport: 'NFL', platform: 'sleeper', platformLeagueId: 'p1', status: 'in_season', lifecycleState: null,
  settings: { scoring_settings: { rec: 1 }, switching: { official: null, teams: { 'team-9': { at: 'earlier', byUserId: 'mgr-9' } } } },
  leagueType: 'redraft', taxiSlots: 0, irSlots: 1,
}
const written = () => h.db.league.update.mock.calls[0]?.[0]?.data?.settings as Record<string, any> | undefined

beforeEach(() => {
  vi.clearAllMocks()
  h.db.league.findUnique.mockResolvedValue(baseLeague)
  h.db.leagueInvite.findFirst.mockResolvedValue(null)
  h.db.leagueInvite.create.mockResolvedValue({ token: 'tok-1' })
  h.db.leagueTeam.count.mockResolvedValue(10)
  h.listHeldTeams.mockResolvedValue([{ rosterId: 'legacy-1', redraftRosterId: 'rr-1' }])
  h.db.roster.findMany.mockResolvedValue([{ playerData: { source_team_id: '1' } }])
  h.db.leagueTeam.findMany.mockResolvedValue([{ id: 'team-1' }])
  h.currentWeek.mockResolvedValue({ seasonYear: 2026, week: 12 })
  h.copySchedule.mockResolvedValue({ ok: true, alreadyTaken: false, matchupsCreated: 70, weeksFinal: 11 })
  h.layout.mockReturnValue({ kind: 'mapped', slots: [{ slot: 'QB', count: 1 }] })
  h.nflScoring.mockReturnValue({ rules: [{ statKey: 'rec', points: 1 }], notScored: [], approximated: [], enableTEPremium: false })
})

describe('Make it official', () => {
  it("copies the schedule from this week, stamps the league official, switches the commissioner's team and makes the invite link", async () => {
    const out = await makeLeagueOfficial({ leagueId: 'L1', userId: 'commish', now })

    expect(out).toEqual({ ok: true, alreadyOfficial: false, invitePath: '/join/tok-1', scoring: 'converted', matchupsCreated: 70, weeksFinal: 11, switchedTeams: 2, switchingEnded: false })
    expect(h.copySchedule).toHaveBeenCalledWith('L1', { currentWeek: 12 })
    expect(h.writeRoster).toHaveBeenCalledWith('L1', { templateKey: 'custom', slots: [{ slot: 'QB', count: 1 }] }, { userId: 'commish', auditAction: 'import' })
    const s = written()!
    expect(s.switching.official).toEqual({ at: now.toISOString(), byUserId: 'commish' })
    // The commissioner's team switches; a team that switched earlier keeps its first stamp.
    expect(s.switching.teams).toEqual({ 'team-9': { at: 'earlier', byUserId: 'mgr-9' }, 'team-1': { at: now.toISOString(), byUserId: 'commish' } })
    // The platform's NFL rules become the league's AllFantasy scoring; the rest of settings is kept.
    expect(s.nfl_scoring_config).toMatchObject({ source: 'IMPORTED_MAPPED', rules: [{ statKey: 'rec', points: 1 }] })
    expect(s.scoring_settings).toEqual({ rec: 1 })
    expect(h.db.leagueInvite.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ leagueId: 'L1', maxUses: 12 }) }))
  })

  it('stamps nothing when the schedule cannot be copied', async () => {
    h.copySchedule.mockResolvedValue({ ok: false, reason: '2 teams are not linked to an AllFantasy team yet.' })
    expect(await makeLeagueOfficial({ leagueId: 'L1', userId: 'commish', now })).toEqual({ ok: false, reason: '2 teams are not linked to an AllFantasy team yet.' })
    expect(h.db.league.update).not.toHaveBeenCalled()
  })

  it('is refused out of season, so the in-place switch is the only one offered then', async () => {
    h.db.league.findUnique.mockResolvedValue({ ...baseLeague, status: 'pre_draft' })
    const out = await makeLeagueOfficial({ leagueId: 'L1', userId: 'commish', now })
    expect(out.ok).toBe(false)
    expect(h.copySchedule).not.toHaveBeenCalled()
    expect(isSeasonInProgress({ status: 'in_season' })).toBe(true)
    expect(isSeasonInProgress({ status: 'complete', lifecycleState: 'playoffs' })).toBe(false)
  })

  it("is refused when the commissioner holds no team in the league", async () => {
    h.listHeldTeams.mockResolvedValue([])
    expect((await makeLeagueOfficial({ leagueId: 'L1', userId: 'commish', now })).ok).toBe(false)
    expect(h.copySchedule).not.toHaveBeenCalled()
  })

  it('changes nothing on a league already official, and hands back its invite link', async () => {
    h.db.league.findUnique.mockResolvedValue({ ...baseLeague, settings: { switching: { official: { at: 'x', byUserId: 'commish' }, teams: {} } } })
    h.db.leagueInvite.findFirst.mockResolvedValue({ token: 'tok-old' })
    expect(await makeLeagueOfficial({ leagueId: 'L1', userId: 'commish', now })).toMatchObject({ ok: true, alreadyOfficial: true, invitePath: '/join/tok-old' })
    expect(h.db.league.update).not.toHaveBeenCalled()
    expect(h.copySchedule).not.toHaveBeenCalled()
  })
})

describe('the scoring an official league plays by', () => {
  it("keeps scoring a commissioner saved here, converts the platform's NFL rules, and refuses to fall to defaults", () => {
    const saved = { nfl_scoring_config: { lastUpdatedBy: 'commish', source: 'MANUAL', rules: [] } }
    expect(planOfficialScoring({ sport: 'NFL', settings: saved }, 'u')).toEqual({ ok: true, scoring: 'kept_af', patch: {} })
    expect(planOfficialScoring({ sport: 'NFL', settings: {} }, 'u')).toMatchObject({ ok: true, scoring: 'converted' })
    h.nflScoring.mockReturnValue(null)
    expect(planOfficialScoring({ sport: 'NFL', settings: {} }, 'u').ok).toBe(false)
    expect(planOfficialScoring({ sport: 'NBA', settings: {} }, 'u').ok).toBe(false)
  })
})

describe("a manager's Switch to AllFantasy", () => {
  beforeEach(() => {
    h.resolveActingRoster.mockResolvedValue({ ok: true, rosterId: 'legacy-2', redraftRosterId: 'rr-2', heldCount: 1, viaCoOwner: false })
    h.db.roster.findFirst.mockResolvedValue({ playerData: { source_team_id: '2' } })
    h.db.leagueTeam.findFirst.mockResolvedValue({ id: 'team-2', teamName: 'Owls' })
  })

  it('switches their own team, keeping every other stamp', async () => {
    expect(await switchTeamToAllFantasy({ leagueId: 'L1', userId: 'mgr-2', now })).toEqual({ ok: true, alreadySwitched: false, leagueOfficial: false, teamName: 'Owls', switchingEnded: false })
    expect(written()!.switching.teams).toEqual({ 'team-9': { at: 'earlier', byUserId: 'mgr-9' }, 'team-2': { at: now.toISOString(), byUserId: 'mgr-2' } })
  })

  it('does nothing the second time', async () => {
    h.db.leagueTeam.findFirst.mockResolvedValue({ id: 'team-9', teamName: 'Mob' })
    expect(await switchTeamToAllFantasy({ leagueId: 'L1', userId: 'mgr-9', now })).toMatchObject({ ok: true, alreadySwitched: true })
    expect(h.db.league.update).not.toHaveBeenCalled()
  })

  it("refuses a team that isn't theirs", async () => {
    h.resolveActingRoster.mockResolvedValue({ ok: false, code: 'NOT_YOUR_TEAM', status: 403, message: 'That team is not yours.', rosterIds: [] })
    expect(await switchTeamToAllFantasy({ leagueId: 'L1', userId: 'mgr-2', rosterId: 'legacy-5' })).toEqual({ ok: false, status: 403, reason: 'That team is not yours.' })
    expect(h.db.league.update).not.toHaveBeenCalled()
  })
})
