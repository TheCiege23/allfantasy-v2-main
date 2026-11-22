import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagues: {} as Record<string, Record<string, unknown>>,
  attach: vi.fn(async (a: { role: string }) => ({ ok: true as const, linkId: 'link-1', role: a.role })),
  paired: new Map<string, unknown>(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: vi.fn(async (q: { where: { id: string } }) => h.leagues[q.where.id] ?? null),
      findMany: vi.fn(async () => Object.values(h.leagues).filter((l) => l.sport === 'NCAAB')),
    },
    franchiseLeagueMember: { findMany: vi.fn(async () => []) },
    userProfile: { findUnique: vi.fn(async () => null) },
    sportsGame: { findMany: vi.fn(async () => []) },
    sportsDataCache: { findMany: vi.fn(async () => []) },
    fantraxLeague: {
      findUnique: vi.fn(async (q: { where: { id: string } }) =>
        q.where.id === 'snap-nba'
          ? {
              transactions: null,
              season: 2026,
              matchups: [{ week: 5, homeTeam: 'Golden State Warriors', awayTeam: 'Boston Celtics', homeTeamId: 'gsw', awayTeamId: 'bos' }],
              roster: [{ fantraxId: 'opp1', teamName: 'Boston Celtics', position: 'G', status: 'ACTIVE' }],
              standings: [{ team: 'Golden State Warriors', fantraxTeamId: 'gsw' }, { team: 'Boston Celtics', fantraxTeamId: 'bos' }],
            }
          : {
              transactions: null,
              season: 2026,
              standings: [{ team: '#51 Butler Bulldogs', fantraxTeamId: 'but' }, { team: 'Duke', fantraxTeamId: 'duke' }],
              roster: [
                { fantraxId: 'dk1', teamName: 'Duke', position: 'G', status: 'ACTIVE' },
                { fantraxId: 'dk2', teamName: 'Duke', position: 'F', status: 'RESERVE' },
              ],
            },
      ),
    },
  },
}))
vi.mock('@/lib/league-import/fantrax/importFantraxLeague', () => ({ attachToFranchise: h.attach }))
vi.mock('@/lib/core-app/leaguePairing', () => ({ resolvePairedHalf: vi.fn(async (id: string) => h.paired.get(id) ?? null) }))
vi.mock('@/lib/league-context/leagueContextService', () => ({ getLeagueContext: vi.fn(async () => null) }))
vi.mock('@/lib/sleeper/liveLeagueFeed', () => ({
  liveLeagueRosters: vi.fn(async () => null), liveLeagueDrafts: vi.fn(async () => null), liveLeagueMatchups: vi.fn(async () => null),
  liveLeagueUsers: vi.fn(async () => null), liveNflState: vi.fn(async () => null),
}))
vi.mock('@/lib/core-app/connectedRoster', () => ({
  connectedRosterPlayers: vi.fn(async (_p: string, _s: string, rows: Array<{ fantraxId: string; position: string; status: string }>) =>
    rows.map((r) => ({ id: r.fantraxId, name: r.fantraxId, position: r.position, team: null, imageUrl: null, logoUrl: null, rosterSlot: r.position, rosterStatus: r.status, rollingInsightsId: `ri-${r.fantraxId}`, cfbdId: null })),
  ),
}))
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: vi.fn(async () => false) }))
// Every player with a box line this period scored 10, so totals show which players counted.
vi.mock('@/lib/league/collegePro/dailyPoints', async (orig) => ({
  ...(await orig<typeof import('@/lib/league/collegePro/dailyPoints')>()),
  loadDailyPoints: vi.fn(async (a: { players: Array<{ id: string }> }) => ({ points: Object.fromEntries(a.players.map((p) => [p.id, 10])), statsOnFile: true })),
}))

import { isCollegeSport, linkHalves, memberKeyFor, pairedSportFor } from '@/lib/league/collegePro/linkHalves'
import { currentFantraxPeriod } from '@/lib/league/collegePro/dailyPoints'
import { buildFantraxLists } from '@/lib/league/collegePro/buildSides'
import { loadCollegeProRoster } from '@/lib/league/collegePro/loadCollegeProRoster'

