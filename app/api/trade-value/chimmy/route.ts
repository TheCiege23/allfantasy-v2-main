import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import { CHIMMY_TRADE_SYSTEM_PROMPT } from '@/lib/trade-value-console/chimmy-prompt'

export async function POST(req: Request) {
  const ip = getClientIp(req as any) || 'unknown'
  const rl = rateLimit(`trade-value-chimmy:${ip}`, 10, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const gated = await aiCostGate(req, 'trade_ai', session.user.id)
  if (gated) return gated

  let payload: Record<string, unknown> = {}
  try {
    const j = await req.json()
    if (j && typeof j.payload === 'object' && j.payload !== null) {
      payload = j.payload as Record<string, unknown>
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const result = await openaiChatJson({
      messages: [
        { role: 'system', content: CHIMMY_TRADE_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ payload, userNote: 'Explain this trade using only the payload facts.' }) },
      ],
      temperature: 0.2,
      maxTokens: 700,
    })

    if (!result.ok) {
      return NextResponse.json({ error: 'AI unavailable' }, { status: 503 })
    }

    const parsed = parseJsonContentFromChatCompletion(result.json)
    return NextResponse.json({ chimmy: parsed ?? { raw: result.json } })
  } catch (e) {
    console.error('[trade-value/chimmy]', e)
    return NextResponse.json({ error: 'Chimmy failed' }, { status: 500 })
  }
}
