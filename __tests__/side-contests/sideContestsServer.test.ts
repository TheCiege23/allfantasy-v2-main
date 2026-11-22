/**
 * Weekly side contests, server side: who may read (any member) and write (a commissioner, through the
 * settings patch), and the view built from the stored matchups.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  patch: vi.fn(),
  membership: vi.fn(),
  role: vi.fn(),
  prisma: {
    league: { findUnique: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    redraftMatchup: { findMany: vi.fn() },
    redraftRoster: { findMany: vi.fn() },
  },
}))

vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/execute-league-settings-patch', () => ({ executeLeagueSettingsPatch: m.patch }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: m.membership }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: m.role }))

import { GET, PUT } from '@/app/api/leagues/[leagueId]/side-contests/handler'
import { readSideContestsView } from '@/lib/side-contests/sideContestsService'
import { SIDE_CONTESTS_KEY } from '@/lib/side-contests/sideContests'

const ctx = { params: { leagueId: 'L' } }
const url = 'http://x/api/leagues/L/side-contests'
const ON = { [SIDE_CONTESTS_KEY]: { high_score: { enabled: true, prizeCents: 2000 }, closest_loss: { enabled: true, prizeCents: 0 } } }
const final = (week: number, home: string, away: string, hs: number, as: number) => ({
  id: `${week}${home}`, week, type: 'regular', status: 'final', homeRosterId: home, awayRosterId: away, homeScore: hs, awayScore: as, isMedianMatchup: false,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'u1' } })
  m.patch.mockResolvedValue(new Response('{}', { status: 200 }))
  m.membership.mockResolvedValue({ ok: true, access: {} })
  m.role.mockResolvedValue('member')
  m.prisma.league.findUnique.mockResolvedValue({ platform: 'allfantasy', settings: ON })
  m.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 'S', season: 2026 })
  m.prisma.redraftMatchup.findMany.mockResolvedValue([final(1, 'A', 'B', 140, 99), final(1, 'C', 'D', 120, 118), final(2, 'B', 'C', 101, 100), final(2, 'A', 'D', 90, 150)])
  m.prisma.redraftRoster.findMany.mockResolvedValue([
    { id: 'A', teamName: 'Aces', ownerName: 'a' },
    { id: 'B', teamName: ' ', ownerName: 'Bea' },
    { id: 'C', teamName: 'Cats', ownerName: 'c' },
    { id: 'D', teamName: 'Dogs', ownerName: 'd' },
  ])
})

describe('readSideContestsView', () => {
  it('any member sees every finished week, newest first, with names and the season money', async () => {
    const v = await readSideContestsView('L', 'u1')
    expect(v.ok && v.canEdit).toBe(false)
    if (!v.ok) throw new Error('expected ok')
    expect(v.season).toBe(2026)
    expect(v.weeks.map((w) => w.week)).toEqual([2, 1])
    expect(v.weeks[1].contests.high_score).toEqual([{ rosterId: 'A', value: 140, prizeCents: 2000, teamName: 'Aces' }])
    expect(v.weeks[0].contests.closest_loss).toEqual([{ rosterId: 'C', opponentRosterId: 'B', value: 1, prizeCents: 0, teamName: 'Cats', opponentName: 'Bea' }])
    // Week 1: Aces top score ($20), Dogs closest loss. Week 2: Dogs top score ($20), Cats closest loss.
    // Equal money is ordered by contests won; a team that won nothing is not listed.
    expect(v.totals.map((t) => [t.teamName, t.prizeCents, t.wins])).toEqual([
      ['Dogs', 2000, { high_score: 1, closest_loss: 1 }],
      ['Aces', 2000, { high_score: 1, closest_loss: 0 }],
      ['Cats', 0, { high_score: 0, closest_loss: 1 }],
    ])
  })

  it('a commissioner or co-commissioner may edit', async () => {
    m.role.mockResolvedValue('co_commissioner')
    expect(await readSideContestsView('L', 'u1')).toMatchObject({ ok: true, canEdit: true })
  })

  it('refuses a non-member with the membership status', async () => {
    m.membership.mockResolvedValue({ ok: false, status: 403 })
    expect(await readSideContestsView('L', 'u1')).toEqual({ ok: false, status: 403 })
    expect(m.prisma.redraftMatchup.findMany).not.toHaveBeenCalled()
  })

  it('reads no matchups when every contest is off, or outside leagues AllFantasy scores', async () => {
    m.prisma.league.findUnique.mockResolvedValue({ platform: 'allfantasy', settings: {} })
    expect(await readSideContestsView('L', 'u1')).toMatchObject({ ok: true, native: true, weeks: [] })
    m.prisma.league.findUnique.mockResolvedValue({ platform: 'sleeper', settings: ON })
    expect(await readSideContestsView('L', 'u1')).toMatchObject({ ok: true, native: false, weeks: [] })
    expect(m.prisma.redraftMatchup.findMany).not.toHaveBeenCalled()
  })
})

describe('/api/leagues/:id/side-contests', () => {
  it('GET needs a session and passes the service status through', async () => {
    m.session.mockResolvedValueOnce(null)
    expect((await GET(new NextRequest(url), ctx)).status).toBe(401)
    m.membership.mockResolvedValue({ ok: false, status: 404 })
    expect((await GET(new NextRequest(url), ctx)).status).toBe(404)
  })

  it('GET returns the view without the ok flag', async () => {
    const body = await (await GET(new NextRequest(url), ctx)).json()
    expect(body.ok).toBeUndefined()
    expect(body.weeks).toHaveLength(2)
  })

  it('PUT saves through the settings patch as one money key, so scopes and the settings lock apply', async () => {
    const res = await PUT(new NextRequest(url, { method: 'PUT', body: JSON.stringify({ high_score: { enabled: true, prize: '20' }, closest_loss: { enabled: false, prize: '' } }) }), ctx)
    expect(res.status).toBe(200)
    expect(m.patch).toHaveBeenCalledWith('u1', {
      leagueId: 'L',
      settingsMerge: { [SIDE_CONTESTS_KEY]: { high_score: { enabled: true, prizeCents: 2000 }, closest_loss: { enabled: false, prizeCents: 0 } } },
    })
  })

  it('PUT refuses a bad body before touching settings', async () => {
    const res = await PUT(new NextRequest(url, { method: 'PUT', body: JSON.stringify({ high_score: { enabled: true, prize: 'lots' } }) }), ctx)
    expect(res.status).toBe(400)
    expect(m.patch).not.toHaveBeenCalled()
    m.session.mockResolvedValueOnce(null)
    expect((await PUT(new NextRequest(url, { method: 'PUT', body: '{}' }), ctx)).status).toBe(401)
  })
})
