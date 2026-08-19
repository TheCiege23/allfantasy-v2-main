import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { resolveReplacementOptions } from '@/lib/shared-services/league-hub/replacementOptions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Player Command Center (Slice 5): best bench alternative + best unrostered
// players for one affected player in one league, with real projection deltas.
// Session + league membership enforced; the module itself resolves the user's
// roster server-side and never trusts a client-supplied roster.
export async function GET(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string }
    } | null
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const ip = getClientIp(req) || 'unknown'
    const rl = rateLimit(`pcc-replacements:${ip}`, 30, 60_000)
    if (!rl.success) {
      return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 })
    }

    const params = req.nextUrl.searchParams
    const leagueId = params.get('leagueId')?.trim()
    const playerId = params.get('playerId')?.trim()
    if (!leagueId || !playerId) {
      return NextResponse.json({ error: 'leagueId and playerId required' }, { status: 400 })
    }

    const gate = await assertLeagueMember(leagueId, userId)
    if (!gate.ok) {
      return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
    }

    const result = await resolveReplacementOptions({
      appUserId: userId,
      leagueId,
      affectedPlayerId: playerId,
    })
    if (!result) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (error: unknown) {
    console.error('[player-command-center/replacements] error:', error)
    const message = error instanceof Error ? error.message : 'Failed to load replacement options.'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
