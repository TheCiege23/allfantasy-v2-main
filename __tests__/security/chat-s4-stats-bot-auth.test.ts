/**
 * S4 (server-owned message types) — `/api/shared/chat/threads/[threadId]/stats-bot` wrote a
 * `stats_bot` system message (no sender, rendered as the Chat Stats Bot) into any thread for ANY
 * caller, signed in or not. It is a job endpoint with no caller in the app, so it now requires the
 * admin/bearer credential (`requireAdminOrBearer`, lib/adminAuth.ts — the REAL one runs here).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: null as { user?: { id?: string; email?: string } } | null,
  createStatsBotMessage: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }) }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => h.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/platform/chat-service', () => ({ createStatsBotMessage: h.createStatsBotMessage }))

import { POST } from '@/app/api/shared/chat/threads/[threadId]/stats-bot/route'

function call(headers: Record<string, string> = {}) {
  const req = new Request('http://localhost/api/shared/chat/threads/t1/stats-bot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ weekLabel: 'Week 3', bestTeam: 'Forged FC' }),
  })
  return POST(req as never, { params: { threadId: 't1' } } as never)
}

beforeEach(() => {
  h.session = null
  h.createStatsBotMessage.mockReset()
  h.createStatsBotMessage.mockResolvedValue({ id: 'sb-1', messageType: 'stats_bot' })
  vi.stubEnv('ADMIN_PASSWORD', 'test-admin-password-not-real')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('S4 stats-bot job endpoint', () => {
  it('refuses an anonymous caller and writes nothing', async () => {
    const res = await call()
    expect(res.status).toBe(401)
    expect(h.createStatsBotMessage).not.toHaveBeenCalled()
  })

  it('refuses an ordinary signed-in member and writes nothing', async () => {
    h.session = { user: { id: 'member-1', email: 'member@example.test' } }
    const res = await call()
    expect(res.status).toBe(403)
    expect(h.createStatsBotMessage).not.toHaveBeenCalled()
  })

  it('refuses a wrong bearer token', async () => {
    expect((await call({ authorization: 'Bearer nope' })).status).toBe(401)
    expect(h.createStatsBotMessage).not.toHaveBeenCalled()
  })

  it('still lets the job post with the admin bearer credential', async () => {
    const res = await call({ authorization: 'Bearer test-admin-password-not-real' })
    expect(res.status).toBe(200)
    expect(h.createStatsBotMessage).toHaveBeenCalledTimes(1)
  })
})
