/**
 * GET/PUT: Survivor idol setup (survivor-theme handoff, IdolSetup).
 * Any league member can read the counts and league values; the picked types reach only the
 * commissioner, and the DRAWN types only a commissioner who does not play (and did not hide the
 * draw from themselves) — a playing commissioner is a manager for hidden information. Only the
 * commissioner writes, and only before the draft starts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { isSurvivorLeague } from '@/lib/survivor/SurvivorLeagueConfig'
import { getSurvivorIdolSetupView, saveSurvivorIdolConfig } from '@/lib/survivor/survivorIdolConfigService'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'

export const dynamic = 'force-dynamic'

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  if (!(await canAccessLeagueDraft(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await isSurvivorLeague(leagueId))) return NextResponse.json({ error: 'Not a survivor league' }, { status: 404 })
  const [commissioner, access] = await Promise.all([isCommissioner(leagueId, userId), resolveSurvivorAccessContext(leagueId, userId)])
  const view = await getSurvivorIdolSetupView(leagueId, { isCommissioner: commissioner, canSeeDraw: Boolean(access?.decisions.canSeeHiddenIdolAssignments) })
  return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  if (!(await isCommissioner(leagueId, userId))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  if (!(await isSurvivorLeague(leagueId))) return NextResponse.json({ error: 'Not a survivor league' }, { status: 404 })
  const body = await req.json().catch(() => null)
  const result = await saveSurvivorIdolConfig(leagueId, body)
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  const view = await getSurvivorIdolSetupView(leagueId, { isCommissioner: true, canSeeDraw: Boolean(access?.decisions.canSeeHiddenIdolAssignments) })
  return NextResponse.json(view)
}
