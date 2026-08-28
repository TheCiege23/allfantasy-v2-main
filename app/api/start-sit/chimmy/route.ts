import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createDemoChimmyReply } from '@/lib/startSit/shared'
import { rateLimit } from '@/lib/rate-limit'
import { assertAiSpendAllowed, isAiSpendDisabledError } from '@/lib/ai/aiSpendGuard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Body = {
  messages?: Array<{ role: string; content: string }>
  context?: Record<string, unknown>
}

export async function POST(req: Request) {
  /*
   * SIGN-IN REQUIRED, AND IT COSTS NOTHING TO REQUIRE IT.
   *
   * This route reaches a paid completion. It previously had no session check and no
   * rate limit, so the AI spend switch — a platform-wide on/off — was the only thing
   * between an anonymous caller and gpt-4o-mini at 600 max_tokens a turn. Turning that
   * switch off to stop abuse would also have taken the feature away from paying users,
   * which is not a lever anyone wants to pull on a Sunday.
   *
   * The gate is free here because the ONLY caller is <StartSitPopup>, mounted through
   * StartSitLauncher on the dashboard (app/dashboard/DashboardShell.tsx and
   * components/dashboard/nocturne/NocturneDashboard.tsx) — and /dashboard already
   * redirects anonymous visitors to /login. Every real user of this endpoint is signed
   * in already; only a direct caller was not.
   *
   * Checked against a live probe first: anonymous POST returned 200, not 401.
   */
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ reply: 'Sign in to ask Chimmy about your lineup.' }, { status: 401 })
  }

  /*
   * Per-user, not per-IP: the IP bucket is the one an attacker rotates, and a signed-in
   * id is the thing we actually meter. Household/office NAT would also share one IP.
   */
  const rl = rateLimit(`start-sit-chimmy:${userId}`, 20, 60_000)
  if (!rl.success) {
    return NextResponse.json(
      { reply: 'You are asking faster than I can think. Give me a minute.' },
      { status: 429 },
    )
  }

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
    // PROVIDER BOUNDARY. The spend switch is no longer the only brake — the handler
    // now requires a session and meters 20/min per user id (see the top of POST) — but
    // it stays here rather than at the entry point so it still holds if a future path
    // constructs a client somewhere else in this file.
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
