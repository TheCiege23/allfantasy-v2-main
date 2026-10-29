/**
 * Inactive manager mode (lib/inactive-manager): AllFantasy sets an away manager's best lineup weekly.
 *
 *   GET   commissioner / co-commissioner — every team, its activity, whether AllFantasy manages it, and
 *         the inactive teams AllFantasy suggests (it never turns the mode on by itself)
 *   POST  { rosterId, on }  commissioner / co-commissioner — start or stop it for one team
 *   POST  { rosterId, autopilot: 'dynasty_owner' | 'win_now' | 'rebuild' | null } — Chimmy autopilot
 *         (AF Commissioner, the league owner's plan): hand the team to Chimmy in a style, or take it off
 *   POST  { draftAsMe: boolean } — draft as me for missed picks (AF Commissioner); on by default
 *   POST  { autoHandover: { days: 7|14|21, to: 'lineups'|'autopilot' } | null } — the opt-in auto-handover
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { readInactiveManagerView, setAutoHandover, setChimmyAutopilot, setDraftAsMe, setInactiveManagerMode } from '@/lib/inactive-manager/inactiveManagerService'

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
  const body = (await req.json().catch(() => null)) as { rosterId?: unknown; on?: unknown; autopilot?: unknown; draftAsMe?: unknown; autoHandover?: unknown } | null
  if (body && 'autoHandover' in body) {
    const h = await setAutoHandover(leagueId, userId, body.autoHandover)
    return h.ok ? NextResponse.json({ autoHandover: h.rule }) : NextResponse.json({ error: h.error }, { status: h.status })
  }
  if (body && 'draftAsMe' in body) {
    const d = await setDraftAsMe(leagueId, userId, body.draftAsMe)
    return d.ok ? NextResponse.json({ draftAsMe: d.on }) : NextResponse.json({ error: d.error }, { status: d.status })
  }
  if (body && 'autopilot' in body) {
    const a = await setChimmyAutopilot(leagueId, userId, body.rosterId, body.autopilot)
    return a.ok ? NextResponse.json({ managed: a.managed, autopilot: a.style ?? null }) : NextResponse.json({ error: a.error }, { status: a.status })
  }
  const r = await setInactiveManagerMode(leagueId, userId, body?.rosterId, body?.on)
  return r.ok ? NextResponse.json({ managed: r.managed }) : NextResponse.json({ error: r.error }, { status: r.status })
}
