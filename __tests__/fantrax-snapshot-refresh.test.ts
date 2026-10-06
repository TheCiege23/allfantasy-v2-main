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
