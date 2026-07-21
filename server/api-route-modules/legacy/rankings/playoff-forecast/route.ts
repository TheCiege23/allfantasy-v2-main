import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { getLeagueInfo, getLeagueRosters, getLeagueUsers, getNflState } from '@/lib/sleeper-client'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

const openai = getOpenAIRouteClient()

interface PlayoffProbability {
  makePlayoffs: number
  makeSemiFinals: number
  makeFinals: number
  winFinals: number
}

interface TeamForecast {
  userId: string
  teamName: string
  sleeperUsername: string
  teamRating: number
  currentRecord: string
  wins: number
  losses: number
  pointsFor: number
  rank: number
  isUser: boolean
  probabilities: PlayoffProbability
  status: 'clinched' | 'contending' | 'longshot' | 'eliminated'
  statusReason: string
}

function computeTeamRating(roster: any, forecast_type: string): number {
  const wins = roster.settings?.wins || 0
  const losses = roster.settings?.losses || 0
  const ties = roster.settings?.ties || 0
  const gamesPlayed = wins + losses + ties
  const fpts = (roster.settings?.fpts || 0) + ((roster.settings?.fpts_decimal || 0) / 100)
  const fptsAgainst = (roster.settings?.fpts_against || 0) + ((roster.settings?.fpts_against_decimal || 0) / 100)
  const playerCount = roster.players?.length || 0
  const starterCount = roster.starters?.filter((s: string) => s && s !== '0')?.length || 0

  let rating = 1000

  if (gamesPlayed > 0) {
    const winPct = wins / gamesPlayed
    rating += (winPct - 0.5) * 400

    const ppg = fpts / gamesPlayed
    rating += (ppg - 100) * 2

    if (fptsAgainst > 0) {
      const papg = fptsAgainst / gamesPlayed
      const margin = ppg - papg
      rating += margin * 1.5
    }
  }

  const rosterBonus = Math.min(playerCount, 25) * 1.5
  const starterBonus = starterCount * 3
  rating += rosterBonus + starterBonus

  if (forecast_type === 'elo') {
    if (gamesPlayed > 0) {
      const streak = computeStreak(roster)
      rating += streak * 10
    }
    rating += Math.min(fpts / 50, 100)
  }

  return Math.round(rating)
}

function computeStreak(roster: any): number {
  const metadata = roster.metadata
  if (!metadata) return 0
  const streak = metadata.streak
  if (!streak) return 0
  if (typeof streak === 'string') {
    const match = streak.match(/^([WL])(\d+)$/)
    if (match) return match[1] === 'W' ? parseInt(match[2]) : -parseInt(match[2])
  }
  return 0
}

function runMonteCarloPlayoffs(
  teamRatings: { userId: string; rating: number; wins: number; losses: number; pf: number }[],
  totalTeams: number,
  playoffSpots: number,
  totalWeeks: number,
  currentWeek: number,
  simulations: number = 5000
): Map<string, PlayoffProbability> {
  const results = new Map<string, { playoffs: number; semis: number; finals: number; champ: number }>()
  for (const t of teamRatings) {
    results.set(t.userId, { playoffs: 0, semis: 0, finals: 0, champ: 0 })
  }

  const remainingWeeks = Math.max(0, totalWeeks - currentWeek)
  const seasonComplete = remainingWeeks === 0

  for (let sim = 0; sim < simulations; sim++) {
    const simTeams = teamRatings.map(t => ({
      userId: t.userId,
      wins: t.wins,
      losses: t.losses,
      pf: t.pf,
      rating: t.rating,
    }))

    if (!seasonComplete) {
      for (let week = 0; week < remainingWeeks; week++) {
        const shuffled = [...simTeams].sort(() => Math.random() - 0.5)
        for (let i = 0; i < shuffled.length - 1; i += 2) {
          const teamA = shuffled[i]
          const teamB = shuffled[i + 1]
          if (!teamA || !teamB) continue

          const ratingDiff = teamA.rating - teamB.rating
          const winProbA = 1 / (1 + Math.pow(10, -ratingDiff / 400))
          const noise = (Math.random() + Math.random() + Math.random()) / 3

          if (noise < winProbA) {
            teamA.wins++
            teamB.losses++
          } else {
            teamB.wins++
            teamA.losses++
          }
        }
      }
    }

    simTeams.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins
      return b.pf - a.pf
    })

    const playoffTeams = simTeams.slice(0, playoffSpots)
    const playoffIds = new Set(playoffTeams.map(t => t.userId))

    for (const t of simTeams) {
      const r = results.get(t.userId)!
      if (playoffIds.has(t.userId)) {
        r.playoffs++
      }
    }

    const semiCount = Math.min(playoffSpots, playoffSpots <= 4 ? playoffSpots : Math.ceil(playoffSpots * 0.67))
    const semiWinners: typeof playoffTeams = []

    if (playoffTeams.length >= 4) {
      const bracketTeams = [...playoffTeams]
      const round1Winners: typeof playoffTeams = []

      if (bracketTeams.length > semiCount) {
        const byeCount = semiCount - (bracketTeams.length - semiCount)
        const byeTeams = bracketTeams.splice(0, Math.max(0, byeCount))
        for (const t of byeTeams) {
          results.get(t.userId)!.semis++
          round1Winners.push(t)
        }
        for (let i = 0; i < bracketTeams.length - 1; i += 2) {
          const a = bracketTeams[i], b = bracketTeams[i + 1]
          if (!a || !b) continue
          const prob = 1 / (1 + Math.pow(10, -(a.rating - b.rating) / 400))
          const winner = Math.random() < prob ? a : b
          results.get(winner.userId)!.semis++
          round1Winners.push(winner)
        }
      } else {
        for (const t of bracketTeams) {
          results.get(t.userId)!.semis++
          round1Winners.push(t)
        }
      }

      for (let i = 0; i < round1Winners.length - 1; i += 2) {
        const a = round1Winners[i], b = round1Winners[i + 1]
        if (!a || !b) continue
        const prob = 1 / (1 + Math.pow(10, -(a.rating - b.rating) / 400))
        const winner = Math.random() < prob ? a : b
        results.get(winner.userId)!.finals++
        semiWinners.push(winner)
      }

      if (semiWinners.length >= 2) {
        const a = semiWinners[0], b = semiWinners[1]
        const prob = 1 / (1 + Math.pow(10, -(a.rating - b.rating) / 400))
        const champ = Math.random() < prob ? a : b
        results.get(champ.userId)!.champ++
      } else if (semiWinners.length === 1) {
        results.get(semiWinners[0].userId)!.champ++
      }
    } else if (playoffTeams.length >= 2) {
      for (const t of playoffTeams) results.get(t.userId)!.semis++
      const a = playoffTeams[0], b = playoffTeams[1]
      results.get(a.userId)!.finals++
      results.get(b.userId)!.finals++
      const prob = 1 / (1 + Math.pow(10, -(a.rating - b.rating) / 400))
      const champ = Math.random() < prob ? a : b
      results.get(champ.userId)!.champ++
    }
  }

  const probMap = new Map<string, PlayoffProbability>()
  for (const [userId, counts] of results) {
    probMap.set(userId, {
      makePlayoffs: Math.round((counts.playoffs / simulations) * 100),
      makeSemiFinals: Math.round((counts.semis / simulations) * 100),
      makeFinals: Math.round((counts.finals / simulations) * 100),
      winFinals: Math.round((counts.champ / simulations) * 100),
    })
  }

  return probMap
}

