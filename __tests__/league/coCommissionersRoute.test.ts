import { beforeEach, describe, expect, it, vi } from 'vitest'

/** /api/league/settings/co-commissioners: the cap of two, and per-co-commissioner permissions. */

const m = vi.hoisted(() => ({
  session: { user: { id: 'owner' } } as { user: { id: string } } | null,
  requireOnly: vi.fn(),
  requireRole: vi.fn(),
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueTeam: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => m.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerOnly: m.requireOnly, requireCommissionerRole: m.requireRole }))

import { NextRequest } from 'next/server'
import { GET, PATCH } from '@/app/api/league/settings/co-commissioners/route'
import { CO_COMMISSIONER_SCOPES, CO_COMMISSIONER_SCOPES_KEY } from '@/lib/league/coCommissionerScopes'

type Team = { id: string; leagueId: string; isCommissioner: boolean; isCoCommissioner: boolean }
let teams: Team[]
let settings: Record<string, unknown>

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request('http://x/api/league/settings/co-commissioners', { method: 'PATCH', body: JSON.stringify(body) }) as never)

beforeEach(() => {
  vi.clearAllMocks()
  m.session = { user: { id: 'owner' } }
  m.requireOnly.mockResolvedValue(undefined)
  m.requireRole.mockResolvedValue(undefined)
  settings = { other: 'keep' }
  teams = [
    { id: 'head', leagueId: 'L', isCommissioner: true, isCoCommissioner: false },
    { id: 'a', leagueId: 'L', isCommissioner: false, isCoCommissioner: true },
    { id: 'b', leagueId: 'L', isCommissioner: false, isCoCommissioner: false },
    { id: 'c', leagueId: 'L', isCommissioner: false, isCoCommissioner: false },
  ]
  m.prisma.leagueTeam.findFirst.mockImplementation(async ({ where }: { where: { id: string; leagueId: string } }) =>
    teams.find((t) => t.id === where.id && t.leagueId === where.leagueId) ?? null)
  m.prisma.leagueTeam.findMany.mockImplementation(async () => teams.filter((t) => t.isCoCommissioner && !t.isCommissioner))
  m.prisma.leagueTeam.count.mockImplementation(async ({ where }: { where: { NOT: { id: string } } }) =>
    teams.filter((t) => t.isCoCommissioner && !t.isCommissioner && t.id !== where.NOT.id).length)
  m.prisma.leagueTeam.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: { isCoCommissioner: boolean } }) => {
    teams.find((t) => t.id === where.id)!.isCoCommissioner = data.isCoCommissioner
    return {}
  })
  m.prisma.league.findFirst.mockImplementation(async () => ({ settings: structuredClone(settings) }))
  m.prisma.league.findUnique.mockImplementation(async () => ({ settings: structuredClone(settings) }))
  m.prisma.league.update.mockImplementation(async ({ data }: { data: { settings: Record<string, unknown> } }) => {
    settings = structuredClone(data.settings)
    return {}
  })
  m.prisma.$transaction.mockImplementation(async (fn: (t: typeof m.prisma) => Promise<unknown>) => fn(m.prisma))
  m.prisma.$queryRaw.mockResolvedValue([])
})

describe('PATCH co-commissioners', () => {
  it('a second co-commissioner is allowed; a third is refused with 409 and nothing changes', async () => {
    expect((await patch({ leagueId: 'L', memberId: 'b', isCoCommissioner: true })).status).toBe(200)
    const third = await patch({ leagueId: 'L', memberId: 'c', isCoCommissioner: true })
    expect(third.status).toBe(409)
    expect((await third.json()).error).toMatch(/up to 2 co-commissioners/)
    expect(teams.find((t) => t.id === 'c')!.isCoCommissioner).toBe(false)
  })

  it('saves exactly the permissions sent, under a row lock, keeping other settings', async () => {
    const res = await patch({ leagueId: 'L', memberId: 'a', scopes: ['money', 'trades'] })
    expect(res.status).toBe(200)
    expect(settings[CO_COMMISSIONER_SCOPES_KEY]).toEqual({ a: ['trades', 'money'] })
    expect(settings.other).toBe('keep')
    expect(m.prisma.$queryRaw).toHaveBeenCalledTimes(1)
    expect(String((m.prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?'))).toContain('FOR UPDATE')
  })

  it('removing a co-commissioner forgets their permissions', async () => {
    settings = { [CO_COMMISSIONER_SCOPES_KEY]: { a: ['chat'] } }
    expect((await patch({ leagueId: 'L', memberId: 'a', isCoCommissioner: false })).status).toBe(200)
    expect(teams.find((t) => t.id === 'a')!.isCoCommissioner).toBe(false)
    expect(CO_COMMISSIONER_SCOPES_KEY in settings).toBe(false)
  })

  it('refuses unknown scopes, scopes for a non-co-commissioner, and an empty request', async () => {
    expect((await patch({ leagueId: 'L', memberId: 'a', scopes: ['admin'] })).status).toBe(400)
    expect((await patch({ leagueId: 'L', memberId: 'b', scopes: ['chat'] })).status).toBe(400)
    expect((await patch({ leagueId: 'L', memberId: 'a' })).status).toBe(400)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })

  it('only the head commissioner may change co-commissioners', async () => {
    m.requireOnly.mockRejectedValue(new Response(JSON.stringify({ error: 'no' }), { status: 403 }))
    expect((await patch({ leagueId: 'L', memberId: 'a', scopes: [] })).status).toBe(403)
    expect(m.prisma.league.update).not.toHaveBeenCalled()
  })
})

describe('GET co-commissioners', () => {
  it('lists each co-commissioner’s permissions; unconfigured = everything', async () => {
    teams[2].isCoCommissioner = true
    settings = { [CO_COMMISSIONER_SCOPES_KEY]: { a: ['scoring'] } }
    const res = await GET(new NextRequest('http://x/api/league/settings/co-commissioners?leagueId=L'))
    const data = await res.json()
    expect(data.max).toBe(2)
    expect(data.scopes).toEqual({
      a: { scopes: ['scoring'], configured: true },
      b: { scopes: [...CO_COMMISSIONER_SCOPES], configured: false },
    })
  })
})
