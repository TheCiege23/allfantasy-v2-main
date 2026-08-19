import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getLeagueInfo, getLeagueMatchups, getLeagueRosters, getLeagueUsers } from '@/lib/sleeper-client'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

interface WeeklyRating {
  week: number
  rating: number
}

interface TeamHistory {
  userId: string
  teamName: string
  sleeperUsername: string
  color: string
  currentRating: number
  weeklyRatings: WeeklyRating[]
}

const TEAM_COLORS = [
  '#00CED1', '#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3',
  '#F38181', '#AA96DA', '#FCBAD3', '#A8E6CF', '#DDA0DD',
  '#87CEEB', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE'
]

export const POST = withApiUsage({ endpoint: "/api/legacy/rankings/historical-ratings", tool: "LegacyRankingsHistoricalRatings" })(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const { league_id, season } = body

    const gate = await requireLegacySleeperIdentity(request, {
      requestedUsername: String(body?.sleeper_username || '').trim() || null,
      rateLimit: { action: 'historical_ratings', maxRequests: 20, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeper_username = gate.identity.sleeperUsername

    if (!league_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const user = await prisma.legacyUser.findUnique({
      where: { sleeperUsername: sleeper_username.toLowerCase() },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const currentLeagueData: any = await getLeagueInfo(league_id)
    if (!currentLeagueData) {
      return NextResponse.json({ error: 'Failed to fetch league data' }, { status: 500 })
    }
    const currentSeason = parseInt(currentLeagueData.season) || new Date().getFullYear()
    
    // Build list of available seasons by traversing previous_league_id chain
    const availableSeasons: number[] = [currentSeason]
    const leagueChain: { id: string; season: number }[] = [{ id: league_id, season: currentSeason }]
    
    let prevLeagueId = currentLeagueData.previous_league_id
    let traverseCount = 0
    while (prevLeagueId && traverseCount < 5) {
      try {
        const prevData: any = await getLeagueInfo(prevLeagueId)
        if (prevData) {
          const prevSeason = parseInt(prevData.season)
          availableSeasons.unshift(prevSeason)
          leagueChain.unshift({ id: prevLeagueId, season: prevSeason })
          prevLeagueId = prevData.previous_league_id
        } else {
          break
        }
      } catch {
        break
      }
      traverseCount++
    }
    
    // Find the league ID for the requested season
    const targetSeason = season || currentSeason
    const targetLeague = leagueChain.find(l => l.season === targetSeason) || leagueChain[leagueChain.length - 1]
    const targetLeagueId = targetLeague.id
    
    const [rosters, users, ...matchupsResults] = await Promise.all([
      getLeagueRosters(targetLeagueId),
      getLeagueUsers(targetLeagueId),
      ...Array.from({ length: 18 }, (_, i) => getLeagueMatchups(targetLeagueId, i + 1)),
    ])

    if (!Array.isArray(rosters) || !Array.isArray(users)) {
      return NextResponse.json({ error: 'Failed to fetch league data' }, { status: 500 })
    }
    
    const weeklyMatchups: any[][] = []
    for (const data of matchupsResults) {
      if (data && Array.isArray(data) && data.length > 0) {
        weeklyMatchups.push(data)
      }
    }

    const userMap = new Map(users.map((u: any) => [u.user_id, u]))

    const teamHistories: TeamHistory[] = rosters.map((roster: any, idx: number) => {
      const ownerInfo: any = userMap.get(roster.owner_id)
      const teamName = ownerInfo?.display_name || `Team ${roster.roster_id}`
      
      const wins = roster.settings?.wins || 0
      const losses = roster.settings?.losses || 0
      const fpts = (roster.settings?.fpts || 0) + ((roster.settings?.fpts_decimal || 0) / 100)
      const playerCount = roster.players?.length || 0
      const currentRating = Math.round(1000 + (wins * 15) - (losses * 10) + (fpts / 100) + (playerCount * 2))

      const weeklyRatings: WeeklyRating[] = []
      let cumulativeWins = 0
      let cumulativeLosses = 0
      let cumulativePoints = 0
      
      weeklyMatchups.forEach((weekMatchups, weekIdx) => {
        const teamMatchup = weekMatchups.find((m: any) => m.roster_id === roster.roster_id)
        if (teamMatchup) {
          const weekPoints = teamMatchup.points || 0
          cumulativePoints += weekPoints
          
          const opponent = weekMatchups.find((m: any) => 
            m.matchup_id === teamMatchup.matchup_id && m.roster_id !== roster.roster_id
          )
          
          if (opponent) {
            if (teamMatchup.points > opponent.points) {
              cumulativeWins++
            } else if (teamMatchup.points < opponent.points) {
              cumulativeLosses++
            }
          }
          
          const weekRating = Math.round(1000 + (cumulativeWins * 15) - (cumulativeLosses * 10) + (cumulativePoints / 100) + (playerCount * 2))
          
          weeklyRatings.push({
            week: weekIdx + 1,
            rating: weekRating,
          })
        }
      })

      if (weeklyRatings.length === 0) {
        weeklyRatings.push({ week: 1, rating: 1000 })
      }

      return {
        userId: roster.owner_id,
        teamName,
        sleeperUsername: ownerInfo?.display_name || '',
        color: TEAM_COLORS[idx % TEAM_COLORS.length],
        currentRating,
        weeklyRatings,
      }
    })

    teamHistories.sort((a, b) => b.currentRating - a.currentRating)

    const maxWeek = Math.max(...teamHistories.map(t => t.weeklyRatings.length))

    return NextResponse.json({
      teamHistories,
      leagueInfo: {
        name: currentLeagueData.name,
        totalTeams: rosters.length,
        season: targetSeason,
        maxWeek,
      },
      availableSeasons,
      chartType: 'Elo Adjusted ADP Rankings',
    })
  } catch (error) {
    console.error('Historical ratings error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