function determineStatus(
  prob: PlayoffProbability,
  rank: number,
  playoffSpots: number,
  wins: number,
  losses: number,
  totalWeeks: number,
  currentWeek: number,
  totalTeams: number,
): { status: 'clinched' | 'contending' | 'longshot' | 'eliminated'; reason: string } {
  const gamesPlayed = wins + losses
  const remainingWeeks = totalWeeks - currentWeek

  if (prob.makePlayoffs >= 95 && gamesPlayed > totalWeeks * 0.5) {
    return { status: 'clinched', reason: `Locked in — top ${playoffSpots} virtually guaranteed` }
  }

  if (prob.makePlayoffs <= 2 && gamesPlayed > 3) {
    const gamesBack = losses - (playoffSpots > 0 ? Math.floor(totalWeeks * (playoffSpots / totalTeams) * 0.6) : 0)
    return { status: 'eliminated', reason: `${prob.makePlayoffs}% chance — too far behind with ${remainingWeeks} weeks left` }
  }

  if (prob.makePlayoffs < 20) {
    if (gamesPlayed === 0) {
      return { status: 'longshot', reason: `Below-average roster strength — needs early wins to stay alive` }
    }
    return { status: 'longshot', reason: `${prob.makePlayoffs}% chance — needs a strong run to make the cut` }
  }

  if (rank <= playoffSpots) {
    return { status: 'contending', reason: `Currently in playoff position (#${rank} of ${playoffSpots} spots)` }
  }

  if (prob.makePlayoffs >= 50) {
    return { status: 'contending', reason: `${prob.makePlayoffs}% chance — strong path to the playoffs` }
  }

  return { status: 'contending', reason: `${prob.makePlayoffs}% chance — bubble team fighting for a spot` }
}

