import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { resolveAllFantasyMarketValue } from '@/lib/trade-market/allFantasyMarketValues'

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

export async function GET(req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const { playerId } = await ctx.params

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  if (!(await isCommissionerOrOwner(leagueId, userId))) {
    return NextResponse.json({ error: 'Commissioner or co-commissioner permission required' }, { status: 403 })
  }

  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, select: { sport: true }, orderBy: { season: 'desc' } })
  if (!season?.sport) return NextResponse.json({ value: { playerId, allFantasyMarketValue: null, published: false } })

  // Read-only resolver — never computes/mutates on a GET.
  const value = await resolveAllFantasyMarketValue(playerId, { sport: season.sport, leagueConcept: 'redraft' })
  return NextResponse.json({ value })
}
