import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { 
  generateSmartRecommendations, 
  getQuickRecommendationsForUser,
  analyzeUserTradingProfile 
} from '@/lib/smart-trade-recommendations'
import { getSleeperUser, getLeagueRosters, getLeagueInfo, getAllPlayers, getLeagueUsers } from '@/lib/sleeper-client'
import { trackLegacyToolUsage } from '@/lib/analytics-server'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'

export const GET = withApiUsage({ endpoint: "/api/legacy/smart-recommendations", tool: "LegacySmartRecommendations" })(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const username = searchParams?.get('username')

  if (!username) {
    return NextResponse.json({ error: 'Username required' }, { status: 400 })
  }

  try {
    const quickCheck = await getQuickRecommendationsForUser(username)
    return NextResponse.json(quickCheck)
  } catch (error) {
    console.error('Quick recommendations check failed:', error)
    return NextResponse.json({ error: 'Failed to check recommendations' }, { status: 500 })
  }
})

export const POST = withApiUsage({ endpoint: "/api/legacy/smart-recommendations", tool: "LegacySmartRecommendations" })(async (request: NextRequest) => {
  const ip = getClientIp(request)
  const rateLimitResult = consumeRateLimit({
    scope: 'legacy',
    action: 'smart_recommendations',
    ip,
    maxRequests: 5,
    windowMs: 60000,
    includeIpInKey: true,
  })
  
  if (!rateLimitResult.success) {
    return NextResponse.json({ 
      error: 'Rate limited. Please wait before trying again.',
      retryAfter: rateLimitResult.retryAfterSec 
    }, { status: 429 })
  }

  try {
    const body = await request.json()
    const { username, leagueId, sport = 'nfl' } = body

    if (!username || !leagueId) {
      return NextResponse.json({ error: 'Username and leagueId required' }, { status: 400 })
    }

    const sleeperUser = await getSleeperUser(username)
    if (!sleeperUser) {
      return NextResponse.json({ error: 'Sleeper user not found' }, { status: 404 })
    }

    const leagueInfo = await getLeagueInfo(leagueId)
    if (!leagueInfo) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 })
    }

    const rosters = await getLeagueRosters(leagueId)
    if (!rosters || rosters.length === 0) {
      return NextResponse.json({ error: 'No rosters found in league' }, { status: 404 })
    }

    const allPlayers = await getAllPlayers()
    
    const userRoster = rosters.find(r => r.owner_id === sleeperUser.user_id)
    if (!userRoster) {
      return NextResponse.json({ error: 'User roster not found in league' }, { status: 404 })
    }

    const formatRoster = (playerIds: string[]) => {
      return playerIds.map(id => {
        const player = allPlayers[id]
        return {
          id,
          name: player ? `${player.first_name} ${player.last_name}` : id,
          position: player?.position || 'Unknown',
          team: player?.team || undefined,
        }
      }).filter(p => p.position !== 'Unknown')
    }

    const userRosterFormatted = formatRoster(userRoster.players || [])
    
    const leagueUsers = await getLeagueUsers(leagueId)
    const leagueRostersFormatted = await Promise.all(
      rosters
        .filter(r => r.owner_id !== sleeperUser.user_id)
        .map(async (roster) => {
          let managerName = `Manager ${roster.roster_id}`
          try {
            const manager = leagueUsers.find((u) => u.user_id === roster.owner_id)
            if (manager) {
              managerName = manager.display_name || manager.username || managerName
            }
          } catch {
          }
          return {
            managerId: roster.owner_id || String(roster.roster_id),
            managerName,
            players: formatRoster(roster.players || []),
          }
        })
    )

    const isDynasty = (leagueInfo.settings as { type?: number })?.type === 2
    const isSuperFlex = leagueInfo.roster_positions?.includes('SUPER_FLEX') || false

    const recommendations = await generateSmartRecommendations(
      username,
      leagueId,
      userRosterFormatted,
      leagueRostersFormatted,
      {
        isDynasty,
        isSuperFlex,
        sport: sport as 'nfl' | 'nba',
      }
    )

    await trackLegacyToolUsage(
      'smart_recommendations',
      username,
      null,
      {
        leagueId,
        recommendationCount: recommendations.recommendations.length,
        userTradeCount: recommendations.userProfile.totalTrades,
      }
    )

    return NextResponse.json(recommendations)
  } catch (error) {
    console.error('Smart recommendations failed:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to generate recommendations' 
    }, { status: 500 })
  }
})

export const PUT = withApiUsage({ endpoint: "/api/legacy/smart-recommendations", tool: "LegacySmartRecommendations" })(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const { username } = body

    if (!username) {
      return NextResponse.json({ error: 'Username required' }, { status: 400 })
    }

    const profile = await analyzeUserTradingProfile(username)
    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ profile })
  } catch (error) {
    console.error('Profile analysis failed:', error)
    return NextResponse.json({ error: 'Failed to analyze profile' }, { status: 500 })
  }
})

