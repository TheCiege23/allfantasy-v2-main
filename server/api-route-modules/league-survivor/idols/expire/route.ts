/**
 * POST /api/leagues/[leagueId]/survivor/idols/expire
 * Commissioner-only: manually expire an idol (e.g., at merge).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
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

  let body: { idolId?: string; reason?: string; week?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { idolId, reason, week } = body
  if (!idolId) return NextResponse.json({ error: 'idolId required' }, { status: 400 })

  const idol = await prisma.survivorIdol.findFirst({ where: { id: idolId, leagueId } })
  if (!idol) return NextResponse.json({ error: 'Idol not found' }, { status: 404 })
  if (idol.status === 'played' || idol.status === 'expired') {
    return NextResponse.json({ error: 'Idol already played or expired' }, { status: 400 })
  }

  await prisma.survivorIdol.update({ where: { id: idolId }, data: { status: 'expired' } })
  await logSurvivorAuditEntry({
    leagueId,
    week: week ?? 0,
    category: 'idol',
    action: 'expire',
    data: { idolId, reason: reason ?? 'commissioner_expire', commissionerUserId: userId },
  })
  return NextResponse.json({ ok: true })
}
