/**
 * A stored Fantrax NBA/NHL snapshot normalises with the sport, the real lineup slots mapped onto our
 * catalogs, minor-leaguers on the taxi squad, and a season that is not "finished" just because the
 * calendar year rolled over mid-season. Fixtures are SYNTHETIC — see tests/fixtures/fantrax/*-synthetic.json.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import nba from './fixtures/fantrax/nba-synthetic.json'
import nhl from './fixtures/fantrax/nhl-synthetic.json'
import { resolveRosters, type FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'

const h = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { fantraxLeague: { findUnique: h.findUnique, findMany: h.findMany } } }))
vi.mock('@/lib/league-import/fantrax/importFantraxLeague', () => ({ importFantraxLeague: h.refresh }))
import { fetchFantraxLeagueForImport } from '@/lib/league-import/fantrax/FantraxLeagueFetchService'
import { FantraxRosterMapper } from '@/lib/league-import/adapters/fantrax/FantraxRosterMapper'
import { FantraxLeagueMapper } from '@/lib/league-import/adapters/fantrax/FantraxLeagueMapper'

type Fixture = { info: { rosterInfo: Record<string, unknown> }; playerMap: Record<string, FantraxPlayerRef>; roster: { teamName: string; rosterItems: Array<{ id: string; position: string; status: string }> } }

function snapshotOf(fixture: Fixture, sport: 'nba' | 'nhl') {
  const [team] = resolveRosters({ t1: fixture.roster }, fixture.playerMap)
  return {
    id: 'snapshot', appUserId: 'owner', sourceLeagueId: 'vendor', season: 2025,
    user: { id: 'manager', fantraxUsername: 'Manager' }, userTeam: 'Fixture team',
    sport, isDevy: false, leagueName: 'Synthetic dynasty', teamCount: 1,
    roster: team!.players.map((p) => ({ ...p, teamName: 'Fixture team' })),
    standings: [{ team: 'Fixture team', fantraxTeamId: 't1', wins: 0, losses: 0 }], matchups: [], transactions: [],
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-03-15T12:00:00Z'))
  h.findMany.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers() })

describe.each([
  ['NBA', nba as unknown as Fixture, 'nba' as const, { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 5 }, ['syn-nba-99'], ['syn-nba-05']],
  ['NHL', nhl as unknown as Fixture, 'nhl' as const, { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1, BN: 7 }, ['syn-nhl-98'], ['syn-nhl-06']],
])('stored Fantrax %s snapshot', (sport, fixture, stored, slots, taxi, reserve) => {
  it('normalises sport, slots, taxi and an in-progress split season', async () => {
    const snapshot = snapshotOf(fixture, stored)
    h.findUnique.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(snapshot)
    h.refresh.mockResolvedValue({ ok: true, fantraxLeagueId: 'snapshot', scoringRules: [], scoringGaps: [], sourceSettings: { rosterInfo: fixture.info.rosterInfo, scoringSystem: { type: 'POINTS_BASED' } }, seasonState: null })
    const payload = await fetchFantraxLeagueForImport('owner', 'id:snapshot')

    expect(payload.league).toMatchObject({ sport, season: 2025, isFinished: false })
    expect(payload.settings?.scoringType).toBe('POINTS_BASED')
    expect(Object.fromEntries(payload.settings!.rosterPositions.map((s) => [s.position, s.count]))).toEqual(slots)
    expect(payload.settings?.raw).not.toHaveProperty('rosterSlotGaps')

    const [team] = payload.teams
    expect(team!.taxiPlayerIds).toEqual(taxi)
    expect(team!.reservePlayerIds).toEqual(reserve)
    expect(team!.starterPlayerIds).toHaveLength(4)
    expect(FantraxRosterMapper.map(payload)[0]!.taxi_ids).toEqual(taxi)
    expect(FantraxLeagueMapper.map(payload)).toMatchObject({ sport, season: 2025, status: 'in_season' })
  })
})
