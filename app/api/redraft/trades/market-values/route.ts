import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'

export const dynamic = 'force-dynamic'

async function isCommissionerOrOwner(leagueId: string, userId: string): Promise<boolean> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { userId: true, teams: { where: { claimedByUserId: userId }, select: { isCommissioner: true, isCoCommissioner: true } } },
  })
  if (!league) return false
  if (league.userId === userId) return true
  return league.teams.some((t) => t.isCommissioner || t.isCoCommissioner)
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  if (!(await isCommissionerOrOwner(leagueId, userId))) {
    return NextResponse.json({ error: 'Commissioner or co-commissioner permission required' }, { status: 403 })
  }

  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, select: { sport: true }, orderBy: { season: 'desc' } })
  const sport = season?.sport ?? null
  if (!sport) return NextResponse.json({ values: [], sport: null })

  const rows = await prisma.allFantasyMarketPlayerValue.findMany({
    where: { sport, leagueConcept: 'redraft', published: true },
    orderBy: [{ confidence: 'desc' }, { sampleSize: 'desc' }],
    take: 200,
    select: {
      playerId: true, playerName: true, position: true, baseValue: true, marketValue: true,
      adjustmentPercent: true, confidence: true, sampleSize: true, direction: true, generatedAt: true,
    },
  })
  return NextResponse.json({ sport, leagueConcept: 'redraft', values: rows })
}
