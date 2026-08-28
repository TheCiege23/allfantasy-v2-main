import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createDemoChimmyReply } from '@/lib/startSit/shared'
import { assertAiSpendAllowed, isAiSpendDisabledError } from '@/lib/ai/aiSpendGuard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Body = {
  messages?: Array<{ role: string; content: string }>
  context?: Record<string, unknown>
}

export async function POST(req: Request) {
  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ reply: 'Invalid JSON body.' }, { status: 400 })
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const userText = typeof lastUser?.content === 'string' ? lastUser.content : ''

  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY
  if (!key) {
    return NextResponse.json({ reply: createDemoChimmyReply(userText) })
  }

  try {
    // PROVIDER BOUNDARY. This route has no session check and no rate limit,
    // so the spend switch is the only thing standing between an anonymous
    // caller and a paid completion.
    assertAiSpendAllowed('start-sit.chimmy')
    const openai = new OpenAI({
      apiKey: key,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    })
    const ctx = body.context ? JSON.stringify(body.context).slice(0, 6000) : ''
    const completion = await openai.chat.completions.create({
      model: process.env.START_SIT_CHIMMY_MODEL || 'gpt-4o-mini',
      temperature: 0.35,
      max_tokens: 600,
      messages: [
        {
          role: 'system',
          content:
            'You are Chimmy — calm, evidence-first fantasy assistant for Start/Sit. Use only the structured context JSON when citing roster/injury/matchup facts; do not invent scores. Keep answers concise and actionable.',
        },
        {
          role: 'user',
          content: `Context (JSON excerpt):\n${ctx}\n\nUser message:\n${userText}`,
        },
      ],
    })
    const reply = completion.choices[0]?.message?.content?.trim() || createDemoChimmyReply(userText)
    return NextResponse.json({ reply })
  } catch (e) {
    // A refusal is not a fault: fall back to the same demo reply the
    // missing-key path returns, and do not log it as an error.
    if (isAiSpendDisabledError(e)) {
      return NextResponse.json({ reply: createDemoChimmyReply(userText) })
    }
    console.error('[start-sit/chimmy]', e)
    return NextResponse.json({ reply: createDemoChimmyReply(userText) })
  }
}
