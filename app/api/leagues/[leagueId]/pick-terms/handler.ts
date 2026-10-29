/**
 * Conditional and protected picks (lib/league-trade-engine/pickTerms.ts). AF Commissioner.
 *
 *   GET   a team in the league or a commissioner — whether offers may carry terms, the teams and
 *         round count an editor needs, and every pick carrying terms with its outcome once settled
 *   POST  { rule: { enabled } }  through the league settings save, so the plan check, the
 *         co-commissioner permissions, the settings lock and the audit log all apply
 *
 * Terms themselves are sent on an offer's pick (`metadata.pickTerms`) to POST /trades.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { PICK_TERMS_RULE_KEY } from '@/lib/league-trade-engine/pickTerms'
import { readPickTermsView } from '@/lib/league-trade-engine/pickTermsService'

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
  const r = await readPickTermsView(leagueId, userId)
  if (!r.ok) return NextResponse.json({ error: r.status === 404 ? 'League not found' : 'Forbidden' }, { status: r.status })
  return NextResponse.json(r.view, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { rule?: unknown } | null
  if (!body || !('rule' in body)) return NextResponse.json({ error: 'Send the rule to save.' }, { status: 400 })
  return executeLeagueSettingsPatch(userId, { leagueId, settingsMerge: { [PICK_TERMS_RULE_KEY]: body.rule } })
}
