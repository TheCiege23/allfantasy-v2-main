import { NextRequest, NextResponse } from 'next/server'
import { isAfcPilotLeague, loadAfcPilot } from '@/lib/afc-championships/staging'
import { readAwardSheetToken } from '@/lib/league-chat/awardSheetToken'
import { fetchHardwood32Snapshot } from '@/lib/league-import/sleeper/hardwood32Server'
import { resolvePlatformUser } from '@/lib/platform/current-user'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  if (!isAfcPilotLeague(leagueId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const authorization = req.headers.get('authorization') ?? ''
  const userId = authorization.startsWith('Bearer ')
    ? readAwardSheetToken(authorization.slice(7), leagueId)
    : (await resolvePlatformUser()).appUserId
  if (!userId || !await loadAfcPilot(leagueId, userId)) {
    return NextResponse.json({ error: 'Hardwood 32 staging access denied' }, { status: 403 })
  }
  try {
    const snapshot = await fetchHardwood32Snapshot()
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Sleeper standings or Week 4 scores are temporarily unavailable.' }, { status: 502 })
  }
}
