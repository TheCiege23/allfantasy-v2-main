/**
 * Inactive manager mode (lib/inactive-manager): AllFantasy sets an away manager's best lineup weekly.
 *
 *   GET   commissioner / co-commissioner — every team, its activity, whether AllFantasy manages it, and
 *         the inactive teams AllFantasy suggests (it never turns the mode on by itself)
 *   POST  { rosterId, on }  commissioner / co-commissioner — start or stop it for one team
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { readInactiveManagerView, setInactiveManagerMode } from '@/lib/inactive-manager/inactiveManagerService'

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
  if (!(await isElevatedCommissioner(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(await readInactiveManagerView(leagueId), { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { rosterId?: unknown; on?: unknown } | null
  const r = await setInactiveManagerMode(leagueId, userId, body?.rosterId, body?.on)
  return r.ok ? NextResponse.json({ managed: r.managed }) : NextResponse.json({ error: r.error }, { status: r.status })
}
