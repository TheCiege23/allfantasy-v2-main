/**
 * GET/POST /api/user/ai-swap — the subscriber's own AI swap switch (lib/lineup-automation/aiSwapPolicy.ts).
 * Off until chosen; turning it ON needs AF Pro / Supreme; turning it off never does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  session: { user: { id: 'user-1' } } as { user?: { id?: string } } | null,
  read: vi.fn(),
  set: vi.fn(),
  plan: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => h.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/lineup-automation/aiSwapPolicy', () => ({
  readAiSwapPreference: h.read,
  setAiSwapPreference: h.set,
  userHasAiSwapPlan: h.plan,
}))

import { GET, POST } from '@/app/api/user/ai-swap/route'

const post = (body: unknown) => POST(createMockNextRequest('http://localhost/api/user/ai-swap', { method: 'POST', body }) as never)

beforeEach(() => {
  vi.clearAllMocks()
  h.session = { user: { id: 'user-1' } }
  h.read.mockResolvedValue({ on: false, decided: false })
  h.plan.mockResolvedValue(true)
  h.set.mockResolvedValue(undefined)
})

describe('/api/user/ai-swap', () => {
  it('reports a paid user who has never chosen as off and undecided, which is what the checkout popup asks on', async () => {
    expect(await (await GET()).json()).toEqual({ on: false, decided: false, entitled: true })
  })

  it('turns it on for a Pro / Supreme subscriber', async () => {
    const res = await post({ on: true })
    expect(res.status).toBe(200)
    expect(h.set).toHaveBeenCalledWith('user-1', true)
  })

  it('refuses to turn it on without the plan, and saves nothing', async () => {
    h.plan.mockResolvedValue(false)
    const res = await post({ on: true })
    expect(res.status).toBe(402)
    expect(h.set).not.toHaveBeenCalled()
  })

  it('always lets a user turn it off, plan or not', async () => {
    h.plan.mockResolvedValue(false)
    expect((await post({ on: false })).status).toBe(200)
    expect(h.set).toHaveBeenCalledWith('user-1', false)
  })

  it('needs a signed-in user and a boolean', async () => {
    expect((await post({ on: 'yes' })).status).toBe(400)
    h.session = null
    expect((await GET()).status).toBe(401)
  })
})
