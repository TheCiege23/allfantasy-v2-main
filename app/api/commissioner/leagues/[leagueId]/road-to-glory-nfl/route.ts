import { NextRequest, NextResponse } from 'next/server'
import { isRoadToGloryStagingLeague } from '@/lib/core-app/commissionerQa'
import { readAwardSheetToken } from '@/lib/league-chat/awardSheetToken'
import { fetchRoadToGloryNflSnapshot, ROAD_TO_GLORY_NFL_ID } from '@/lib/league-import/fantrax/roadToGloryNfl'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  if (!isRoadToGloryStagingLeague(leagueId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const authorization = req.headers.get('authorization') ?? ''
  const userId = authorization.startsWith('Bearer ')
    ? readAwardSheetToken(authorization.slice(7), leagueId)
    : (await resolvePlatformUser()).appUserId
  const league = userId && await prisma.league.findFirst({
    where: { id: leagueId, userId, platform: 'fantrax', season: 2026, sport: 'NFL' },
    select: { platformLeagueId: true },
  })
  const source = league && await prisma.fantraxLeague.findFirst({
    where: { id: league.platformLeagueId, appUserId: userId, sourceLeagueId: ROAD_TO_GLORY_NFL_ID },
    select: { id: true },
  })
  if (!source) return NextResponse.json({ error: 'Road To Glory NFL staging access denied' }, { status: 403 })
  try {
    const snapshot = await fetchRoadToGloryNflSnapshot()
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Fantrax standings or weekly scores are temporarily unavailable.' }, { status: 502 })
  }
}
