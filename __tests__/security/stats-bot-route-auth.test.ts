import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Chat Stats Bot route wrote into any DM or huddle for anyone who asked — no session, no
 * membership, no secret (live test 2026-09-25). It is for an internal job or an admin only. This runs
 * the REAL gate (`requireAdminOrBearer`); only the session and cookie sources are stubbed.
 */

const h = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email?: string } },
  create: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: async () => h.session }))
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/platform/chat-service', () => ({ createStatsBotMessage: h.create }))

import { POST } from '@/app/api/shared/chat/threads/[threadId]/stats-bot/route'

const ADMIN = 'test-admin-password-not-real'

function post(headers: Record<string, string> = {}) {
  const req = new Request('http://localhost/api/shared/chat/threads/t1/stats-bot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ weekLabel: 'Week 3', bestTeam: 'Forged' }),
  })
  return POST(req as never, { params: { threadId: 't1' } })
}

beforeEach(() => {
  h.session = null
  h.create.mockReset()
  h.create.mockResolvedValue({ id: 'm1' })
  vi.stubEnv('ADMIN_PASSWORD', ADMIN)
  vi.stubEnv('BRACKET_ADMIN_SECRET', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/shared/chat/threads/[threadId]/stats-bot', () => {
  it('🛑 refuses an anonymous request and writes nothing', async () => {
    const res = await post()
    expect(res.status).toBe(401)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('🛑 refuses a signed-in member who is not an admin', async () => {
    h.session = { user: { id: 'u1', email: 'member@example.test' } }
    const res = await post()
    expect(res.status).toBe(403)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('refuses a wrong bearer token', async () => {
    const res = await post({ authorization: 'Bearer not-the-password' })
    expect(res.status).toBe(401)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('an internal job with the admin bearer still posts', async () => {
    const res = await post({ authorization: `Bearer ${ADMIN}` })
    expect(res.status).toBe(200)
    expect(h.create).toHaveBeenCalledWith('t1', expect.objectContaining({ weekLabel: 'Week 3', bestTeam: 'Forged' }))
  })
})
