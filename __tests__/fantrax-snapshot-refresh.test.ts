import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), userUpsert: vi.fn(),
  info: vi.fn(), rosters: vi.fn(), standings: vi.fn(), players: vi.fn(), schedule: vi.fn(), draft: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  fantraxLeague: { findUnique: h.findUnique, updateMany: h.updateMany, upsert: h.upsert },
  fantraxUser: { upsert: h.userUpsert },
} }))
vi.mock('@/lib/league-import/fantrax/fantraxApi', async (original) => ({
  ...await original<object>(),
  getFantraxLeagueInfo: h.info, getFantraxTeamRosters: h.rosters,
  getFantraxStandings: h.standings, getFantraxPlayerIds: h.players,
  fetchFantraxScheduleWithScores: h.schedule, getFantraxDraftResults: h.draft,
}))
import { importFantraxLeague } from '@/lib/league-import/fantrax/importFantraxLeague'
const args = { leagueId: 'vendor-id', teamName: 'My team', appUserId: 'owner', refreshSnapshotId: 'stable-uuid' }

beforeEach(() => {
  vi.resetAllMocks()
  h.findUnique.mockResolvedValue({ id: 'stable-uuid', appUserId: 'owner', sourceLeagueId: 'vendor-id', season: 2026 })
  h.updateMany.mockResolvedValue({ count: 1 })
  h.info.mockResolvedValue({ ok: true, data: { leagueName: 'Renamed league', seasonYear: 2026, rosterInfo: {} } })
  h.rosters.mockResolvedValue({ ok: true, data: { team1: { teamName: 'My team', rosterItems: [
    { id: 'new-qb', position: 'SFX', status: 'ACTIVE' },
    { id: 'unknown-reserve', position: 'RB', status: 'RESERVE' },
  ] } } })
  h.players.mockImplementation(async (sport: string) => ({ ok: true, data: sport === 'CFB'
    ? { 'new-qb': { name: 'Current Quarterback', position: 'QB', team: 'School' } } : {} }))
  h.standings.mockResolvedValue({ ok: true, data: [] })
  h.schedule.mockResolvedValue({ rows: [], currentPeriod: null, periodsRead: [], periodsFailed: [] })
  h.draft.mockResolvedValue(null)
})

describe('Fantrax snapshot refresh', () => {
  it('replaces stale rosters in the same owned UUID and preserves unnamed source reserves', async () => {
    const outcome = await importFantraxLeague(args)
    expect(outcome).toMatchObject({ ok: true, fantraxLeagueId: 'stable-uuid', leagueName: 'Renamed league' })
    const write = h.updateMany.mock.calls[0][0]
    expect(write.where).toEqual({ id: 'stable-uuid', appUserId: 'owner', sourceLeagueId: 'vendor-id', season: 2026 })
    expect(write.data.roster.map((p: { fantraxId: string }) => p.fantraxId)).toEqual(['new-qb', 'unknown-reserve'])
    expect(write.data.roster[0]).toMatchObject({ name: 'Current Quarterback', position: 'SFX', primaryPosition: 'QB' })
    expect(h.upsert).not.toHaveBeenCalled()
    expect(h.userUpsert).not.toHaveBeenCalled()
  })
  it.each([
    { appUserId: 'other', sourceLeagueId: 'vendor-id' },
    { appUserId: null, sourceLeagueId: 'vendor-id' },
    { appUserId: 'owner', sourceLeagueId: 'different' },
  ])('rejects an unowned or mismatched snapshot before contacting Fantrax: %j', async (record) => {
    h.findUnique.mockResolvedValue({ id: 'stable-uuid', season: 2026, ...record })
    expect(await importFantraxLeague(args)).toMatchObject({ ok: false })
    expect(h.info).not.toHaveBeenCalled()
    expect(h.updateMany).not.toHaveBeenCalled()
  })
  it.each([2027, undefined])('refuses to overwrite a historical snapshot with season %s', async (seasonYear) => {
    h.info.mockResolvedValue({ ok: true, data: { seasonYear } })
    expect(await importFantraxLeague(args)).toMatchObject({ ok: false, kind: 'unavailable' })
    expect(h.rosters).not.toHaveBeenCalled()
    expect(h.updateMany).not.toHaveBeenCalled()
  })
  it('fails without writing when the provider is unavailable', async () => {
    h.rosters.mockResolvedValue({ ok: false, failure: { kind: 'unavailable', message: 'Try later' } })
    expect(await importFantraxLeague(args)).toMatchObject({ ok: false, kind: 'unavailable' })
    expect(h.updateMany).not.toHaveBeenCalled()
  })
  it('fails if ownership changes during the provider read', async () => {
    h.updateMany.mockResolvedValue({ count: 0 })
    expect(await importFantraxLeague(args)).toMatchObject({ ok: false, kind: 'unavailable' })
    expect(h.upsert).not.toHaveBeenCalled()
  })
})

