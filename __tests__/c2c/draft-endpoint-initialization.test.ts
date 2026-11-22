import { describe, expect, it, vi } from 'vitest'

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'member' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/c2c/draftFormatEngine', () => ({ buildC2CDraftRoom: vi.fn() }))
import { POST } from '@/app/api/c2c/draft/route'

describe('legacy C2C draft initialization', () => {
  it('does not report a draft initialized when no session was created', async () => {
    const req = new Request('http://localhost/api/c2c/draft', { method: 'POST', body: JSON.stringify({ leagueId: 'league 1' }) }) as never
    const response = await POST(req)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ initialized: false, sessionEndpoint: '/api/leagues/league%201/draft/session' })
  })
})
