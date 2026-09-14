import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { currentSleeperWeek, sleeperRailFeed } from '@/lib/core-app/sleeperRailFeed'
import { parseLiveMatchups, summarizeLiveScores } from '@/lib/core-app/liveRailScores'
import { managerArtUrl } from '@/lib/core-app/leagueArt'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  const ids = [...new Set(request.nextUrl.searchParams.getAll('league'))]
  if (!ids.length || ids.length > 8 || ids.some(id => !id || id.length > 100)) {
    return NextResponse.json({ error: 'Request up to eight leagues' }, { status: 400, headers })
  }
  try {
    // Never accept a client-supplied platform ID or roster ownership assertion.
    const owned = await prisma.leagueTeam.findMany({
      where: { leagueId: { in: ids }, claimedByUserId: session.user.id },
      select: { externalId: true, league: { select: { id: true, platform: true, platformLeagueId: true, guillotineMode: true } } },
    })
    const authorized = owned.filter(team => team.league?.platform?.toLowerCase() === 'sleeper')
    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId: { in: authorized.map(team => team.league!.id) } },
      select: { leagueId: true, externalId: true, teamName: true, ownerName: true, avatarUrl: true },
    })
    const current = currentSleeperWeek(await sleeperRailFeed('state/nfl', 60_000))
    if (!current) return NextResponse.json({ error: 'No active NFL regular-season week' }, { status: 503, headers })
    const updates: Record<string, unknown> = {}
    const unavailable = ids.filter(id => !authorized.some(team => team.league?.id === id))
    // Four bounded workers keep a large league list from opening dozens of connections.
    for (let start = 0; start < authorized.length; start += 4) {
      await Promise.all(authorized.slice(start, start + 4).map(async team => {
        const league = team.league!
        try {
          if (!team.externalId || !league.platformLeagueId) throw new Error('Missing roster mapping')
          const metadata = await sleeperRailFeed(`league/${league.platformLeagueId}`, 3_600_000) as { season?: string; sport?: string } | null
          if (metadata?.sport !== 'nfl' || Number(metadata.season) !== current.season) throw new Error('Not a current NFL league')
          const rows = parseLiveMatchups(await sleeperRailFeed(`league/${league.platformLeagueId}/matchups/${current.week}`, 20_000))
          const scores = rows && summarizeLiveScores(rows, String(team.externalId))
          if (!scores) throw new Error('Matchup unavailable')
          const mine = teams.find(row => row.leagueId === league.id && row.externalId === team.externalId)
          const other = teams.find(row => row.leagueId === league.id && row.externalId === scores.opponentRosterId)
          updates[league.id] = { ...scores, ...current, updatedAt: new Date().toISOString(),
            yourTeam: mine?.teamName || mine?.ownerName || null,
            yourAvatarUrl: managerArtUrl({ avatarUrl: mine?.avatarUrl, platform: 'sleeper' }),
            opponentTeam: other?.teamName || other?.ownerName || null,
            opponentAvatarUrl: managerArtUrl({ avatarUrl: other?.avatarUrl, platform: 'sleeper' }),
            standing: scores.standing ? { ...scores.standing, elimination: league.guillotineMode } : null,
          }
        } catch { unavailable.push(league.id) }
      }))
    }
    return NextResponse.json({ updates, unavailable }, { headers })
  } catch {
    return NextResponse.json({ error: 'Scores temporarily unavailable' }, { status: 503, headers })
  }
}