const PERIODS = [
  { number: 4, startDate: '2026-11-09T00:00:00.0-0500', endDate: '2026-11-15T23:59:59.0-0500' },
  { number: 5, startDate: '2026-11-16T00:00:00.0-0500', endDate: '2026-11-22T23:59:59.0-0500' },
]

beforeEach(() => {
  h.attach.mockClear()
  h.paired.clear()
  h.leagues = {
    nba: { id: 'nba', name: 'Road To Glory NBA', platform: 'fantrax', platformLeagueId: 'snap-nba', sport: 'NBA', leagueType: 'c2c', leagueVariant: null, settings: { fantrax_scoring_periods: PERIODS } },
    cbb: { id: 'cbb', name: 'Road To Glory NCAA Basketball', platform: 'fantrax', platformLeagueId: 'snap-cbb', sport: 'NCAAB', leagueType: 'c2c', leagueVariant: null, settings: {} },
    nba2: { id: 'nba2', name: 'Other NBA', platform: 'fantrax', platformLeagueId: 'snap-x', sport: 'NBA', leagueType: 'c2c', leagueVariant: null, settings: {} },
  }
})

describe('linking two halves', () => {
  it('knows which sport pairs with which', () => {
    expect(pairedSportFor('NBA')).toBe('NCAAB')
    expect(pairedSportFor('NCAAB')).toBe('NBA')
    expect(pairedSportFor('NFL')).toBe('NCAAF')
    expect(isCollegeSport('ncaab')).toBe(true)
  })

  it('stores a Fantrax half under its snapshot id, as the pairing reader looks it up', () => {
    expect(memberKeyFor({ id: 'nba', platform: 'fantrax', platformLeagueId: 'snap-nba' })).toBe('snap-nba')
    expect(memberKeyFor({ id: 'peach', platform: 'sleeper', platformLeagueId: 'sl-1' })).toBe('peach')
  })

  it('links the NBA league as pro and the college league as college, in one franchise', async () => {
    expect(await linkHalves({ leagueId: 'cbb', otherLeagueId: 'nba', userId: 'u1' })).toEqual({ ok: true })
    const calls = h.attach.mock.calls.map((c) => c[0] as { role: string; leagueId: string; linkId?: string })
    expect(calls.map((c) => [c.role, c.leagueId])).toEqual([['pro', 'snap-nba'], ['college', 'snap-cbb']])
    expect(calls[1]!.linkId).toBe('link-1')
  })

  it('refuses two pro leagues', async () => {
    expect(await linkHalves({ leagueId: 'nba', otherLeagueId: 'nba2', userId: 'u1' })).toEqual({ ok: false, error: 'Link one pro league with one college league.' })
    expect(h.attach).not.toHaveBeenCalled()
  })
})

describe('Fantrax scoring periods and lineups', () => {
  it('finds the period a moment falls in, as game-date keys', () => {
    const p = currentFantraxPeriod(PERIODS, new Date('2026-11-21T18:00:00Z'))
    expect(p?.number).toBe(5)
    expect(p?.window.start.toISOString()).toBe('2026-11-16T00:00:00.000Z')
    expect(p?.window.end.toISOString()).toBe('2026-11-23T00:00:00.000Z')
  })

  it('MINORS is taxi on a pro half and bench on a college half', () => {
    const rows = [{ id: 'a', slot: 'G', status: 'ACTIVE' }, { id: 'b', slot: 'BN', status: 'MINORS' }]
    expect(buildFantraxLists(rows, { minorsAsTaxi: true })).toMatchObject({ taxi: ['b'], bench: [] })
    expect(buildFantraxLists(rows)).toMatchObject({ taxi: [], bench: ['b'] })
  })
})

