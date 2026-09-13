// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  access: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: hm.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/zombie/zombieUniverseAccess', () => ({ resolveZombieUniverseAccess: hm.access }))
vi.mock('@/lib/zombie/ZombieUniverseProjectionService', () => ({ refreshMovementProjections: hm.refresh }))
// Modules the overwritten (Whisperer-route) file imports, so the pre-fix run fails on assertions.
vi.mock('@/lib/prisma', () => ({ prisma: { zombieLeague: { findUnique: vi.fn(async () => null) } } }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerOnly: vi.fn() }))
vi.mock('@/lib/zombie/whispererEngine', () => ({ applyAmbush: vi.fn(), selectWhisperer: vi.fn() }))

async function post(userId: string) {
  hm.getServerSession.mockResolvedValue({ user: { id: userId } })
  const { POST } = await import('@/app/api/zombie-universe/[universeId]/refresh/route')
  const req = new Request('http://localhost/api/zombie-universe/uni-1/refresh?season=2026', { method: 'POST' })
  const res = await POST(req as never, { params: Promise.resolve({ universeId: 'uni-1' }) })
  const text = await res.text()
  return { status: res.status, body: JSON.parse(text) }
}

describe('POST /api/zombie-universe/[universeId]/refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.refresh.mockResolvedValue(undefined)
  })

  it('refreshes projections for the universe owner', async () => {
    hm.access.mockResolvedValue({ exists: true, isOwner: true, isMember: true })
    const res = await post('user-owner')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, universeId: 'uni-1', season: 2026 })
    expect(hm.refresh).toHaveBeenCalledWith('uni-1', 2026)
  })

  it('refuses a member who is not the owner, without writing', async () => {
    hm.access.mockResolvedValue({ exists: true, isOwner: false, isMember: true })
    const res = await post('user-member')
    expect(res.status).toBe(403)
    expect(hm.refresh).not.toHaveBeenCalled()
  })

  it('reports an unknown universe', async () => {
    hm.access.mockResolvedValue({ exists: false, isOwner: false, isMember: false })
    expect((await post('user-owner')).status).toBe(404)
  })
})
