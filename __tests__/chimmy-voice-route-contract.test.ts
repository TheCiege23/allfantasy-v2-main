import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
const fetchMock = vi.fn()
const getServerSessionMock = vi.fn()
const aiCostGateMock = vi.fn()

vi.stubGlobal('fetch', fetchMock)

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

// The real gate reads the plan from the DB and, from paywall launch, refuses a caller without
// one, which turned every test below into a 403. This file pins the route's own contract; the
// gate's decisions are covered by ai-cost-gate-wiring.test.ts.
vi.mock('@/lib/ai-protection/costGate', () => ({
  aiCostGate: aiCostGateMock,
}))

function buildRequest(body: Record<string, unknown>) {
  return createMockNextRequest('http://localhost/api/chimmy/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/chimmy/voice contract', () => {
  const originalEnv = {
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
    ELEVENLABS_MODEL_ID: process.env.ELEVENLABS_MODEL_ID,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_TTS_MODEL: process.env.OPENAI_TTS_MODEL,
    AI_INTEGRATIONS_OPENAI_API_KEY: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    AI_INTEGRATIONS_OPENAI_BASE_URL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  }

  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
    getServerSessionMock.mockReset()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    aiCostGateMock.mockReset()
    aiCostGateMock.mockResolvedValue(null)
    delete process.env.ELEVENLABS_API_KEY
    delete process.env.ELEVENLABS_VOICE_ID
    delete process.env.ELEVENLABS_MODEL_ID
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_TTS_MODEL
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('returns 401 when the user is not authenticated', async () => {
    getServerSessionMock.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/chimmy/voice/route')
    const response = await POST(buildRequest({ text: 'Read this aloud.' }) as any)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Unauthorized',
    })
  })

  it('returns the cost gate refusal without calling a voice provider', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-eleven-key'
    process.env.ELEVENLABS_VOICE_ID = 'allison-voice-id'
    aiCostGateMock.mockResolvedValueOnce(
      Response.json({ error: 'Premium feature', code: 'feature_not_entitled' }, { status: 403 })
    )

    const { POST } = await import('@/app/api/chimmy/voice/route')
    const response = await POST(buildRequest({ text: 'Read this aloud.' }) as any)

    expect(aiCostGateMock).toHaveBeenCalledWith(expect.anything(), 'chimmy_voice', 'user-1')
    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ code: 'feature_not_entitled' })
  })

  it('returns 400 for empty text', async () => {
    const { POST } = await import('@/app/api/chimmy/voice/route')
    const response = await POST(buildRequest({ text: '   ' }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'text is required',
    })
  })

  it('uses ElevenLabs when a Chimmy voice id is configured', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-eleven-key'
    process.env.ELEVENLABS_VOICE_ID = 'allison-voice-id'
    fetchMock.mockResolvedValueOnce(
      new Response('ELEVEN_AUDIO', {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      })
    )

    const { POST } = await import('@/app/api/chimmy/voice/route')
    const response = await POST(buildRequest({ text: 'Read this with Allison energy.' }) as any)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toContain('/v1/text-to-speech/allison-voice-id')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Chimmy-Voice-Provider')).toBe('elevenlabs')
    expect(response.headers.get('X-Voice-Name')).toBe('Allison')
  })

  it('falls back to OpenAI TTS when ElevenLabs is unavailable', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    fetchMock.mockResolvedValueOnce(
      new Response('OPENAI_AUDIO', {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      })
    )

    const { POST } = await import('@/app/api/chimmy/voice/route')
    const response = await POST(buildRequest({ text: 'Give me the upbeat Allison read.' }) as any)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toContain('/audio/speech')
    expect(String(fetchMock.mock.calls[0]?.[1]?.body ?? '')).toContain('"voice":"nova"')
    expect(String(fetchMock.mock.calls[0]?.[1]?.body ?? '')).toContain('"speed":1.05')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Chimmy-Voice-Provider')).toBe('openai')
  })

  it('returns 503 when no voice provider is configured', async () => {
    const { POST } = await import('@/app/api/chimmy/voice/route')
    const response = await POST(buildRequest({ text: 'Fallback please.' }) as any)

    expect(response.status).toBe(503)
    expect(response.headers.get('X-Chimmy-Voice-Fallback')).toBe('browser')
    await expect(response.json()).resolves.toMatchObject({
      error: 'TTS not configured',
    })
  })
})
