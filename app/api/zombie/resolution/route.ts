import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerOnly } from '@/lib/league/permissions'
import { runWeeklyResolution } from '@/lib/zombie/weeklyResolutionEngine'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null
  const week = typeof body.week === 'number' ? body.week : parseInt(String(body.week), 10)
  if (!leagueId || !Number.isFinite(week))
    return NextResponse.json({ error: 'leagueId and week required' }, { status: 400 })

  await requireCommissionerOnly(leagueId, userId)

  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const res = await runWeeklyResolution(z.id, week, { force: true })
  return NextResponse.json(res)
}

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leagueId = searchParams?.get('leagueId')
  const week = searchParams?.get('week')
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  try { await requireCommissionerOnly(leagueId, session.user.id) }
  catch (error) { if (error instanceof Response) return error; throw error }

  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (week) {
    const w = parseInt(week, 10)
    const one = await prisma.zombieWeeklyResolution.findUnique({
      where: { zombieLeagueId_week: { zombieLeagueId: z.id, week: w } },
    })
    return NextResponse.json({ resolution: one })
  }

  const all = await prisma.zombieWeeklyResolution.findMany({
    where: { zombieLeagueId: z.id },
    orderBy: { week: 'desc' },
  })
  return NextResponse.json({ resolutions: all })
}

