import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { 
  generateSmartRecommendations, 
  getQuickRecommendationsForUser,
  analyzeUserTradingProfile 
} from '@/lib/smart-trade-recommendations'
import { getSleeperUser, getLeagueRosters, getLeagueInfo, getAllPlayers, getLeagueUsers } from '@/lib/sleeper-client'
import { trackLegacyToolUsage } from '@/lib/analytics-server'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

/*
 * All three handlers took a Sleeper username straight from the caller — GET from the query
 * string, POST and PUT by destructuring the body — and passed it to lib/smart-trade-
 * recommendations, which reads that user's leagues, rosters and trading history. The param
 * is named `username` rather than `sleeper_username`, which is the only reason this route
 * escaped the first pass of the sweep; `getSleeperUser(username)` below confirms the
 * identity space is Sleeper, so it belongs to exactly the class this file closes.
 *
 * allowGuest: reachable straight after a guest import, same as the rest of the surface.
 */
export const GET = withApiUsage({ endpoint: "/api/legacy/smart-recommendations", tool: "LegacySmartRecommendations" })(async (request: NextRequest) => {
  const gate = await requireLegacySleeperIdentity(request, {
    allowGuest: true,
    requestedUsername: new URL(request.url).searchParams?.get('username'),
  })
  if (!gate.ok) return gate.response
  const username = gate.identity.sleeperUsername

  try {
    const quickCheck = await getQuickRecommendationsForUser(username)
    return NextResponse.json(quickCheck)
  } catch (error) {
    console.error('Quick recommendations check failed:', error)
    return NextResponse.json({ error: 'Failed to check recommendations' }, { status: 500 })
  }
})

export const POST = withApiUsage({ endpoint: "/api/legacy/smart-recommendations", tool: "LegacySmartRecommendations" })(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const { username: claimedUsername, leagueId, sport = 'nfl' } = body

    /*
     * The old limiter passed `ip` with no `includeIpInKey`, which is the degenerate shape:
     * one bucket shared by the entire platform rather than one per caller. Moving it into
     * the gate keys it on the resolved actor, after identity, so a flood cannot drain
     * everyone else's budget.
     */
    const gate = await requireLegacySleeperIdentity(request, {
      allowGuest: true,
      requestedUsername: claimedUsername,
      rateLimit: { action: 'smart_recommendations', maxRequests: 5, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const username = gate.identity.sleeperUsername

    if (!leagueId) {
      return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
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
    const body = await request.json().catch(() => ({}))
    const gate = await requireLegacySleeperIdentity(request, {
      allowGuest: true,
      requestedUsername: (body as { username?: string })?.username ?? null,
    })
    if (!gate.ok) return gate.response
    const username = gate.identity.sleeperUsername

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

