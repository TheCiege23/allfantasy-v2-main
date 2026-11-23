import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readAiSwapPreference, setAiSwapPreference, userHasAiSwapPlan } from '@/lib/lineup-automation/aiSwapPolicy'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/user/ai-swap — { on, decided, entitled }: the user's AI swap switch, whether they have ever
 *      chosen, and whether their plan (AF Pro / Supreme) lets it run.
 * POST /api/user/ai-swap { on: boolean } — set it. Turning it ON needs the plan; turning it off never does.
 *
 * AI swap is OFF until the user turns it on (lib/lineup-automation/aiSwapPolicy.ts). The checkout screen asks
 * once after a Pro / Supreme purchase (`decided` false), and Settings holds the switch after that.
 */
async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET() {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [choice, entitled] = await Promise.all([readAiSwapPreference(userId), userHasAiSwapPlan(userId)])
  return NextResponse.json({ on: choice.on, decided: choice.decided, entitled })
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { on?: unknown } | null
  if (typeof body?.on !== 'boolean') return NextResponse.json({ error: 'Send on: true or false.' }, { status: 400 })
  if (body.on && !(await userHasAiSwapPlan(userId))) {
    return NextResponse.json({ error: 'Chimmy Auto-Swap needs AF Pro or AF Supreme.', upgradeUrl: '/pro' }, { status: 402 })
  }
  try {
    await setAiSwapPreference(userId, body.on)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save. Try again.' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, on: body.on, decided: true })
}
