import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

const getServerSessionMock = vi.fn()
const checkProviderAvailabilityMock = vi.fn()
const isOpenClawConfiguredMock = vi.fn()
const isOpenClawGrowthConfiguredMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/ai-orchestration', () => ({
  checkProviderAvailability: checkProviderAvailabilityMock,
}))

vi.mock('@/lib/openclaw/config', () => ({
  isOpenClawConfigured: isOpenClawConfiguredMock,
  isOpenClawGrowthConfigured: isOpenClawGrowthConfiguredMock,
}))

describe('GET /api/ai/providers contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isOpenClawConfiguredMock.mockReturnValue(false)
    isOpenClawGrowthConfiguredMock.mockReturnValue(false)
  })

  it('returns 401 when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValue(null)

    const { GET } = await import('@/app/api/ai/providers/route')
    const res = await GET(createMockNextRequest('http://localhost/api/ai/providers'))

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns stable provider metadata contract with sport-aware roles', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    checkProviderAvailabilityMock.mockReturnValue({
      openai: true,
      deepseek: false,
      grok: true,
    })
    isOpenClawConfiguredMock.mockReturnValue(true)
    isOpenClawGrowthConfiguredMock.mockReturnValue(false)

    const { GET } = await import('@/app/api/ai/providers/route')
    const res = await GET(createMockNextRequest('http://localhost/api/ai/providers'))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchInlineSnapshot(`
      {
        "availability": {
          "deepseek": false,
          "grok": true,
          "openai": true,
          "openclaw": true,
          "openclawGrowth": false,
        },
        "endpoints": {
          "health": "/api/ai/providers/health",
          "status": "/api/ai/providers/status",
        },
        "health": null,
        "providers": [
          {
            "available": true,
            "id": "openai",
            "name": "OpenAI",
            "role": "Sport-aware user explanations, draft/waiver advice, roster suggestions, matchup summaries",
          },
          {
            "available": false,
            "id": "deepseek",
            "name": "DeepSeek",
            "role": "Sport-aware statistical modeling, projections, and matchup scoring context",
          },
          {
            "available": true,
            "id": "grok",
            "name": "Grok",
            "role": "Sport-aware trend detection, narrative context, and storyline framing",
          },
          {
            "available": true,
            "id": "openclaw",
            "name": "OpenClaw Dev Assistant",
            "role": "Workflow assistant routing for development and Chimmy operations support",
          },
          {
            "available": false,
            "id": "openclaw-growth",
            "name": "OpenClaw Growth Assistant",
            "role": "Growth and engagement workflow assistant routing for campaign support",
          },
        ],
      }
    `)
  })
})
