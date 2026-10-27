// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), ctx: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: h.access }))
vi.mock('@/lib/survivor/survivorRulesContext', () => ({ loadSurvivorRulesContext: h.ctx }))

import { GET } from '@/app/api/survivor/rules/route'
import { SURVIVOR_DEFAULT_FOUNDATION_SETTINGS } from '@/lib/survivor/survivorSettings'

const get = (q = '?leagueId=L1') => {
  const url = new URL(`https://example.test/api/survivor/rules${q}`)
  return GET({ nextUrl: url } as never)
}

describe('GET /api/survivor/rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.session.mockResolvedValue({ user: { id: 'u1' } })
    h.access.mockResolvedValue({ role: 'member' })
    h.ctx.mockResolvedValue({ sport: 'NBA', settings: { ...SURVIVOR_DEFAULT_FOUNDATION_SETTINGS, idolCount: 6 }, plan: null })
  })

  it('returns the rulebook built from the league settings', async () => {
    const res = await get()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.sport).toBe('NBA')
    expect(body.sections.find((s: { topic: string }) => s.topic === 'idols').lines[0]).toContain('6 idols')
  })

  it('is members only, with one 403 for not-found and not-member', async () => {
    h.session.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    h.session.mockResolvedValue({ user: { id: 'u1' } })
    h.access.mockResolvedValue(null)
    expect((await get()).status).toBe(403)
    h.access.mockResolvedValue({ role: 'member' })
    h.ctx.mockResolvedValue(null)
    expect((await get()).status).toBe(403)
    expect((await get('')).status).toBe(400)
  })
})
