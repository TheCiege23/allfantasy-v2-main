/**
 * The league log of automatic lineup changes (lib/lineup-automation/automaticChangeUndoService.ts).
 *
 * GET  — the owner sees their own team's, the commissioner every team's, last 14 days.
 * POST — { auditId }: undo one, when the lineup is still exactly what AllFantasy saved.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readAutomaticChanges, undoAutomaticChange } from '@/lib/lineup-automation/automaticChangeUndoService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

const ERRORS: Record<number, string> = { 403: 'Forbidden', 404: 'League not found', 409: 'AllFantasy only changes lineups in leagues it runs.' }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const r = await readAutomaticChanges(leagueId, userId)
  if (!r.ok) return NextResponse.json({ error: ERRORS[r.status] }, { status: r.status })
  return NextResponse.json({ rows: r.rows, commissioner: r.commissioner }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { auditId?: unknown } | null
  const r = await undoAutomaticChange(leagueId, userId, body?.auditId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, message: r.message })
}
