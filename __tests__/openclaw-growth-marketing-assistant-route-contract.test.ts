import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
const getServerSessionMock = vi.fn()
const runAiProtectionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const getOpenClawGrowthConfigMock = vi.fn()
const getOpenClawGrowthPublicMetaMock = vi.fn()
const buildOpenClawGrowthTargetUrlMock = vi.fn()
const logAiOutputMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/ai-protection', () => ({
  runAiProtection: runAiProtectionMock,
}))

vi.mock('@/lib/league-access', () => ({
  assertLeagueMember: assertLeagueMemberMock,
}))

vi.mock('@/lib/openclaw/config', () => ({
  getOpenClawGrowthConfig: getOpenClawGrowthConfigMock,
  getOpenClawGrowthPublicMeta: getOpenClawGrowthPublicMetaMock,
  buildOpenClawGrowthTargetUrl: buildOpenClawGrowthTargetUrlMock,
}))

vi.mock('@/lib/ai/output-logger', () => ({
  logAiOutput: logAiOutputMock,
}))

const requireAdminMock = vi.fn()
vi.mock('@/lib/adminAuth', () => ({ requireAdmin: requireAdminMock }))

describe('Openclaw growth marketing assistant route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runAiProtectionMock.mockResolvedValue(null)
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    getOpenClawGrowthConfigMock.mockReturnValue({
      token: 'test-token',
      gatewayUrl: 'wss://webui.clawship.ai/allfantasy-growth-marketing-assistant/ws',
      webUiUrl: 'https://webui.clawship.ai/allfantasy-growth-marketing-assistant/',
    })
    getOpenClawGrowthPublicMetaMock.mockReturnValue({
      webUiUrl: 'https://webui.clawship.ai/allfantasy-growth-marketing-assistant/',
      gatewayUrl: 'wss://webui.clawship.ai/allfantasy-growth-marketing-assistant/ws',
    })
    buildOpenClawGrowthTargetUrlMock.mockReturnValue('https://webui.clawship.ai/allfantasy-growth-marketing-assistant/')
    vi.stubGlobal('fetch', vi.fn())
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: 'user-1', role: 'admin' } })
  })

  it('returns 403 for a signed-in NON-admin and never calls upstream', async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, res: new Response(null, { status: 403 }) })
    const { POST } = await import('@/app/api/ai/openclaw/growth-marketing-assistant/route')
    const req = createMockNextRequest('http://localhost/api/ai/openclaw/growth-marketing-assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/ai/openclaw/growth-marketing-assistant/route')

    const req = createMockNextRequest('http://localhost/api/ai/openclaw/growth-marketing-assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 when league access check fails', async () => {
    assertLeagueMemberMock.mockRejectedValueOnce(new Error('Forbidden'))
    const { POST } = await import('@/app/api/ai/openclaw/growth-marketing-assistant/route')

    const req = createMockNextRequest('http://localhost/api/ai/openclaw/growth-marketing-assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello', leagueId: 'league-1' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(403)
  })

  it('proxies upstream response and logs output', async () => {
    const fetchMock = vi.mocked(global.fetch)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ answer: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const { POST } = await import('@/app/api/ai/openclaw/growth-marketing-assistant/route')

    const req = createMockNextRequest('http://localhost/api/ai/openclaw/growth-marketing-assistant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, data: { answer: 'ok' } })
    expect(logAiOutputMock).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