it('retains an owned reserve name omitted from the current directory on a live refresh', async () => {
  h.findUnique.mockResolvedValue({ id: 'stable-uuid', appUserId: 'owner', sourceLeagueId: 'vendor-id', season: 2026, sport: 'cfb', roster: [{ fantraxId: 'unknown-reserve', name: 'Archived Reserve', primaryPosition: 'RB' }] })
  expect(await importFantraxLeague(args)).toMatchObject({ ok: true })
  expect(h.updateMany.mock.calls[0][0].data.roster[1]).toMatchObject({ fantraxId: 'unknown-reserve', name: 'Archived Reserve', primaryPosition: 'RB', status: 'RESERVE', team: '' })
})

/*
 * A manager renamed their team on Fantrax between two refreshes. The snapshot stores the OLD
 * name as `userTeam`, and the refresh used to look the team up by that name alone — so it
 * failed with "no team named …" forever, and the league stopped refreshing.
 */
describe('Fantrax refresh after a team rename', () => {
  const snapshotWithTeamId = {
    id: 'stable-uuid', appUserId: 'owner', sourceLeagueId: 'vendor-id', season: 2026,
    userTeam: 'My team',
    standings: [
      { team: 'My team', fantraxTeamId: 'team1' },
      { team: 'Rival', fantraxTeamId: 'team2' },
    ],
  }

  it('finds the importer\'s team by its stored Fantrax team id, not the old name', async () => {
    h.findUnique.mockResolvedValue(snapshotWithTeamId)
    h.rosters.mockResolvedValue({ ok: true, data: {
      team1: { teamName: 'Renamed team', rosterItems: [{ id: 'new-qb', position: 'SFX', status: 'ACTIVE' }] },
      team2: { teamName: 'Rival', rosterItems: [] },
    } })
    const outcome = await importFantraxLeague(args)
    expect(outcome).toMatchObject({ ok: true, teamName: 'Renamed team' })
    expect(h.updateMany.mock.calls[0][0].data.userTeam).toBe('Renamed team')
  })

  it('the id wins even when ANOTHER team has since taken the old name', async () => {
    h.findUnique.mockResolvedValue(snapshotWithTeamId)
    h.rosters.mockResolvedValue({ ok: true, data: {
      team1: { teamName: 'Renamed team', rosterItems: [{ id: 'new-qb', position: 'SFX', status: 'ACTIVE' }] },
      team2: { teamName: 'My team', rosterItems: [] },
    } })
    const outcome = await importFantraxLeague(args)
    expect(outcome).toMatchObject({ ok: true, teamName: 'Renamed team' })
    expect(h.updateMany.mock.calls[0][0].data.userTeam).toBe('Renamed team')
  })

  it('an explicit team id from the caller is honoured on a first import too', async () => {
    h.findUnique.mockResolvedValue(snapshotWithTeamId)
    h.rosters.mockResolvedValue({ ok: true, data: {
      team1: { teamName: 'Renamed team', rosterItems: [{ id: 'new-qb', position: 'SFX', status: 'ACTIVE' }] },
    } })
    const outcome = await importFantraxLeague({ ...args, teamName: 'Something stale', teamId: 'team1' })
    expect(outcome).toMatchObject({ ok: true, teamName: 'Renamed team' })
  })

  it('standings are joined to rosters by team id, so a renamed team keeps its record', async () => {
    h.findUnique.mockResolvedValue(snapshotWithTeamId)
    h.rosters.mockResolvedValue({ ok: true, data: {
      team1: { teamName: 'Renamed team', rosterItems: [{ id: 'new-qb', position: 'SFX', status: 'ACTIVE' }] },
    } })
    /* getStandings can carry a different display string than getTeamRosters for the same team. */
    h.standings.mockResolvedValue({ ok: true, data: [{ teamId: 'team1', teamName: 'Renamed team (7-2)', rank: 1, wins: 7, losses: 2, ties: 0, pointsFor: 900 }] })
    expect(await importFantraxLeague({ ...args, teamName: 'Renamed team' })).toMatchObject({ ok: true })
    expect(h.updateMany.mock.calls[0][0].data.standings[0]).toMatchObject({ team: 'Renamed team', rank: 1, wins: 7, fantraxTeamId: 'team1' })
  })

  it('still falls back to the name when the snapshot carries no team id (CSV-era rows)', async () => {
    h.findUnique.mockResolvedValue({ ...snapshotWithTeamId, standings: [{ team: 'My team' }] })
    expect(await importFantraxLeague(args)).toMatchObject({ ok: true, teamName: 'My team' })
  })
})
