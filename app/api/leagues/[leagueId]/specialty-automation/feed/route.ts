import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'

export async function GET(_req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLeagueAccess(params.leagueId, userId)
  if (!access?.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [events, phase, lastRuns] = await Promise.all([
    prisma.leagueEvent.findMany({
      where: { leagueId: params.leagueId },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
    prisma.specialtyPhaseState.findUnique({
      where: { leagueId: params.leagueId },
    }),
    prisma.specialtyAutomationRun.findMany({
      where: { leagueId: params.leagueId },
      orderBy: { startedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        concept: true,
        triggerType: true,
        status: true,
        summary: true,
        startedAt: true,
        completedAt: true,
      },
    }),
  ])

  return NextResponse.json({
    events,
    phase,
    recentRuns: lastRuns,
  })
}
