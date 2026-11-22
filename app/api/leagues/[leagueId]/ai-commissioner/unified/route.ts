import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import {
  applyUnifiedCommissionerAction,
  getUnifiedCommissionerAssessment,
} from '@/lib/ai-commissioner'

export const dynamic = 'force-dynamic'

const ActionBodySchema = z.object({
  actionKey: z.enum([
    'enable_ai_alerts',
    'enable_collusion_monitoring',
    'tighten_trade_review_window',
    'set_playoff_defaults',
    'promote_commissioner_notifications',
    'run_commissioner_cycle',
  ]),
  confirmed: z.boolean().default(false),
  payload: z.record(z.string(), z.unknown()).optional(),
})

async function getSessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissionerAccess(leagueId, userId, 'view')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const assessment = await getUnifiedCommissionerAssessment({ leagueId })
    return NextResponse.json({ ok: true, assessment })
  } catch (error) {
    console.error('[ai-commissioner/unified GET]', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to build unified commissioner assessment' }, { status: 500 })
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissionerAccess(leagueId, userId, 'league')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = ActionBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await applyUnifiedCommissionerAction({
      leagueId,
      userId,
      actionKey: parsed.data.actionKey,
      confirmed: parsed.data.confirmed,
      payload: parsed.data.payload,
    })
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error('[ai-commissioner/unified POST]', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to apply unified commissioner action' }, { status: 500 })
  }
}
