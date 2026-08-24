import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { executeSimulateBody, simulateBodySchema } from '@/lib/ai/sim/simulateApiCore'
import { computeGroundedTradeDelta } from '@/lib/ai/sim/groundedTradeDelta'
import type { GroundedTradeDelta } from '@/lib/ai/sim/types'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request) {
  const ip = getClientIp(req as never) || 'unknown'
  const rl = rateLimit(`ai-sim:${ip}`, 20, 60_000)
  if (!rl.success) {
    return NextResponse.json({ error: 'Too many simulation requests' }, { status: 429 })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const json = await req.json().catch(() => null)
  const parsed = simulateBodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = executeSimulateBody(parsed.data)
    // P4-8: real playoff-relevant odds where the real engine can run. The
    // grounded delta comes from the Gaussian win-probability engine over the
    // league's ACTUAL remaining schedule; whenever any input fails to resolve it
    // returns a labeled refusal and the synthetic estimate labels stand.
    if (parsed.data.kind === 'trade' && parsed.data.leagueGrounding) {
      const grounding = parsed.data.leagueGrounding
      const leagueGrounded: GroundedTradeDelta = await computeGroundedTradeDelta({
        leagueId: grounding.leagueId,
        userId: session.user?.id ?? '',
        sent: grounding.sent,
        received: grounding.received,
      }).catch(() => ({ available: false as const, reason: 'the real-schedule engine failed to run' }))
      return NextResponse.json({ ok: true, result: { ...(result as Record<string, unknown>), leagueGrounded } })
    }
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    console.error('[api/ai/simulate]', e)
    return NextResponse.json({ error: 'Simulation failed' }, { status: 500 })
  }
}