describe('the combined page for an NBA league on Fantrax', () => {
  const pro = {
    role: 'pro', platform: 'fantrax', leagueId: 'nba', memberLeagueId: 'snap-nba', name: 'Road To Glory NBA', sport: 'NBA', teamLabel: 'Golden State Warriors', unavailableReason: null,
    players: [
      { id: 'p1', name: 'Curry', position: 'G', rosterSlot: 'G', rosterStatus: 'ACTIVE', rollingInsightsId: 'r1' },
      { id: 'p2', name: 'Bench', position: 'F', rosterSlot: 'BN', rosterStatus: 'RESERVE', rollingInsightsId: 'r2' },
      { id: 'p3', name: 'Stash', position: 'C', rosterSlot: 'BN', rosterStatus: 'MINORS', rollingInsightsId: 'r3' },
    ],
  }
  const college = {
    role: 'college', platform: 'fantrax', leagueId: 'cbb', memberLeagueId: 'snap-cbb', name: 'Road To Glory NCAA Basketball', sport: 'NCAAB', teamLabel: '#51 Butler Bulldogs', unavailableReason: null,
    players: [{ id: 'c1', name: 'Freshman', position: 'G', rosterSlot: 'G', rosterStatus: 'ACTIVE', rollingInsightsId: 'rc1' }],
  }

  it('shows both Fantrax halves, with NBA taxi, live points and the Fantrax opponent', async () => {
    h.paired.set('nba', { viewingRole: 'pro', sides: [pro, college] })
    const r = await loadCollegeProRoster('nba', 'u1', new Date('2026-11-21T18:00:00Z'))
    expect(r.applies).toBe(true)
    if (!r.applies) return
    const proSide = r.sides.find((s) => s.role === 'pro')!
    expect(proSide.platform).toBe('fantrax')
    expect(proSide.taxi).toEqual(['p3'])
    expect(proSide.score).toMatchObject({ week: 5, total: 10, opponent: { name: 'Boston Celtics', total: 10 } })
    expect(r.sides.find((s) => s.role === 'college')?.score.total).toBe(10)
  })

  it('combined scoring is head to head across two Fantrax leagues once the teams are matched', async () => {
    h.paired.set('nba', { viewingRole: 'pro', sides: [pro, college] })
    h.leagues.nba!.settings = { fantrax_scoring_periods: PERIODS, collegeProScoring: 'combined', collegeProTeamMap: { gsw: 'but', bos: 'duke' } }
    const r = await loadCollegeProRoster('nba', 'u1', new Date('2026-11-21T18:00:00Z'))
    expect(r.applies).toBe(true)
    if (!r.applies) return
    // You: 10 NBA + 10 college. Boston: 10 NBA + Duke's one STARTER (10); Duke's bench player does not count.
    expect(r.headToHead).toEqual({ me: 20, opponent: { name: 'Boston Celtics', total: 20 }, missing: null })
  })

  it('combined with no saved matches asks the commissioner to match teams', async () => {
    h.paired.set('nba', { viewingRole: 'pro', sides: [pro, college] })
    h.leagues.nba!.settings = { fantrax_scoring_periods: PERIODS, collegeProScoring: 'combined' }
    const r = await loadCollegeProRoster('nba', 'u1', new Date('2026-11-21T18:00:00Z'))
    expect(r.applies && r.headToHead?.missing).toMatch(/Match each pro team/)
  })

  it('a Fantrax NBA league with no stored periods scores the NBA calendar week', async () => {
    const { dailySportWeekForInstant } = await import('@/lib/season-week/dailySportSeasonStarts')
    h.paired.set('nba', { viewingRole: 'pro', sides: [pro, college] })
    // Road To Glory NBA stores only current_week, no fantrax_scoring_periods (production, 2026-11-22).
    h.leagues.nba!.settings = { current_week: 5 }
    const at = new Date('2026-11-21T18:00:00Z')
    const r = await loadCollegeProRoster('nba', 'u1', at)
    expect(r.applies).toBe(true)
    if (!r.applies) return
    const week = dailySportWeekForInstant('NBA', 2026, at)
    expect(week).not.toBeNull()
    expect(r.sides.find((s) => s.role === 'pro')?.score).toMatchObject({ week, total: 10 })
  })

  it('opened from the college league, it is the same page with college first', async () => {
    h.paired.set('cbb', { viewingRole: 'college', sides: [college, pro] })
    h.paired.set('nba', { viewingRole: 'pro', sides: [pro, college] })
    const r = await loadCollegeProRoster('cbb', 'u1', new Date('2026-11-22T18:00:00Z'))
    expect(r.applies && r.sides[0]!.role).toBe('college')
  })

  it('an unlinked league offers its possible other halves instead', async () => {
    const r = await loadCollegeProRoster('nba', 'u1', new Date('2026-11-21T18:00:00Z'))
    expect(r).toMatchObject({ applies: false, link: { needRole: 'college' } })
    if (r.applies) return
    expect(r.link?.candidates.map((c) => c.leagueId)).toEqual(['cbb'])
  })
})
