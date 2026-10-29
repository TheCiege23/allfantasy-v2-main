/**
 * Tournament co-commissioners (League.settings.tournamentCoCommissionerIds) usually hold NO team in a
 * conference league. The surfaces below used to recognise only the team flag (LeagueTeam.isCoCommissioner),
 * so such a co-commissioner was refused or shown as nobody. Each is checked here with a co-commissioner
 * who holds no team — and with a plain member, so nothing is widened beyond co-commissioner rights.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: { user: { id: 'co1' } } as { user: { id: string } } | null,
  league: null as Record<string, unknown> | null,
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn() },
    leagueTeam: { findFirst: vi.fn(), findMany: vi.fn() },
    roster: { findFirst: vi.fn(), findMany: vi.fn() },
    appUser: { findMany: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    allFantasyMarketPlayerValue: { findMany: vi.fn() },
  },
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => m.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/trade-market/allFantasyMarketValues', () => ({ resolveAllFantasyMarketValue: vi.fn() }))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({ isOrphanPlatformUserId: () => false }))
vi.mock('@/lib/discovery-analytics/server', () => ({ trackDiscoveryOrphanAdoption: vi.fn() }))
vi.mock('@/lib/league/leagueSeats', () => ({ assignLeagueSeat: vi.fn(), releaseLeagueSeat: vi.fn() }))

import { hasLeagueCommissionerRights } from '@/lib/league/permissions'
import { GET as marketValuesGET } from '@/app/api/redraft/trades/market-values/route'
import { GET as managersGET } from '@/app/api/commissioner/leagues/[leagueId]/managers/route'
import { resolveViewerLeagueCommissioner } from '@/lib/dashboard/get-dashboard-league-list'

const TOURNAMENT_LEAGUE = { userId: 'owner', settings: { tournamentCoCommissionerIds: ['co1'] } }

beforeEach(() => {
  vi.clearAllMocks()
  m.session = { user: { id: 'co1' } }
  // `teams` is filtered by claimedByUserId in the query; co1 holds none.
  m.prisma.league.findFirst.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) =>
    select && 'teams' in select ? { ...TOURNAMENT_LEAGUE, teams: [] } : TOURNAMENT_LEAGUE)
  m.prisma.league.findUnique.mockResolvedValue({ settings: TOURNAMENT_LEAGUE.settings })
  m.prisma.leagueTeam.findFirst.mockResolvedValue(null)
  m.prisma.roster.findFirst.mockResolvedValue(null)
  m.prisma.redraftSeason.findFirst.mockResolvedValue({ sport: 'NFL' })
  m.prisma.allFantasyMarketPlayerValue.findMany.mockResolvedValue([])
})

describe('hasLeagueCommissionerRights (the shared check the redraft routes now use)', () => {
  it('🛑 a tournament co-commissioner with no team has co-commissioner rights', async () => {
    expect(await hasLeagueCommissionerRights('L', 'co1')).toBe(true)
  })
  it('a member who is not on the tournament list does not', async () => {
    expect(await hasLeagueCommissionerRights('L', 'member9')).toBe(false)
  })
  it('the team flags and the owner still count, exactly as the per-route copies did', async () => {
    expect(await hasLeagueCommissionerRights('L', 'owner')).toBe(true)
    m.prisma.league.findFirst.mockResolvedValueOnce({ userId: 'owner', settings: {}, teams: [{ isCommissioner: false, isCoCommissioner: false }, { isCommissioner: false, isCoCommissioner: true }] })
    expect(await hasLeagueCommissionerRights('L', 'u2')).toBe(true)
    m.prisma.league.findFirst.mockResolvedValueOnce(null)
    expect(await hasLeagueCommissionerRights('missing', 'co1')).toBe(false)
  })
})

describe('redraft commissioner routes', () => {
  const req = () => new NextRequest('http://localhost/api/redraft/trades/market-values?leagueId=L')
  it('🛑 a tournament co-commissioner is let through', async () => {
    const res = await marketValuesGET(req())
    expect(res.status).toBe(200)
  })
  it('a plain member is still refused', async () => {
    m.session = { user: { id: 'member9' } }
    const res = await marketValuesGET(req())
    expect(res.status).toBe(403)
  })

  it('no redraft route checks the team co-commissioner flag without also reading the tournament list', () => {
    const root = join(__dirname, '..', 'app', 'api', 'redraft')
    const files: string[] = []
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.ts')) files.push(p) } }
    walk(root)
    expect(files.length).toBeGreaterThan(10)
    const offenders = files.filter(f => {
      const src = readFileSync(f, 'utf8')
      return /\.isCoCommissioner\b/.test(src) && !/isTournamentCoCommissioner|hasLeagueCommissionerRights/.test(src)
    })
    expect(offenders).toEqual([])
  })
})

describe('managers list', () => {
  const params = { params: Promise.resolve({ leagueId: 'L' }) }
  beforeEach(() => {
    m.session = { user: { id: 'owner' } }
    m.prisma.leagueTeam.findMany.mockResolvedValue([
      { id: 't1', externalId: 'co1', ownerName: 'Co', teamName: 'Co FC', avatarUrl: null, isCommissioner: false, isCoCommissioner: false, isOrphan: false, role: 'member', platformUserId: 'co1', claimedByUserId: 'co1' },
      { id: 't2', externalId: 'm9', ownerName: 'Mem', teamName: 'Mem FC', avatarUrl: null, isCommissioner: false, isCoCommissioner: false, isOrphan: false, role: 'member', platformUserId: 'm9', claimedByUserId: 'member9' },
    ])
    m.prisma.roster.findMany.mockResolvedValue([{ id: 'r1', platformUserId: 'co1' }, { id: 'r2', platformUserId: 'member9' }])
    m.prisma.appUser.findMany.mockResolvedValue([{ id: 'co1', username: 'coone', displayName: 'Co One' }, { id: 'co2', username: 'cotwo', displayName: null }])
    m.prisma.league.findUnique.mockResolvedValue({ settings: { tournamentCoCommissionerIds: ['co1', 'co2'] } })
  })

  it('🛑 marks a tournament co-commissioner who holds a team, and lists the ones who do not', async () => {
    const res = await managersGET(new NextRequest('http://localhost/x'), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    const byUser = Object.fromEntries(body.managers.map((x: { userId: string; isCoCommissioner: boolean }) => [x.userId, x.isCoCommissioner]))
    expect(byUser).toEqual({ co1: true, member9: false })
    expect(body.teams.map((t: { isCoCommissioner: boolean }) => t.isCoCommissioner)).toEqual([true, false])
    expect(body.teams[0]).not.toHaveProperty('claimedByUserId')
    expect(body.tournamentCoCommissioners).toEqual([
      { userId: 'co1', username: 'coone', displayName: 'Co One', hasTeam: true },
      { userId: 'co2', username: 'cotwo', displayName: 'cotwo', hasTeam: false },
    ])
  })

  it('a tournament co-commissioner with no team may read the list', async () => {
    m.session = { user: { id: 'co2' } }
    m.prisma.league.findFirst.mockResolvedValue({ userId: 'owner', settings: { tournamentCoCommissionerIds: ['co1', 'co2'] } })
    const res = await managersGET(new NextRequest('http://localhost/x'), params)
    expect(res.status).toBe(200)
  })
})

describe('dashboard league list', () => {
  const base = { platform: 'allfantasy', leagueRowOwnerId: 'owner', leagueIsCommissionerFlag: false, team: null }
  it('🛑 a tournament co-commissioner sees the league as one they run', () => {
    expect(resolveViewerLeagueCommissioner({ ...base, viewerUserId: 'co1', settings: TOURNAMENT_LEAGUE.settings })).toBe(true)
  })
  it('anyone else does not', () => {
    expect(resolveViewerLeagueCommissioner({ ...base, viewerUserId: 'member9', settings: TOURNAMENT_LEAGUE.settings })).toBe(false)
    expect(resolveViewerLeagueCommissioner({ ...base, viewerUserId: 'co1', settings: null })).toBe(false)
  })
  it('🛑 every membership query includes leagues the viewer co-runs through a tournament (no team needed)', () => {
    const src = readFileSync(join(__dirname, '..', 'lib', 'dashboard', 'get-dashboard-league-list.ts'), 'utf8')
    const branches = src.match(/\{ settings: \{ path: \[TOURNAMENT_CO_COMMISSIONERS_KEY\], array_contains: \[userId\] \} \}/g) ?? []
    const membershipBlocks = src.match(/\{ rosters: \{ some: \{ platformUserId: userId \} \} \}/g) ?? []
    expect(membershipBlocks.length).toBeGreaterThanOrEqual(2)
    expect(branches.length).toBe(membershipBlocks.length)
  })
})
