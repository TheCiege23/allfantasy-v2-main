import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * GET /api/app/leagues/[leagueId]/chat/moves — readable by exactly who reads the league's chat, from
 * Postgres only, the last 30 days.
 */
const h = vi.hoisted(() => ({ session: null as unknown, access: vi.fn(), league: vi.fn(), activity: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => h.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: h.access }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.league } } }))
vi.mock('@/lib/core-app/leagueActivity', () => ({ getLeagueActivity: h.activity }))

import { GET } from '@/app/api/app/leagues/[leagueId]/chat/moves/route'

const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
const call = () => GET(new Request('http://localhost/api/app/leagues/L1/chat/moves'), ctx)
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000)
const item = (id: string, when: Date) => ({
  id, kind: 'waiver', occurredAt: when, teamName: 'Fitty SF', managerName: 'TheCiege24', avatarUrl: null, involvedTeams: ['Fitty SF'],
  adds: [{ id: 'p1', label: 'player p1', name: null, position: null, team: null, imageUrl: null, to: null }],
  drops: [], bid: 9, picks: [], eventId: null,
})

beforeEach(() => {
  h.session = { user: { id: 'u1' } }
  h.access.mockReset().mockResolvedValue({ leagueId: 'L1' })
  h.league.mockReset().mockResolvedValue({ platform: 'sleeper', platformLeagueId: '1313549607426334720', sport: 'NFL' })
  h.activity.mockReset().mockResolvedValue({ items: [item('new', daysAgo(1)), item('old', daysAgo(31))] })
})

describe('league chat moves route', () => {
  it('refuses the signed-out and non-members without reading any activity', async () => {
    h.session = null
    expect((await call()).status).toBe(401)
    h.session = { user: { id: 'stranger' } }
    h.access.mockResolvedValue(null)
    expect((await call()).status).toBe(403)
    expect(h.activity).not.toHaveBeenCalled()
  })

  it('serves the last 30 days, names an unnamed player by his label, and reads the league it was asked about', async () => {
    const body = await (await call()).json()
    expect(body.moves.map((m: { id: string }) => m.id)).toEqual(['new'])
    expect(body.moves[0]).toMatchObject({ kind: 'waiver', bid: 9, adds: [{ id: 'p1', name: 'player p1', to: null }] })
    expect(h.activity).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', platformLeagueId: '1313549607426334720', platform: 'sleeper', sport: 'NFL' }))
  })

  it('answers no moves — not an error — when the league holds none', async () => {
    h.activity.mockResolvedValue(null)
    expect(await (await call()).json()).toEqual({ moves: [] })
  })
})
