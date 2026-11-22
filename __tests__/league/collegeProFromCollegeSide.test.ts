import { beforeEach, describe, expect, it, vi } from 'vitest'

const LEAGUES: Record<string, Record<string, unknown>> = {
  peach: { id: 'peach', name: 'Peach Bowl (C2C)', platform: 'sleeper', platformLeagueId: 'sl-1', leagueType: 'c2c', leagueVariant: null, sport: 'NFL', settings: {} },
  cream: { id: 'cream', name: 'Cream Bowl', platform: 'fantrax', platformLeagueId: 'snap-1', leagueType: 'c2c', leagueVariant: null, sport: 'NCAAF', settings: {} },
  lonely: { id: 'lonely', name: 'Unpaired', platform: 'fantrax', platformLeagueId: 'snap-2', leagueType: 'c2c', leagueVariant: null, sport: 'NCAAF', settings: {} },
}
const h = vi.hoisted(() => ({ paired: new Map<string, unknown>(), metrics: vi.fn(async () => null as unknown) }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: vi.fn(async (q: { where: { id: string } }) => LEAGUES[q.where.id] ?? null) },
    userProfile: { findUnique: vi.fn(async () => null) },
    sportsGame: { findMany: vi.fn(async () => []) },
    sportsDataCache: { findMany: vi.fn(async () => []) },
    fantraxLeague: { findUnique: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/core-app/leaguePairing', () => ({ resolvePairedHalf: vi.fn(async (id: string) => h.paired.get(id) ?? null) }))
vi.mock('@/lib/league-context/leagueContextService', () => ({ getLeagueContext: vi.fn(async () => null) }))
vi.mock('@/lib/sleeper/liveLeagueFeed', () => ({
  liveLeagueRosters: vi.fn(async () => null),
  liveLeagueDrafts: vi.fn(async () => null),
  liveLeagueMatchups: vi.fn(async () => null),
  liveLeagueUsers: vi.fn(async () => null),
  liveNflState: vi.fn(async () => null),
}))
vi.mock('@/lib/core-app/connectedRoster', () => ({ connectedRosterPlayers: vi.fn(async () => []) }))
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: vi.fn(async () => false) }))
vi.mock('./../../lib/league/collegePro/collegePoints', () => ({ loadCollegePoints: vi.fn(async () => null) }))
vi.mock('@/lib/af-projections/leaguePlayerMetrics', () => ({ loadLeaguePlayerMetrics: h.metrics }))

import { loadCollegeProRoster } from '@/lib/league/collegePro/loadCollegeProRoster'

const collegeSide = { role: 'college', platform: 'fantrax', leagueId: 'cream', memberLeagueId: 'snap-1', name: 'Cream Bowl', sport: 'NCAAF', teamLabel: 'Mine', players: [], unavailableReason: null }
const proSide = { role: 'pro', platform: 'sleeper', leagueId: 'peach', memberLeagueId: 'peach', name: 'Peach Bowl (C2C)', sport: 'NFL', teamLabel: null, players: [], unavailableReason: null }

beforeEach(() => {
  h.paired.clear()
  h.metrics.mockReset().mockResolvedValue(null)
  // resolvePairedHalf reports which half the viewed league is, as the real one does.
  h.paired.set('cream', { viewingRole: 'college', sides: [collegeSide, proSide] })
  h.paired.set('peach', { viewingRole: 'pro', sides: [proSide, collegeSide] })
})

// A Sunday with no fixtures on file, so the weekday rule would put the NFL lineup first.
const SUNDAY = new Date('2026-11-22T17:00:00Z')

describe('the combined page opened from the college league', () => {
  it('is built from the paired pro league, with the college lineup first', async () => {
    const r = await loadCollegeProRoster('cream', 'u1', SUNDAY)
    expect(r.applies).toBe(true)
    if (!r.applies) return
    expect(r.lead).toBe('college')
    expect(r.sides.map((s) => s.role)).toEqual(['college', 'pro'])
    expect(r.sides.find((s) => s.role === 'pro')?.leagueName).toBe('Peach Bowl (C2C)')
  })

  it('the same moment from the pro league keeps the NFL lineup first', async () => {
    const r = await loadCollegeProRoster('peach', 'u1', SUNDAY)
    expect(r.applies && r.lead).toBe('pro')
  })

  it('a college league with no pro half keeps its standard page', async () => {
    expect(await loadCollegeProRoster('lonely', 'u1', SUNDAY)).toEqual({ applies: false })
  })
})

describe('the PROJ column on a Sleeper + Fantrax pair', () => {
  it("fills the college half from the college league's own projections", async () => {
    const withPlayer = { ...collegeSide, players: [{ id: 'fx1', name: 'Freshman', position: 'WR', rosterSlot: 'WR', rosterStatus: 'ACTIVE' }] }
    h.paired.set('peach', { viewingRole: 'pro', sides: [proSide, withPlayer] })
    h.metrics.mockImplementation(async (a: { leagueId: string }) =>
      a.leagueId === 'cream' ? { unit: 'fantasy points', rows: [{ rosterPlayerId: 'fx1', playerId: 'k1', weekly: 14.25, perGame: 14.25 }] } : null,
    )
    const r = await loadCollegeProRoster('peach', 'u1', SUNDAY)
    expect(h.metrics).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'cream', week: null, rosterIds: ['fx1'] }))
    expect(r.applies && r.sides.find((s) => s.role === 'college')?.weeklyProjections).toEqual({ fx1: 14.25 })
  })

  it('a league whose board is not in fantasy points shows no projection', async () => {
    const withPlayer = { ...collegeSide, players: [{ id: 'fx1', name: 'Freshman', position: 'WR', rosterSlot: 'WR', rosterStatus: 'ACTIVE' }] }
    h.paired.set('peach', { viewingRole: 'pro', sides: [proSide, withPlayer] })
    h.metrics.mockResolvedValue({ unit: 'category score', rows: [{ rosterPlayerId: 'fx1', playerId: 'k1', weekly: 3, perGame: 3 }] })
    const r = await loadCollegeProRoster('peach', 'u1', SUNDAY)
    expect(r.applies && r.sides.find((s) => s.role === 'college')?.weeklyProjections).toBeUndefined()
  })
})
