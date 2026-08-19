import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { getOrCreateAiResult } from '@/lib/ai/ai-result-cache'
import { fetchFantasyCalcValues } from '@/lib/fantasycalc'
import { writeSnapshot } from '@/lib/trade-engine/snapshot-store'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'
import { logUserEventByUsername } from '@/lib/user-events'
import {
  getAllPlayers,
  getLeagueInfo,
  getLeagueRosters,
  getLeagueUsers,
  getPlayoffBracket,
  getTradedDraftPicks,
} from '@/lib/sleeper-client'

const openai = getOpenAIRouteClient()

interface SleeperRoster {
  roster_id: number
  owner_id: string | null
  players?: string[] | null
  settings?: {
    wins?: number
    losses?: number
    ties?: number
    fpts?: number
    fpts_decimal?: number
  }
  starters?: string[] | null
}

interface SleeperUser {
  user_id: string
  display_name?: string
  username?: string
  avatar?: string
}

interface PlayerInfo {
  name: string
  position: string
  team: string
  value: number
}

interface PickInfo {
  name: string
  round: number
  year: number
  value: number
}

interface TeamRanking {
  userId: string
  teamName: string
  sleeperUsername: string
  rosterValue: number
  pointsFor: number
  winRate: number
  futureOutlook: number
  overallScore: number
  isChampion?: boolean
  isRunnerUp?: boolean
  madePlayoffs?: boolean
  isUser: boolean
  wins: number
  losses: number
  qbValue: number
  rbValue: number
  wrValue: number
  teValue: number
  pickValue: number
  tier: string
  players: {
    qb: PlayerInfo[]
    rb: PlayerInfo[]
    wr: PlayerInfo[]
    te: PlayerInfo[]
    picks: PickInfo[]
  }
  avgAge: number
  starterRank?: number
  starterValue?: number
}

