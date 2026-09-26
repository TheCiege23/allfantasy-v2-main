/**
 * Who may press "Post FAQ & pin" (Survivor settings → League chat FAQ).
 *
 * 🛑 THE SCREEN AND THE ROUTE DISAGREED. The panel enables the button from `/api/league/settings`'s
 * `canEdit` — commissioner OR co_commissioner — and the route refused anyone but `league.userId`,
 * so a co-commissioner saw an enabled button that answered "Commissioner only" (09-25 handoff:
 * "Survivor FAQ posting is still head-commissioner only").
 *
 * The REAL `getLeagueRole` runs here over an in-memory league and team, so these assert the
 * canonical rule itself rather than a mock of it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  userId: 'u-owner' as string | null,
  team: null as null | { isCommissioner: boolean; isCoCommissioner: boolean; role: string },
  seed: vi.fn(async () => ({ ok: true as const, messageId: 'faq-1' })),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => (h.userId ? { user: { id: h.userId } } : null)) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => true) }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ isSurvivorLeague: vi.fn(async () => true) }))
vi.mock('@/lib/survivor/survivorFaq', () => ({ seedSurvivorFaqToLeagueChat: h.seed }))
vi.mock('@/lib/prisma', () => {
  const prisma = {
    league: { findFirst: vi.fn(async () => ({ userId: 'u-owner' })) },
    leagueTeam: { findFirst: vi.fn(async () => h.team) },
  }
  return { prisma, default: prisma }
})

import { POST } from '@/server/api-route-modules/league-survivor/seed-faq/route'

async function press(userId: string | null) {
  h.userId = userId
  const req = new Request('http://x/api/leagues/L1/survivor/seed-faq', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: true }),
  })
  const res = await POST(req as never, { params: Promise.resolve({ leagueId: 'L1' }) })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.team = null
})

describe('Survivor FAQ posting', () => {
  it('lets the head commissioner post it', async () => {
    const out = await press('u-owner')
    expect(out.status).toBe(200)
    expect(h.seed).toHaveBeenCalledWith({ leagueId: 'L1', commissionerUserId: 'u-owner', force: true })
  })

  it('lets a co-commissioner post it — under their own name', async () => {
    h.team = { isCommissioner: false, isCoCommissioner: true, role: 'member' }
    const out = await press('u-co')
    expect(out).toEqual({ status: 200, body: { ok: true, messageId: 'faq-1' } })
    expect(h.seed).toHaveBeenCalledWith({ leagueId: 'L1', commissionerUserId: 'u-co', force: true })
  })

  it('refuses a plain member, and posts nothing', async () => {
    h.team = { isCommissioner: false, isCoCommissioner: false, role: 'member' }
    const out = await press('u-member')
    expect(out.status).toBe(403)
    expect(out.body.error).toMatch(/commissioner or co-commissioner/i)
    expect(h.seed).not.toHaveBeenCalled()
  })

  /* A viewer seat outranks a stale co-commissioner flag in getLeagueRole; the FAQ follows it. */
  it('refuses a viewer even if the seat still carries a co-commissioner flag', async () => {
    h.team = { isCommissioner: false, isCoCommissioner: true, role: 'viewer' }
    expect((await press('u-viewer')).status).toBe(403)
    expect(h.seed).not.toHaveBeenCalled()
  })

  it('refuses anyone signed out', async () => {
    expect((await press(null)).status).toBe(401)
    expect(h.seed).not.toHaveBeenCalled()
  })
})
