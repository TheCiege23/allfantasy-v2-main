import { beforeEach, describe, expect, it, vi } from 'vitest'

const LEAGUES: Record<string, Record<string, unknown>> = {
  peach: { id: 'peach', name: 'Peach Bowl (C2C)', platform: 'sleeper', platformLeagueId: 'sl-1', leagueType: 'c2c', leagueVariant: null, sport: 'NFL', settings: {} },
  cream: { id: 'cream', name: 'Cream Bowl', platform: 'fantrax', platformLeagueId: 'snap-1', leagueType: 'c2c', leagueVariant: null, sport: 'NCAAF', settings: {} },
  lonely: { id: 'lonely', name: 'Unpaired', platform: 'fantrax', platformLeagueId: 'snap-2', leagueType: 'c2c', leagueVariant: null, sport: 'NCAAF', settings: {} },
}
const h = vi.hoisted(() => ({ paired: new Map<string, unknown>() }))

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

import { loadCollegeProRoster } from '@/lib/league/collegePro/loadCollegeProRoster'

const collegeSide = { role: 'college', platform: 'fantrax', leagueId: 'cream', memberLeagueId: 'snap-1', name: 'Cream Bowl', sport: 'NCAAF', teamLabel: 'Mine', players: [], unavailableReason: null }
const proSide = { role: 'pro', platform: 'sleeper', leagueId: 'peach', memberLeagueId: 'peach', name: 'Peach Bowl (C2C)', sport: 'NFL', teamLabel: null, players: [], unavailableReason: null }

beforeEach(() => {
  h.paired.clear()
  h.paired.set('cream', { sides: [collegeSide, proSide] })
  h.paired.set('peach', { sides: [proSide, collegeSide] })
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
