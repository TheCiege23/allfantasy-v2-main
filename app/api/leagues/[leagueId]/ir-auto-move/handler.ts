/**
 * IR auto-move (lib/ir-activation): an activated player on IR is moved to the bench. AF Commissioner.
 *
 *   GET   commissioner / co-commissioner — the rule, whether the owner's plan allows it, and every team
 *         with an activated player still on IR
 *   POST  { rule: { enabled } }  through the league settings save, so the plan check, the
 *         co-commissioner permissions, the settings lock and the audit log all apply
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readIrAutoMoveView } from '@/lib/ir-activation/irAutoMoveService'
import { IR_AUTO_MOVE_KEY } from '@/lib/ir-activation/irAutoMove'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await readIrAutoMoveView(leagueId, userId)
  if (!r.ok) return NextResponse.json({ error: r.status === 404 ? 'League not found' : 'Forbidden' }, { status: r.status })
  return NextResponse.json(r.view, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { rule?: unknown } | null
  if (!body || !('rule' in body)) return NextResponse.json({ error: 'Send the rule to save.' }, { status: 400 })
  return executeLeagueSettingsPatch(userId, { leagueId, settingsMerge: { [IR_AUTO_MOVE_KEY]: body.rule } })
}
