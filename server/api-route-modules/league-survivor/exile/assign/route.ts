/**
 * POST /api/leagues/[leagueId]/survivor/exile/assign
 * Commissioner-only: assign a player to exile island for the week.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { enrollInExile } from '@/lib/survivor/SurvivorExileEngine'
import { logSurvivorAuditEntry } from '@/lib/survivor/auditEntry'

import { survivorHostGuard } from '@/lib/survivor/survivorHostGuard'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = params
  const denied = await survivorHostGuard(leagueId, userId)
  if (denied) return denied
  const gate = await assertLeagueCommissioner(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Commissioner only' }, { status: gate.status ?? 403 })

  let body: { targetRosterId?: string; targetUserId?: string; week?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { targetRosterId, targetUserId, week } = body
  if (!targetRosterId) return NextResponse.json({ error: 'targetRosterId required' }, { status: 400 })
  if (!targetUserId) return NextResponse.json({ error: 'targetUserId required' }, { status: 400 })
  if (!week) return NextResponse.json({ error: 'week required' }, { status: 400 })

  try {
    // enrollInExile(mainLeagueId, rosterId, platformUserId)
    const result = await enrollInExile(leagueId, targetRosterId, targetUserId)
    await logSurvivorAuditEntry({
      leagueId,
      week,
      category: 'exile',
      action: 'assign',
      actorUserId: userId,
      targetUserId,
      data: { targetRosterId, week },
    })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
