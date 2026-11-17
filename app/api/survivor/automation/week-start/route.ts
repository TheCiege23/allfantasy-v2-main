import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { prisma } from '@/lib/prisma'
import { advanceWeek } from '@/lib/survivor/gameStateMachine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function runWeekStart(req: NextRequest) {
  const cronOk = requireCronAuth(req)
  let body: { leagueId?: string } = {}
  try {
    body = (await req.json()) as { leagueId?: string }
  } catch {
    /* optional body */
  }
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''

  if (cronOk) {
    if (leagueId) {
      await advanceWeek(leagueId)
      return NextResponse.json({ ok: true, leagueId })
    }
    const leagues = await prisma.league.findMany({
      where: {
        survivorMode: true,
        survivorPhase: { notIn: ['pre_draft', 'complete'] },
      },
      select: { id: true },
    })
    for (const L of leagues) {
      await advanceWeek(L.id).catch(() => {})
    }
    return NextResponse.json({ ok: true, advanced: leagues.length })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId || !leagueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const gate = await assertLeagueCommissioner(leagueId, userId, 'league')
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await advanceWeek(leagueId)
  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  return runWeekStart(req)
}

export async function POST(req: NextRequest) {
  return runWeekStart(req)
}
