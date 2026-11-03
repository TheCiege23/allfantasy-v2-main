import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), context: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: h.access }))
vi.mock('@/lib/chimmy/liveFantasyMatchupGrounding', () => ({ buildLiveFantasyMatchupContext: h.context }))

import { GET } from '@/app/api/chat/chimmy/live-matchup/route'

const request = () => new NextRequest('http://localhost/api/chat/chimmy/live-matchup?leagueId=L1')

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.access.mockResolvedValue({ leagueId: 'L1' })
  h.context.mockResolvedValue('CURRENT SCORE ON FILE: your team 90.00')
})

describe('Chimmy live matchup refresh', () => {
  it('requires an authenticated member before reading a score', async () => {
    h.session.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(401)
    expect(h.context).not.toHaveBeenCalled()
    h.session.mockResolvedValue({ user: { id: 'u1' } })
    h.access.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(403)
    expect(h.context).not.toHaveBeenCalled()
  })

  it('returns a private uncached score read without invoking the chat model', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ context: 'CURRENT SCORE ON FILE: your team 90.00',
      readAt: expect.any(String) })
    expect(h.context).toHaveBeenCalledWith({ leagueId: 'L1', userId: 'u1' })
  })
})