export const POST = withApiUsage({ endpoint: "/api/legacy/rankings/analyze", tool: "LegacyRankingsAnalyze" })(async (request: NextRequest) => {
  try {
    const body = await request.json().catch(() => ({}))
    const sleeperUser = body?.sleeperUser as { username?: string; userId?: string } | undefined
    const league_id = String(body?.leagueId || body?.league_id || '').trim()

    /*
     * This route accepted the username from EITHER `body.sleeperUser.username` or
     * `body.sleeper_username`. Both are caller-controlled, so both are only compared now —
     * the first one present is what gets checked against the caller's own link.
     */
    const gate = await requireLegacySleeperIdentity(request, {
      requestedUsername: String(sleeperUser?.username || body?.sleeper_username || '').trim() || null,
      rateLimit: { action: 'rankings_analyze', maxRequests: 10, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeper_username = gate.identity.sleeperUsername

    if (!league_id) {
      return NextResponse.json({ error: 'Missing league_id' }, { status: 400 })
    }

    logUserEventByUsername(sleeper_username, 'rankings_analysis_started', { league_id })

    const sleeperUsernameLower = sleeper_username.toLowerCase()
    const sleeperUserId = sleeperUser?.userId?.trim() || undefined

    let user = await prisma.legacyUser.findUnique({
      where: { sleeperUsername: sleeperUsernameLower },
    })

    if (!user && sleeperUserId) {
      user = await prisma.legacyUser.findFirst({
        where: { sleeperUserId },
      })
    }

    if (!user) {
      return NextResponse.json({ error: 'User not found. Please sign up on the AllFantasy home page first.' }, { status: 404 })
    }

    const leagueData: any = await getLeagueInfo(league_id)
    if (!leagueData) {
      return NextResponse.json({ error: 'Failed to fetch league' }, { status: 500 })
    }

    const [rostersData, usersData, tradedPicksData, bracketData] = await Promise.all([
      getLeagueRosters(league_id),
      getLeagueUsers(league_id),
      getTradedDraftPicks(league_id),
      getPlayoffBracket(league_id),
    ])

    if (!Array.isArray(rostersData) || !Array.isArray(usersData)) {
      return NextResponse.json({ error: 'Failed to fetch league data' }, { status: 500 })
    }

    const rosters: SleeperRoster[] = rostersData as SleeperRoster[]
    const users: SleeperUser[] = usersData as SleeperUser[]
    const tradedPicks: any[] = Array.isArray(tradedPicksData) ? tradedPicksData : []
    const bracketEntries: any[] = Array.isArray(bracketData) ? bracketData : []
    const championRosterId = (() => {
      if (!Array.isArray(bracketEntries) || bracketEntries.length === 0) return null
      const finalMatch = bracketEntries.find((m: any) => m.r === 3 && m.t1_from?.w !== undefined)
        || bracketEntries.find((m: any) => m.r === 3)
        || bracketEntries.find((m: any) => m.p === 1)
      if (!finalMatch) return null
      if (finalMatch.w != null) return finalMatch.w
      return null
    })()
    const runnerUpRosterId = (() => {
      if (!Array.isArray(bracketEntries) || bracketEntries.length === 0) return null
      const finalMatch = bracketEntries.find((m: any) => m.r === 3 && m.t1_from?.w !== undefined)
        || bracketEntries.find((m: any) => m.r === 3)
        || bracketEntries.find((m: any) => m.p === 1)
      if (!finalMatch) return null
      if (finalMatch.l != null) return finalMatch.l
      return null
    })()

    const rosterPicksMap = new Map<number, string[]>()

    const currentYear =
      Number.parseInt(String(leagueData?.season || ''), 10) || new Date().getFullYear()
    const futureYears = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3]

    const maxRounds = 5

    for (const roster of rosters) {
      rosterPicksMap.set(roster.roster_id, [])
    }

    const tradedPickOwnership = new Map<string, number>()
    for (const pick of tradedPicks) {
      const season = Number(pick?.season)
      const round = Number(pick?.round)
      const originalOwner = Number(pick?.roster_id)
      const currentOwner = Number(pick?.owner_id)
      if (!Number.isFinite(season) || !Number.isFinite(round) || !Number.isFinite(originalOwner) || !Number.isFinite(currentOwner)) continue
      const key = `${season}_${round}_${originalOwner}`
      tradedPickOwnership.set(key, currentOwner)
    }

    for (const year of futureYears) {
      for (let round = 1; round <= maxRounds; round++) {
        for (const roster of rosters) {
          const originalOwnerId = roster.roster_id
          const pickKey = `${year}_${round}_${originalOwnerId}`
          const pickId = `${year}_${round}_${originalOwnerId}`

          const currentOwnerId = tradedPickOwnership.get(pickKey)

          if (currentOwnerId !== undefined) {
            const ownerPicks = rosterPicksMap.get(currentOwnerId) || []
            ownerPicks.push(pickId)
            rosterPicksMap.set(currentOwnerId, ownerPicks)
          } else {
            const ownerPicks = rosterPicksMap.get(originalOwnerId) || []
            ownerPicks.push(pickId)
            rosterPicksMap.set(originalOwnerId, ownerPicks)
          }
        }
      }
    }

    const userMap = new Map(users.map((u) => [u.user_id, u]))

    let playersData: Record<string, any> = {}
    try {
      playersData = await getAllPlayers()
    } catch {
      console.log('Could not fetch players data')
    }

    const fantasyCalcValues = await getFantasyCalcValues(leagueData)

    const teamRankings: TeamRanking[] = rosters
      .filter((roster) => !!roster.owner_id)
      .map((roster) => {
        const ownerId = roster.owner_id as string
        const ownerInfo = userMap.get(ownerId)

        const teamName = ownerInfo?.display_name || ownerInfo?.username || `Team ${roster.roster_id}`
        const sleeperUsername = ownerInfo?.username || ownerInfo?.display_name || ''

        const rosterPlayers = (roster.players || []).filter(Boolean)
        const rosterPicks = rosterPicksMap.get(roster.roster_id) || []
        const allAssets = [...rosterPlayers, ...rosterPicks]

        const positionalValues = calculatePositionalValuesWithPlayers(allAssets, fantasyCalcValues, playersData)
        const rosterValue = positionalValues.total

        const wins = roster.settings?.wins ?? 0
        const losses = roster.settings?.losses ?? 0
        const ties = roster.settings?.ties ?? 0
        const totalGames = wins + losses + ties
        const winRate = totalGames > 0 ? wins / totalGames : 0

        const pointsFor =
          (roster.settings?.fpts ?? 0) + ((roster.settings?.fpts_decimal ?? 0) / 100)

        const futureOutlook = calculateFutureOutlook(rosterPlayers, playersData)

        const isChampion = roster.roster_id === championRosterId
        const isRunnerUp = roster.roster_id === runnerUpRosterId
        const madePlayoffs = Array.isArray(bracketEntries) && bracketEntries.some(
          (m: any) => m.t1 === roster.roster_id || m.t2 === roster.roster_id
        )

        let postseasonBonus = 0
        if (isChampion) postseasonBonus = 150
        else if (isRunnerUp) postseasonBonus = 80
        else if (madePlayoffs) postseasonBonus = 30

        const overallScore =
          rosterValue * 0.30 +
          pointsFor * 0.20 +
          winRate * 100 * 0.20 +
          futureOutlook * 0.10 +
          postseasonBonus * 0.20

        const ownerAvatarId = ownerInfo?.avatar
        const ownerAvatar = ownerAvatarId ? `https://sleepercdn.com/avatars/thumbs/${ownerAvatarId}` : null

        return {
          userId: ownerId,
          teamName,
          sleeperUsername,
          ownerAvatar,
          rosterValue,
          pointsFor,
          winRate,
          futureOutlook,
          overallScore,
          isChampion,
          isRunnerUp,
          madePlayoffs,
          isUser: ownerId === user.sleeperUserId,
          wins,
          losses,
          qbValue: positionalValues.qb,
          rbValue: positionalValues.rb,
          wrValue: positionalValues.wr,
          teValue: positionalValues.te,
          pickValue: positionalValues.pick,
          tier: '',
          players: positionalValues.players,
          avgAge: positionalValues.avgAge,
        }
      })

    if (!teamRankings || teamRankings.length === 0) {
      return buildPreseasonFallbackResponse({
        league: leagueData,
        sleeperUser: { username: sleeper_username, userId: sleeperUserId },
      })
    }

    teamRankings.sort((a, b) => b.overallScore - a.overallScore)

    const totalTeams = teamRankings.length
    const hasMatchupData = teamRankings.some(t => t.pointsFor > 0 || t.wins > 0)
    const leagueStatus = leagueData?.status || 'unknown'
    const isOffseason = leagueStatus === 'pre_draft' || leagueStatus === 'drafting' || leagueStatus === 'complete' || !hasMatchupData

    let rankingSource: 'live' | 'preseason_market' | 'snapshot' = hasMatchupData ? 'live' : 'preseason_market'
    let rankingSourceNote = hasMatchupData
      ? 'In-season data with live stats and records.'
      : 'Preseason (Market-based) — no matchup data yet. Rankings use roster value and future outlook only.'

    if (isOffseason && !hasMatchupData) {
      teamRankings.forEach(t => {
        t.overallScore = t.rosterValue * 0.55 + t.futureOutlook * 0.45
      })
      teamRankings.sort((a, b) => b.overallScore - a.overallScore)
    }
    const safeTotal = Math.max(1, totalTeams)
    teamRankings.forEach((team, idx) => {
      const rank = idx + 1
      const percentile = rank / safeTotal
      if (percentile <= 0.25) team.tier = 'Contender'
      else if (percentile <= 0.58) team.tier = 'Frisky'
      else if (percentile <= 0.83) team.tier = 'Fraud'
      else team.tier = 'Trust the Process'
    })

    const userTeam = teamRankings.find((t) => t.isUser)
    const userRank = Math.max(1, teamRankings.findIndex((t) => t.isUser) + 1)

    const rosterValueSorted = [...teamRankings].sort((a, b) => b.rosterValue - a.rosterValue)
    const pointsForSorted = [...teamRankings].sort((a, b) => b.pointsFor - a.pointsFor)
    const winRateSorted = [...teamRankings].sort((a, b) => b.winRate - a.winRate)
    const futureOutlookSorted = [...teamRankings].sort((a, b) => b.futureOutlook - a.futureOutlook)

    const qbSorted = [...teamRankings].sort((a, b) => b.qbValue - a.qbValue)
    const rbSorted = [...teamRankings].sort((a, b) => b.rbValue - a.rbValue)
    const wrSorted = [...teamRankings].sort((a, b) => b.wrValue - a.wrValue)
    const teSorted = [...teamRankings].sort((a, b) => b.teValue - a.teValue)
    const pickSorted = [...teamRankings].sort((a, b) => b.pickValue - a.pickValue)

    const rosterValueRank = Math.max(1, rosterValueSorted.findIndex((t) => t.isUser) + 1)
    const pointsForRank = Math.max(1, pointsForSorted.findIndex((t) => t.isUser) + 1)
    const winRateRank = Math.max(1, winRateSorted.findIndex((t) => t.isUser) + 1)
    const futureOutlookRank = Math.max(1, futureOutlookSorted.findIndex((t) => t.isUser) + 1)

    const allTeamsWithPositionalRanks = teamRankings.map((team, idx) => ({
      ...team,
      qbRank: qbSorted.findIndex((t) => t.userId === team.userId) + 1,
      rbRank: rbSorted.findIndex((t) => t.userId === team.userId) + 1,
      wrRank: wrSorted.findIndex((t) => t.userId === team.userId) + 1,
      teRank: teSorted.findIndex((t) => t.userId === team.userId) + 1,
      pickRank: pickSorted.findIndex((t) => t.userId === team.userId) + 1,
      overallRank: idx + 1,
    }))

    let aiAnalysis = ''
    try {
      const prompt = `You are a fantasy football analyst. Analyze this team's position in their dynasty league and provide a brief, insightful 2-3 sentence analysis.

League: ${leagueData.name}
Team: ${userTeam?.teamName || 'Unknown'}
Overall Rank: #${userRank} of ${teamRankings.length}
Roster Value Rank: #${rosterValueRank}
Points For Rank: #${pointsForRank}
Win Rate Rank: #${winRateRank} (${userTeam?.wins ?? 0}-${userTeam?.losses ?? 0})
Future Outlook Rank: #${futureOutlookRank}
${userTeam?.isChampion ? '🏆 LEAGUE CHAMPION' : userTeam?.isRunnerUp ? '🥈 Runner-Up' : userTeam?.madePlayoffs ? '✅ Made Playoffs' : ''}

Top 3 teams: ${teamRankings
        .slice(0, 3)
        .map((t, i) => `${i + 1}. ${t.teamName} (${t.overallScore.toFixed(1)})`)
        .join(', ')}

Provide actionable insight about where this team stands and what they should focus on (contending now vs rebuilding).`

      const aiPayload = {
        featureName: 'legacy-rankings-analyze',
        sport: String(leagueData?.sport || 'nfl').toLowerCase(),
        season: String(leagueData?.season || ''),
        scoringFormat:
          Number(leagueData?.scoring_settings?.rec || 0) === 1
            ? 'ppr'
            : Number(leagueData?.scoring_settings?.rec || 0) === 0.5
              ? 'half_ppr'
              : 'standard',
        leagueId: league_id,
        week: Number(leagueData?.settings?.leg || 0) || null,
        userId: user.sleeperUserId,
        userRank,
        totalTeams: teamRankings.length,
        rosterValueRank,
        pointsForRank,
        winRateRank,
        futureOutlookRank,
        options: {
          model: 'gpt-4o',
          maxTokens: 200,
          temperature: 0.7,
        },
        prompt,
      }

      const aiResult = await getOrCreateAiResult({
        feature: 'legacy-rankings-analyze-summary',
        scopeType: 'league',
        scopeId: league_id,
        provider: 'openai',
        model: 'gpt-4o',
        payload: aiPayload,
        ttlSeconds: 2 * 60 * 60,
        onCacheMiss: async () => {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
            temperature: 0.7,
          })
          const content = completion.choices[0]?.message?.content || ''
          return {
            resultText: content,
            resultJson: { analysis: content },
            tokenPrompt: completion.usage?.prompt_tokens ?? null,
            tokenOutput: completion.usage?.completion_tokens ?? null,
          }
        },
      })

      if (aiResult.cacheHit) {
        console.log(`[legacy-rankings/analyze] AI cache hit { leagueId: '${league_id}', userId: '${user.sleeperUserId}' }`)
      } else {
        console.log(`[legacy-rankings/analyze] AI cache miss { leagueId: '${league_id}', userId: '${user.sleeperUserId}', modelCallMs: ${aiResult.modelDurationMs ?? -1} }`)
        console.log(`[legacy-rankings/analyze] saved AiResult { id: '${aiResult.row.id}', resultKey: '${aiResult.row.resultKey}' }`)
      }

      aiAnalysis = (aiResult.row.resultText || '').trim()
    } catch (err) {
      console.error('AI analysis error:', err)
    }

    const rosterPositions: string[] = Array.isArray(leagueData?.roster_positions) ? leagueData.roster_positions : []

    const isSF =
      leagueData?.settings?.superflex_enabled === 1 ||
      rosterPositions.filter((p: string) => p === 'SUPER_FLEX' || p === 'QB').length >= 2

    const starters = rosterPositions.filter((p: string) => !['BN', 'IR', 'TAXI'].includes(p)).length

    const baseRec = Number(leagueData?.scoring_settings?.rec || 0)
    const teRec = Number(leagueData?.scoring_settings?.rec_te || 0)
    const teBonus = Number(leagueData?.scoring_settings?.bonus_rec_te || 0)

    const hasTEP = teRec > baseRec || teBonus > 0
    const tepBonus = hasTEP ? (teRec - baseRec > 0 ? teRec - baseRec : teBonus) : 0

    const responsePayload = {
      leagueName: leagueData.name,
      teamName: userTeam?.teamName,
      userRank,
      totalTeams: teamRankings.length,
      rosterValueRank,
      pointsForRank,
      winRateRank,
      futureOutlookRank,
      allTeams: allTeamsWithPositionalRanks,
      aiAnalysis,
      leagueSettings: {
        isSF,
        starters,
        hasTEP,
        tepBonus,
      },
      rankingSource,
      rankingSourceNote,
      isOffseason,
    }

    try {
      await writeSnapshot({
        leagueId: league_id,
        sleeperUsername: sleeperUsernameLower,
        snapshotType: 'rankings_analyze',
        payload: responsePayload,
        season: leagueData?.season ? Number(leagueData.season) : undefined,
        ttlHours: 24,
      })
    } catch (snapErr) {
      console.warn('[Rankings] Failed to write snapshot:', snapErr)
    }

    logUserEventByUsername(sleeper_username, 'rankings_analysis_completed', {
      leagueId: league_id,
    })

    return NextResponse.json(responsePayload)
  } catch (error: any) {
    console.error('Rankings analyze error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
})

function buildPreseasonFallbackResponse({
  league,
  sleeperUser,
}: {
  league: any
  sleeperUser: { username: string; userId?: string }
}) {
  const rosterPositions: string[] = Array.isArray(league?.roster_positions) ? league.roster_positions : []
  const isSF =
    league?.settings?.superflex_enabled === 1 ||
    rosterPositions.filter((p: string) => p === 'SUPER_FLEX' || p === 'QB').length >= 2
  const starters = rosterPositions.filter((p: string) => !['BN', 'IR', 'TAXI'].includes(p)).length
  const baseRec = Number(league?.scoring_settings?.rec || 0)
  const teRec = Number(league?.scoring_settings?.rec_te || 0)
  const teBonus = Number(league?.scoring_settings?.bonus_rec_te || 0)
  const hasTEP = teRec > baseRec || teBonus > 0
  const tepBonus = hasTEP ? (teRec - baseRec > 0 ? teRec - baseRec : teBonus) : 0

  return NextResponse.json({
    leagueName: league?.name ?? 'Unknown League',
    teamName: sleeperUser.username ?? 'Your Team',
    userRank: 1,
    totalTeams: league?.total_rosters ?? 1,
    rosterValueRank: 1,
    pointsForRank: 1,
    winRateRank: 1,
    futureOutlookRank: 1,
    allTeams: [],
    aiAnalysis:
      'This league is currently in preseason or has no finalized rosters. Preseason market-based projections will activate once roster data is available.',
    leagueSettings: {
      isSF,
      starters,
      hasTEP,
      tepBonus,
    },
    rankingSource: 'preseason_empty',
    rankingSourceNote:
      'No active roster data available — awaiting finalized season data.',
    isOffseason: true,
    fallbackMode: true,
  })
}

async function getFantasyCalcValues(league: any): Promise<Map<string, number>> {
  const rosterPositions: string[] = Array.isArray(league?.roster_positions) ? league.roster_positions : []
  const isSF =
    league?.settings?.superflex_enabled === 1 ||
    rosterPositions.filter((p: string) => p === 'SUPER_FLEX' || p === 'QB').length >= 2
  const numTeams = Number(league?.total_rosters) || 12

  const values = new Map<string, number>()
  try {
    const fcPlayers = await fetchFantasyCalcValues({
      isDynasty: true,
      numQbs: isSF ? 2 : 1,
      numTeams,
      ppr: 1,
    })
    for (const fc of fcPlayers) {
      const name = fc?.player?.name
      if (!name || typeof fc.value !== 'number' || !Number.isFinite(fc.value)) continue
      values.set(name.toLowerCase(), fc.value)
    }
  } catch (err) {
    console.error('[legacy/rankings/analyze] FantasyCalc fetch failed, falling back to position+age valuation:', err)
  }
  return values
}

function calculatePositionalValuesWithPlayers(
  playerIds: string[],
  fcValues: Map<string, number>,
  playersData: Record<string, any>
): {
  total: number
  qb: number
  rb: number
  wr: number
  te: number
  pick: number
  players: { qb: PlayerInfo[]; rb: PlayerInfo[]; wr: PlayerInfo[]; te: PlayerInfo[]; picks: PickInfo[] }
  avgAge: number
} {
  const values = { total: 0, qb: 0, rb: 0, wr: 0, te: 0, pick: 0 }
  const players: { qb: PlayerInfo[]; rb: PlayerInfo[]; wr: PlayerInfo[]; te: PlayerInfo[]; picks: PickInfo[] } = {
    qb: [],
    rb: [],
    wr: [],
    te: [],
    picks: [],
  }

  let totalAge = 0
  let playerCount = 0

  for (const playerId of playerIds) {
    const pickMatch = playerId.match(/^(\d{4})_(\d+)(?:_(\d+))?$/)
    if (pickMatch) {
      const year = parseInt(pickMatch[1], 10)
      const round = parseInt(pickMatch[2], 10)
      const pickValue = getPickValue(round, year)
      values.pick += pickValue
      values.total += pickValue
      players.picks.push({
        name: `${year} Rd ${round}`,
        round,
        year,
        value: pickValue,
      })
      continue
    }

    const player = playersData[playerId]
    if (!player) continue

    const first = String(player.first_name || '').trim()
    const last = String(player.last_name || '').trim()
    const playerName = `${first} ${last}`.trim() || String(playerId)

    const playerNameLower = playerName.toLowerCase()
    const fcValue = fcValues.get(playerNameLower)

    let playerValue: number
    if (typeof fcValue === 'number' && Number.isFinite(fcValue)) {
      playerValue = fcValue
    } else {
      const positionValue = getPositionBaseValue(String(player.position || ''))
      const ageAdjustment = getAgeAdjustment(player.age)
      playerValue = positionValue * ageAdjustment
    }

    values.total += playerValue

    const playerInfo: PlayerInfo = {
      name: playerName,
      position: String(player.position || 'UNK'),
      team: String(player.team || 'FA'),
      value: Math.round(playerValue),
    }

    if (player.age) {
      totalAge += Number(player.age)
      playerCount++
    }

    switch (String(player.position || '').toUpperCase()) {
      case 'QB':
        values.qb += playerValue
        players.qb.push(playerInfo)
        break
      case 'RB':
        values.rb += playerValue
        players.rb.push(playerInfo)
        break
      case 'WR':
        values.wr += playerValue
        players.wr.push(playerInfo)
        break
      case 'TE':
        values.te += playerValue
        players.te.push(playerInfo)
        break
      default:
        break
    }
  }

  ;(Object.keys(players) as Array<keyof typeof players>).forEach((pos) => {
    players[pos].sort((a, b) => b.value - a.value)
  })

  return {
    ...values,
    players,
    avgAge: playerCount > 0 ? Math.round((totalAge / playerCount) * 10) / 10 : 0,
  }
}

function getPositionBaseValue(position: string): number {
  const values: Record<string, number> = {
    QB: 4000,
    RB: 3500,
    WR: 3800,
    TE: 2500,
    K: 500,
    DEF: 500,
  }
  return values[String(position || '').toUpperCase()] || 1000
}

function getAgeAdjustment(age: number | undefined): number {
  const a = typeof age === 'number' ? age : Number(age)
  if (!Number.isFinite(a)) return 0.8
  if (a <= 23) return 1.3
  if (a <= 25) return 1.1
  if (a <= 27) return 1.0
  if (a <= 29) return 0.85
  if (a <= 31) return 0.65
  return 0.4
}

function getPickValue(round: number, year: number): number {
  const currentYear = new Date().getFullYear()
  const yearDiff = year - currentYear

  const roundValues: Record<number, number> = {
    1: 8000,
    2: 4000,
    3: 2000,
    4: 1000,
    5: 500,
  }

  let baseValue = roundValues[round] || 300

  if (yearDiff === 1) baseValue *= 1.1
  else if (yearDiff >= 2) baseValue *= 1.2
  else if (yearDiff < 0) baseValue *= 0.5

  return Math.round(baseValue)
}

function calculateFutureOutlook(playerIds: string[], playersData: Record<string, any>): number {
  let youngStars = 0
  let primeAge = 0
  let aging = 0

  for (const playerId of playerIds) {
    const player = playersData[playerId]
    const age = player?.age
    if (!age) continue
    if (age <= 24) youngStars++
    else if (age <= 28) primeAge++
    else aging++
  }

  const total = youngStars + primeAge + aging
  if (total === 0) return 50

  const score = (((youngStars * 3) + (primeAge * 2) + (aging * 0.5)) / total) * 33
  return Math.min(100, Math.max(0, score))
}
