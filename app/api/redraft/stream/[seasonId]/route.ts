import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  if (!seasonId) return NextResponse.json({ error: 'seasonId required' }, { status: 400 })

  const season = await prisma.redraftSeason.findFirst({ where: { id: seasonId } })
  if (!season) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gate = await assertLeagueMember(season.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId },
    orderBy: [{ playoffSeed: 'asc' }, { wins: 'desc' }, { pointsFor: 'desc' }],
  })

  return NextResponse.json({ rosters })
}

