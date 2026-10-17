/**
 * POST /api/leagues/[leagueId]/survivor/idols/assign
 * Commissioner-only: assign/seed an idol to a player (Phase 2 manual seed).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { transferIdol } from '@/lib/survivor/idolEngine'
import { prisma } from '@/lib/prisma'
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

  let body: { idolId?: string; toUserId?: string; powerType?: string; week?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { idolId, toUserId, week } = body
  if (!idolId || !toUserId) return NextResponse.json({ error: 'idolId and toUserId required' }, { status: 400 })

  try {
    await transferIdol(idolId, userId, toUserId, 'commissioner_seed')
    await logSurvivorAuditEntry({
      leagueId,
      week: week ?? 0,
      category: 'idol',
      action: 'assign',
      data: { idolId, toUserId, commissionerUserId: userId },
    })
    const idol = await prisma.survivorIdol.findUnique({ where: { id: idolId } })
    return NextResponse.json({ ok: true, idol })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
