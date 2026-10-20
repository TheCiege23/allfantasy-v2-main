/**
 * Draft-day kit (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 9).
 *
 *   GET   any league member: the show to play (if any), the server clock, and the absent-manager rule
 *   POST  commissioner / co-commissioner only:
 *           { action: 'start_show', kind: 'order' | 'lottery', pace?: 'quick' | 'standard' | 'dramatic' }
 *           { action: 'stop_show' }
 *           { action: 'save_absent_rule', rule: { enabled, missedPicks, seconds } }
 *
 * Free on every tier: running a league is free (owner decision, 2026-10-15).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { resolveLeagueMembership } from '@/lib/league-access'
import { readDraftDay, saveAbsentRule, startShow, stopShow } from '@/lib/draft-day/draftDayService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> }

async function userIdOf(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

const START_STATUS = {
  not_found: 404,
  draft_started: 409,
  order_incomplete: 409,
  no_lottery: 409,
  lottery_stale: 409,
  bad_pace: 400,
  bad_kind: 400,
} as const

export async function GET(_req: NextRequest, ctx: Ctx) {
  const userId = await userIdOf()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) return NextResponse.json({ error: 'Not found' }, { status: membership.status === 401 ? 401 : 404 })
  const view = await readDraftDay(leagueId)
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const userId = await userIdOf()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const role = await getLeagueRole(leagueId, userId)
  if (role === null) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role !== 'commissioner' && role !== 'co_commissioner') return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (body.action === 'start_show') {
    const r = await startShow(leagueId, userId, { kind: body.kind, pace: body.pace })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: START_STATUS[r.error] })
  } else if (body.action === 'stop_show') {
    if (!(await stopShow(leagueId))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  } else if (body.action === 'save_absent_rule') {
    if (!(await saveAbsentRule(leagueId, body.rule))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  } else {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  }
  return NextResponse.json(await readDraftDay(leagueId))
}
