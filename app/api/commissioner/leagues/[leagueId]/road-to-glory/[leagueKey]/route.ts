import { NextRequest, NextResponse } from 'next/server'
import { isCommissionerQaEnvironment, isRoadToGloryStagingLeague } from '@/lib/core-app/commissionerQa'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { readAwardSheetToken } from '@/lib/league-chat/awardSheetToken'
import { roadToGloryLeagueForSource, roadToGloryLeagues } from '@/lib/league-import/fantrax/roadToGloryLeagues'
import { fetchRoadToGlorySnapshot } from '@/lib/league-import/fantrax/roadToGloryResults'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ leagueId: string; leagueKey: string }> }) {
  const { leagueId, leagueKey } = await params
  const source = roadToGloryLeagues.find(league => league.key === leagueKey)
  if (!isCommissionerQaEnvironment() || !source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const portfolio = isRoadToGloryStagingLeague(leagueId)
  const authorization = req.headers.get('authorization') ?? ''
  const userId = authorization.startsWith('Bearer ')
    ? (portfolio ? readAwardSheetToken(authorization.slice(7), leagueId) : null)
    : (await resolvePlatformUser()).appUserId
  if (!userId || !await canCommissionerAct(leagueId, userId, 'league')) {
    return NextResponse.json({ error: 'Staging commissioner access denied' }, { status: 403 })
  }

  if (!portfolio) {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { platform: true, platformLeagueId: true },
    })
    if (league?.platform.toLowerCase() !== 'fantrax' || roadToGloryLeagueForSource(league.platformLeagueId)?.key !== source.key) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  }

  try {
    const snapshot = await fetchRoadToGlorySnapshot(source.sourceId)
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Fantrax standings or weekly scores are temporarily unavailable.' }, { status: 502 })
  }
}
