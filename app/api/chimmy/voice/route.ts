import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getOpenAIConfigFromEnv } from '@/lib/provider-config'
import { aiCostGate } from '@/lib/ai-protection/costGate'

const MAX_TTS_CHARS = 500
const OPENAI_TTS_MODEL = 'tts-1'
const OPENAI_TTS_VOICE = 'nova'
const OPENAI_TTS_SPEED = 1.05
const ELEVENLABS_DEFAULT_MODEL = 'eleven_turbo_v2'
const ELEVENLABS_RACHEL_PREMADE_ID = '21m00Tcm4TlvDq8ikWAM'

function normalizeTtsInput(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[_*`>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function trimTtsInput(raw: string): string {
  const normalized = normalizeTtsInput(raw)
  if (normalized.length <= MAX_TTS_CHARS) return normalized
  return `${normalized.slice(0, MAX_TTS_CHARS - 3)}...`
}

function getAllisonElevenLabsVoiceId(): string {
  return (
    process.env.ELEVENLABS_VOICE_ID?.trim() ||
    process.env.ELEVENLABS_RACHEL_VOICE_ID?.trim() ||
    ELEVENLABS_RACHEL_PREMADE_ID
  )
}

async function synthesizeWithElevenLabs(text: string): Promise<Response | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim()
  if (!apiKey) return null

  const voiceId = getAllisonElevenLabsVoiceId()

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL_ID?.trim() || ELEVENLABS_DEFAULT_MODEL,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  })

  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`ElevenLabs Chimmy voice failed (${response.status}): ${details || 'Unknown error'}`)
  }

  return response
}

async function synthesizeWithOpenAi(text: string): Promise<Response | null> {
  const config = getOpenAIConfigFromEnv()
  if (!config) return null

  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL?.trim() || OPENAI_TTS_MODEL,
      voice: OPENAI_TTS_VOICE,
      input: text,
      speed: OPENAI_TTS_SPEED,
      response_format: 'mp3',
    }),
  })

  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`OpenAI Chimmy voice failed (${response.status}): ${details || 'Unknown error'}`)
  }

  return response
}

function buildAudioResponse(args: {
  provider: 'elevenlabs' | 'openai'
  upstream: Response
}) {
  return new Response(args.upstream.body, {
    status: 200,
    headers: {
      'Content-Type': args.upstream.headers.get('content-type') || 'audio/mpeg',
      'Cache-Control': 'no-store',
      'X-Voice-Name': 'Allison',
      'X-Voice-Model': args.provider === 'openai' ? OPENAI_TTS_VOICE : 'elevenlabs',
      'X-Chimmy-Voice-Provider': args.provider,
    },
  })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ElevenLabs / OpenAI text-to-speech on every call, previously with no limit at all.
  const gated = await aiCostGate(req, 'chimmy_voice', session.user.id)
  if (gated) return gated

  let text = ''
  try {
    const body = (await req.json()) as { text?: unknown }
    text = trimTtsInput(String(body?.text ?? ''))
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  try {
    const elevenLabsAudio = await synthesizeWithElevenLabs(text).catch((error) => {
      console.error('[api/chimmy/voice] ElevenLabs synthesis failed:', error)
      return null
    })

    if (elevenLabsAudio) {
      return buildAudioResponse({
        provider: 'elevenlabs',
        upstream: elevenLabsAudio,
      })
    }

    const openAiAudio = await synthesizeWithOpenAi(text).catch((error) => {
      console.error('[api/chimmy/voice] OpenAI synthesis failed:', error)
      return null
    })

    if (openAiAudio) {
      return buildAudioResponse({
        provider: 'openai',
        upstream: openAiAudio,
      })
    }

    return NextResponse.json(
      { error: 'TTS not configured' },
      {
        status: 503,
        headers: {
          'X-Chimmy-Voice-Fallback': 'browser',
        },
      }
    )
  } catch (error) {
    console.error('[api/chimmy/voice] TTS generation failed:', error)
    return NextResponse.json(
      { error: 'TTS generation failed' },
      {
        status: 500,
        headers: {
          'X-Chimmy-Voice-Fallback': 'browser',
        },
      }
    )
  }
}

export const dynamic = 'force-dynamic'
