/**
 * Fill an empty starting spot before lock (lib/lineup-automation/fillEmptyStarters.ts). Free and on by
 * default in every weekly-lineup league played on AllFantasy.
 *
 *   GET   commissioner / co-commissioner — whether it is on, or why the league cannot use it
 *   POST  { on: boolean }  through the league settings save, so the co-commissioner permissions, the
 *         settings lock and the audit log all apply
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { readFillEmptyStartersView } from '@/lib/lineup-automation/fillEmptyStartersService'
import { FILL_EMPTY_STARTERS_KEY } from '@/lib/lineup-automation/fillEmptyStarters'
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
  const r = await readFillEmptyStartersView(leagueId, userId)
  if (!r.ok) return NextResponse.json({ error: r.status === 404 ? 'League not found' : 'Forbidden' }, { status: r.status })
  return NextResponse.json(r.view, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { on?: unknown } | null
  if (!body || typeof body.on !== 'boolean') return NextResponse.json({ error: 'Send on: true or false.' }, { status: 400 })
  return executeLeagueSettingsPatch(userId, { leagueId, settingsMerge: { [FILL_EMPTY_STARTERS_KEY]: body.on } })
}