export const POST = withApiUsage({ endpoint: "/api/legacy/rankings/playoff-forecast", tool: "LegacyRankingsPlayoffForecast" })(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const { league_id, forecast_year, forecast_type = 'traditional' } = body

    const gate = await requireLegacySleeperIdentity(request, {
      requestedUsername: String(body?.sleeper_username || '').trim() || null,
      rateLimit: { action: 'playoff_forecast', maxRequests: 10, windowMs: 60_000 },
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

    const [leagueData, rosters, users] = await Promise.all([
      getLeagueInfo(league_id),
      getLeagueRosters(league_id),
      getLeagueUsers(league_id),
    ])

    if (!leagueData || !Array.isArray(rosters) || rosters.length === 0 || !Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ error: 'Failed to fetch league data' }, { status: 500 })
    }

    const userMap = new Map(users.map((u: any) => [u.user_id, u]))
    const currentSeason = parseInt(leagueData.season) || new Date().getFullYear()
    const targetYear = forecast_year || currentSeason

    const totalTeams = rosters.length
    const playoffTeamsSetting = Number(leagueData.settings?.playoff_teams)
    const playoffSpots: number = Number.isFinite(playoffTeamsSetting) && playoffTeamsSetting > 0
      ? playoffTeamsSetting
      : Math.ceil(totalTeams / 2)
    const playoffWeekStart = Number(leagueData.settings?.playoff_week_start)
    const totalWeeks: number = Number.isFinite(playoffWeekStart) && playoffWeekStart > 0
      ? playoffWeekStart - 1
      : (totalTeams >= 14 ? 14 : 13)

    let currentWeek = 0
    try {
      const nflState = await getNflState()
      if (nflState) {
        currentWeek = nflState.week || 0
        if (nflState.season !== String(currentSeason)) {
          currentWeek = 0
        }
      }
    } catch {}

    const teamRatingsInput = rosters.map((roster: any) => ({
      userId: roster.owner_id || roster.roster_id?.toString(),
      rating: computeTeamRating(roster, forecast_type),
      wins: roster.settings?.wins || 0,
      losses: roster.settings?.losses || 0,
      pf: (roster.settings?.fpts || 0) + ((roster.settings?.fpts_decimal || 0) / 100),
    }))

    const probabilities = runMonteCarloPlayoffs(
      teamRatingsInput,
      totalTeams,
      playoffSpots,
      totalWeeks,
      currentWeek,
    )

    const teamForecasts: TeamForecast[] = rosters.map((roster: any) => {
      const ownerId = roster.owner_id || roster.roster_id?.toString()
      const ownerInfo: any = userMap.get(roster.owner_id)
      const teamName = ownerInfo?.display_name || `Team ${roster.roster_id}`
      const sleeperUsername = ownerInfo?.display_name || ''

      const wins = roster.settings?.wins || 0
      const losses = roster.settings?.losses || 0
      const fpts = (roster.settings?.fpts || 0) + ((roster.settings?.fpts_decimal || 0) / 100)

      const teamRating = computeTeamRating(roster, forecast_type)
      const probs = probabilities.get(ownerId) || { makePlayoffs: 0, makeSemiFinals: 0, makeFinals: 0, winFinals: 0 }

      return {
        userId: ownerId,
        teamName,
        sleeperUsername,
        teamRating,
        currentRecord: `${wins}-${losses}`,
        wins,
        losses,
        pointsFor: Math.round(fpts * 10) / 10,
        rank: 0,
        isUser: roster.owner_id === user.sleeperUserId,
        probabilities: probs,
        status: 'contending' as const,
        statusReason: '',
      }
    })

    teamForecasts.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
      return b.teamRating - a.teamRating
    })
    teamForecasts.forEach((t, i) => { t.rank = i + 1 })

    for (const team of teamForecasts) {
      const { status, reason } = determineStatus(
        team.probabilities,
        team.rank,
        playoffSpots,
        team.wins,
        team.losses,
        totalWeeks,
        currentWeek,
        totalTeams,
      )
      team.status = status
      team.statusReason = reason
    }

    const userTeam = teamForecasts.find(t => t.isUser)
    let aiRecommendations: string[] = []

    if (userTeam) {
      try {
        const topTeams = teamForecasts.slice(0, 3).map(t => `${t.teamName} (${t.currentRecord}, ${t.probabilities.makePlayoffs}%)`).join(', ')
        const prompt = `As a fantasy sports analyst, provide 3 brief actionable recommendations to improve this team's playoff chances.

Team: ${userTeam.teamName}
Rating: ${userTeam.teamRating} (Rank #${userTeam.rank} of ${totalTeams})
Record: ${userTeam.currentRecord}
Points For: ${userTeam.pointsFor}
League: ${totalTeams} teams, ${playoffSpots} playoff spots
Current Playoff Probability: ${userTeam.probabilities.makePlayoffs}%
Status: ${userTeam.status} — ${userTeam.statusReason}
Top teams: ${topTeams}
Regular season: ${totalWeeks} weeks, currently week ${currentWeek}

Respond with exactly 3 brief, specific recommendations (1 sentence each). Format as JSON array of strings.`

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 300,
        })

        const content = completion.choices[0]?.message?.content || '[]'
        const jsonMatch = content.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          aiRecommendations = JSON.parse(jsonMatch[0])
        }
      } catch (err) {
        console.error('AI recommendations error:', err)
        aiRecommendations = [
          'Focus on acquiring high-upside players to build long-term value',
          'Target positional depth at your weakest positions',
          'Monitor injury reports and handcuffs for your key players'
        ]
      }
    }

    return NextResponse.json({
      forecasts: teamForecasts,
      leagueInfo: {
        name: leagueData.name,
        totalTeams,
        playoffSpots,
        season: currentSeason,
        forecastYear: targetYear,
        totalWeeks,
        currentWeek,
      },
      aiRecommendations,
      forecastType: forecast_type === 'elo' ? 'Elo Adjusted ADP Forecast' : 'Traditional ADP Forecast',
    })
  } catch (error) {
    console.error('Playoff forecast error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
