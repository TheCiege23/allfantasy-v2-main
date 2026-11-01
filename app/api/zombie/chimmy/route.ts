import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { handleZombieChimmyAction } from '@/lib/zombie/chimmyActionHandler'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    leagueId?: string
    message?: string
    week?: number
    commandId?: string
  }
  if (!body.leagueId || !body.message) {
    return NextResponse.json({ error: 'leagueId and message required' }, { status: 400 })
  }

  const gate = await assertLeagueMember(body.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const z = await prisma.zombieLeague.findUnique({ where: { leagueId: body.leagueId } })
  const week =
    typeof body.week === 'number' && Number.isFinite(body.week) ? body.week : Math.max(1, z?.currentWeek ?? 1)

  const result = await handleZombieChimmyAction(body.leagueId, userId, body.message, week, body.commandId)
  return NextResponse.json(result)
}
