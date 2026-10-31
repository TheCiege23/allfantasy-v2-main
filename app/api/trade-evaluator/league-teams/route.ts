import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { loadTradeLeagueContext } from '@/lib/trades/loadTradeLeagueContext'

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = request.nextUrl.searchParams.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  const league = await loadTradeLeagueContext(leagueId, userId)
  if (!league) return NextResponse.json({ error: 'League unavailable' }, { status: 404 })
  return NextResponse.json({
    leagueId: league.leagueId,
    sport: league.sport,
    teams: league.teams.map((team) => ({ id: team.id, name: team.name, externalId: team.externalId })),
    viewerTeamIds: league.viewerTeamIds,
  })
}
