import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueAccess } from '@/lib/league-access'
import { buildLiveFantasyMatchupContext } from '@/lib/chimmy/liveFantasyMatchupGrounding'

export const dynamic = 'force-dynamic'

/** A read-only score refresh. It does not generate an AI answer or spend tokens. */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = request.nextUrl.searchParams.get('leagueId')?.trim()
  if (!leagueId || leagueId.length > 128) return NextResponse.json({ error: 'Invalid league' }, { status: 400 })
  if (!await resolveLeagueAccess(leagueId, userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const context = await buildLiveFantasyMatchupContext({ leagueId, userId })
    return NextResponse.json({ context, readAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Matchup data is temporarily unavailable' }, { status: 503 })
  }
}
