// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hm = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  resolveLeagueAccess: vi.fn(),
  handleChimmyPrivateMessage: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: hm.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: hm.resolveLeagueAccess }))
vi.mock('@/lib/survivor/chimmyHandler', () => ({ handleChimmyPrivateMessage: hm.handleChimmyPrivateMessage }))

async function post(body: unknown) {
  const { POST } = await import('@/app/api/survivor/chimmy/route')
  const req = new Request('http://localhost/api/survivor/chimmy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const res = await POST(req as never)
  return { status: res.status, body: await res.json() }
}

describe('POST /api/survivor/chimmy — league membership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
    hm.resolveLeagueAccess.mockResolvedValue({ isMember: true, isCommissioner: false })
    hm.handleChimmyPrivateMessage.mockResolvedValue('You are ACTIVE on the main island.')
  })

  it('refuses a signed-in user who is not in the league, before the handler runs', async () => {
    // The idol-probe branch writes a survivorHostMessage row for whatever leagueId it is given,
    // so reaching the handler at all is the leak.
    hm.resolveLeagueAccess.mockResolvedValue(null)
    const res = await post({ leagueId: 'league-1', message: 'who has an idol' })
    expect(res.status).toBe(403)
    expect(hm.resolveLeagueAccess).toHaveBeenCalledWith('league-1', 'user-1')
    expect(hm.handleChimmyPrivateMessage).not.toHaveBeenCalled()
  })

  it('answers a member of the league', async () => {
    const res = await post({ leagueId: 'league-1', message: 'my status' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ reply: 'You are ACTIVE on the main island.' })
    expect(hm.handleChimmyPrivateMessage).toHaveBeenCalledWith('league-1', 'user-1', 'my status')
  })

  it('checks the session user, not a userId supplied in the body', async () => {
    await post({ leagueId: 'league-1', message: 'my status', userId: 'someone-else' })
    expect(hm.resolveLeagueAccess).toHaveBeenCalledWith('league-1', 'user-1')
    expect(hm.handleChimmyPrivateMessage).toHaveBeenCalledWith('league-1', 'user-1', 'my status')
  })

  it('rejects an anonymous caller without looking up membership', async () => {
    hm.getServerSession.mockResolvedValue(null)
    const res = await post({ leagueId: 'league-1', message: 'my status' })
    expect(res.status).toBe(401)
    expect(hm.resolveLeagueAccess).not.toHaveBeenCalled()
    expect(hm.handleChimmyPrivateMessage).not.toHaveBeenCalled()
  })

  it('validates the body without looking up membership', async () => {
    const res = await post({ leagueId: 'league-1' })
    expect(res.status).toBe(400)
    expect(hm.resolveLeagueAccess).not.toHaveBeenCalled()
    expect(hm.handleChimmyPrivateMessage).not.toHaveBeenCalled()
  })
})
