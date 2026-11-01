import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { resolveTokenPoolPicks } from '@/lib/survivor/tokenPoolEngine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/survivor/token-pool/resolve
 * Resolves token pool picks for a given league/week against game results.
 * Called by cron or commissioner manually. LEGACY entry point: it now settles the side-game Token
 * Pool (the commissioner's settle override) plus any unresolved pre-bridge history row; picks also
 * settle on their own from our stored finals in the season runner.
 */
export async function POST(req: NextRequest) {
  const cronOk = requireCronAuth(req)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : ''
  const week = typeof body.week === 'number' ? body.week : 0
  const results =
    typeof body.results === 'object' && body.results != null
      ? (body.results as Record<string, { winner?: string; totalScore?: number; correct?: boolean }>)
      : null

  if (!leagueId || !week) {
    return NextResponse.json({ error: 'leagueId and week required' }, { status: 400 })
  }
  if (!results || Object.keys(results).length === 0) {
    return NextResponse.json({ error: 'results required' }, { status: 400 })
  }

  let actorUserId: string | null = null
  if (!cronOk) {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const gate = await assertLeagueCommissioner(leagueId, userId)
    if (!gate.ok) {
      return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
    }
    actorUserId = userId
  }

  // Bridged onto the side-game Token Pool (lib/survivor/tokenPoolEngine.ts): one Token Pool truth,
  // one token balance. The response shape is unchanged.
  const outcomes = await resolveTokenPoolPicks(leagueId, week, results, { by: cronOk ? 'auto' : 'commissioner', actorUserId })
  return NextResponse.json({ ok: true, resolved: outcomes.length, outcomes })
}
