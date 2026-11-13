/**
 * The flagged manager's reply to a tanking flag (lib/integrity/managerReply.ts).
 *
 *   GET   the flag as the manager it names may see it: what was flagged, and any reply already sent
 *   POST  { text } — save or replace the reply while the case is open
 *
 * Any signed-in league member may call it, but only the manager the flag names gets anything back;
 * everyone else gets 404, never a hint the flag exists. Free on every tier: a manager's right to
 * explain does not depend on the commissioner's plan.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { resolveLeagueMembership } from '@/lib/league-access'
import { loadFlagForManager, REPLY_ERROR_STATUS, submitManagerReply } from '@/lib/integrity/managerReply'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string; flagId: string }> }

async function gate(ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const { leagueId, flagId } = await ctx.params
  if (!leagueId || !flagId) return { error: NextResponse.json({ error: 'Missing params' }, { status: 400 }) } as const
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const
  }
  return { leagueId, flagId, userId } as const
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const flag = await loadFlagForManager(g.leagueId, g.flagId, g.userId)
  if (!flag) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ flag })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx)
  if ('error' in g) return g.error
  const body = (await req.json().catch(() => ({}))) as { text?: unknown }
  const result = await submitManagerReply(g.leagueId, g.flagId, g.userId, body.text)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: REPLY_ERROR_STATUS[result.error] })
  return NextResponse.json({ flag: result.view })
}
