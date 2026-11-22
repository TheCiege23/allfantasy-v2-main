/**
 * Lineup minimums for eliminated teams (lib/eliminated-lineups): teams out of the playoff race still
 * start a full lineup. AF Commissioner.
 *
 *   GET   commissioner / co-commissioner — the rule, whether the owner's plan allows it, and every
 *         eliminated team this week with what its lineup is short of
 *   POST  { rule: { enabled, standard, autoFill } }  through the league settings save, so the plan
 *         check, the co-commissioner permissions, the settings lock and the audit log all apply
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readEliminatedLineupView } from '@/lib/eliminated-lineups/eliminatedLineupService'
import { ELIMINATED_LINEUP_RULE_KEY } from '@/lib/eliminated-lineups/eliminatedLineups'
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
  const r = await readEliminatedLineupView(leagueId, userId)
  if (!r.ok) return NextResponse.json({ error: r.status === 404 ? 'League not found' : 'Forbidden' }, { status: r.status })
  return NextResponse.json(r.view, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { rule?: unknown } | null
  if (!body || !('rule' in body)) return NextResponse.json({ error: 'Send the rule to save.' }, { status: 400 })
  return executeLeagueSettingsPatch(userId, { leagueId, settingsMerge: { [ELIMINATED_LINEUP_RULE_KEY]: body.rule ?? null } })
}
