/**
 * /api/leagues/[leagueId]/copy-league — copy leagues, part 1 (docs/league-page/COPY_LEAGUES_DESIGN.md).
 *
 * GET    any league member — the league's copy-league state and what this viewer may change
 * POST   { action: 'enable' | 'disable' }                         commissioner
 *        { action: 'pick', code: string | null }                   a manager, for the team they claimed,
 *                                                                  until the draft starts
 *        { action: 'assign', leagueTeamId, code: string | null }   commissioner, any team, swaps if taken
 *
 * Rules live in lib/league/copyLeague.ts and lib/league/copyLeagueService.ts. Postgres only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueAccess } from '@/lib/league-access'
import { changeCopyLeague, readCopyLeagueForViewer, type CopyLeagueAction } from '@/lib/league/copyLeagueService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function member(leagueId: string): Promise<{ userId: string } | NextResponse> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((await resolveLeagueAccess(leagueId, userId)) == null) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { userId }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const who = await member(leagueId)
  if (who instanceof NextResponse) return who
  const view = await readCopyLeagueForViewer(leagueId, who.userId)
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(view, { headers: { 'Cache-Control': 'private, no-store' } })
}

function parse(body: Record<string, unknown>): CopyLeagueAction | null {
  const code = body.code === null ? null : typeof body.code === 'string' ? body.code.trim().toUpperCase() : undefined
  switch (body.action) {
    case 'enable':
    case 'disable':
      return { action: body.action }
    case 'pick':
      return code === undefined ? null : { action: 'pick', code }
    case 'assign':
      return typeof body.leagueTeamId === 'string' && code !== undefined ? { action: 'assign', leagueTeamId: body.leagueTeamId, code } : null
    default:
      return null
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { leagueId } = await ctx.params
  const who = await member(leagueId)
  if (who instanceof NextResponse) return who
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const action = body && typeof body === 'object' ? parse(body) : null
  if (!action) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const out = await changeCopyLeague(leagueId, who.userId, action)
  if (!out.ok) return NextResponse.json({ error: out.message, code: out.code }, { status: out.status })
  const view = await readCopyLeagueForViewer(leagueId, who.userId)
  return NextResponse.json({ ok: true, view })
}
