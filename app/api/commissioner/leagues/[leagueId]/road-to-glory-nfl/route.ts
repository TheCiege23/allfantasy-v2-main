import { NextRequest, NextResponse } from 'next/server'
import { isRoadToGloryStagingLeague } from '@/lib/core-app/commissionerQa'
import { readAwardSheetToken } from '@/lib/league-chat/awardSheetToken'
import { fetchRoadToGloryNflSnapshot } from '@/lib/league-import/fantrax/roadToGloryResults'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { resolvePlatformUser } from '@/lib/platform/current-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  if (!isRoadToGloryStagingLeague(leagueId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const authorization = req.headers.get('authorization') ?? ''
  const userId = authorization.startsWith('Bearer ')
    ? readAwardSheetToken(authorization.slice(7), leagueId)
    : (await resolvePlatformUser()).appUserId
  if (!userId || !await canCommissionerAct(leagueId, userId, 'league')) {
    return NextResponse.json({ error: 'Road To Glory NFL staging access denied' }, { status: 403 })
  }
  try {
    const snapshot = await fetchRoadToGloryNflSnapshot()
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Fantrax standings or weekly scores are temporarily unavailable.' }, { status: 502 })
  }
}
