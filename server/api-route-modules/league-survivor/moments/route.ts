/**
 * GET  /api/leagues/[leagueId]/survivor/moments — this week's public moments (immunity win,
 *      torch-out after the read) plus whether the requesting user has already watched each one.
 * POST /api/leagues/[leagueId]/survivor/moments — { key } marks a moment as watched for this user.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'
import { buildWeeklyMoments, isValidMomentKey, markWeeklyMomentSeen } from '@/lib/survivor/survivorWeeklyMoments'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function authorize(ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { leagueId } = await ctx.params
  if (!leagueId) return { error: NextResponse.json({ error: 'Missing leagueId' }, { status: 400 }) }
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access?.isLeagueMember) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { access }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if ('error' in auth) return auth.error
  return NextResponse.json(await buildWeeklyMoments(auth.access), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if ('error' in auth) return auth.error
  let body: { key?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!isValidMomentKey(body.key)) return NextResponse.json({ error: 'Unknown moment' }, { status: 422 })
  const saved = await markWeeklyMomentSeen(auth.access.leagueId, auth.access.userId, body.key)
  return NextResponse.json({ ok: saved })
}
