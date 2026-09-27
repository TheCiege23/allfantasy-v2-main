import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { determineFinalChampion } from '@/lib/guillotine/endgameEngine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  if (!seasonId) return NextResponse.json({ error: 'seasonId required' }, { status: 400 })

  const g = await prisma.guillotineSeason.findFirst({
    where: { id: seasonId },
    include: { redraftSeason: { include: { rosters: { where: { isEliminated: false } } } } },
  })
  if (!g) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gate = await assertLeagueMember(g.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  return NextResponse.json({
    season: g,
    remainingTeams: g.redraftSeason?.rosters ?? [],
  })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { seasonId?: string; action?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.seasonId || body.action !== 'finalize') {
    return NextResponse.json({ error: 'seasonId and action finalize required' }, { status: 400 })
  }

  const g = await prisma.guillotineSeason.findFirst({ where: { id: body.seasonId } })
  if (!g) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    await requireCommissionerRole(g.leagueId, userId)
  } catch (err) {
    if (err instanceof Response) return err
    throw err
  }

  const championRosterId = await determineFinalChampion(body.seasonId)
  if (!championRosterId) return NextResponse.json({ error: 'Final scores are incomplete or tied; no champion resolved' }, { status: 409 })
  await prisma.guillotineSeason.update({
    where: { id: body.seasonId },
    data: { status: 'complete' },
  })
  return NextResponse.json({ championRosterId })
}

