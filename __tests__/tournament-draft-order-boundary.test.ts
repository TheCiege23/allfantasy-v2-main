import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ user: 'owner' as string | null, commissioner: true, settings: {} as unknown, writes: vi.fn(), read: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: async () => m.user ? { user: { id: m.user } } : null }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: async () => m.commissioner }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: async () => true }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: async () => ({ settings: m.settings }) },
  draftSession: { findFirst: m.read, update: m.writes },
} }))
import { PATCH, GET } from '@/app/api/leagues/[leagueId]/draft/order/route'
const ctx = { params: Promise.resolve({ leagueId: 'native' }) }
const request = () => new Request('https://local.test/api', { method: 'PATCH', body: JSON.stringify({ slotOrder: [{ slot: 1, rosterId: 'r1', displayName: 'Team' }] }) }) as any
beforeEach(() => { vi.clearAllMocks(); m.user = 'owner'; m.commissioner = true; m.settings = {}; m.read.mockResolvedValue({ id: 'd1', status: 'pre_draft', teamCount: 1, slotOrder: [] }); m.writes.mockResolvedValue({}) })
describe('tournament order API mutation boundary', () => {
  it.each([null, {}, { freezeId: 'invalid' }])('rejects any native marker even with a pre_draft status: %j', async marker => {
    m.settings = { seasonTournament: marker }
    const response = await PATCH(request(), ctx)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'TOURNAMENT_RULES_FROZEN' })
    expect(m.read).not.toHaveBeenCalled()
    expect(m.writes).not.toHaveBeenCalled()
  })
  it('retains ordinary commissioner order updates', async () => {
    expect((await PATCH(request(), ctx)).status).toBe(200)
    expect(m.writes).toHaveBeenCalledOnce()
  })
  it('preserves access checks before the frozen-rules response', async () => {
    m.settings = { seasonTournament: {} }; m.user = null
    expect((await PATCH(request(), ctx)).status).toBe(401)
    m.user = 'member'; m.commissioner = false
    expect((await PATCH(request(), ctx)).status).toBe(403)
    expect(m.writes).not.toHaveBeenCalled()
  })
  it('keeps authorized read access to frozen tournament orders', async () => {
    m.settings = { seasonTournament: {} }
    expect((await GET(request(), ctx)).status).toBe(200)
    expect(m.writes).not.toHaveBeenCalled()
  })
})
