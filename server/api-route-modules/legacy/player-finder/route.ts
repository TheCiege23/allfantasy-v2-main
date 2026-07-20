import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { getLeagueRosters, getLeagueUsers, getPlayersBySport } from '@/lib/sleeper-client'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

const openai = getOpenAIRouteClient()

type Sport = 'nfl' | 'nba'

interface StockMovement {
  direction: 'up' | 'down' | 'stable'
  signal: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell'
  reason: string
  recentActivity: {
    tradesIn: number
    tradesOut: number
    waiverAdds: number
    waiverDrops: number
    last30Days: boolean
  }
}

interface SleeperPlayer {
  player_id: string
  full_name?: string
  first_name?: string
  last_name?: string
  position?: string
  team?: string | null
  injury_status?: string
  injury_body_part?: string
  status?: string
  age?: number
  years_exp?: number
  height?: string
  weight?: string
  college?: string
  number?: number
  depth_chart_position?: string
  depth_chart_order?: number
  fantasy_positions?: string[]
  birth_date?: string
  search_rank?: number
}

interface SleeperRoster {
  roster_id: number
  owner_id?: string
  starters?: string[]
  players?: string[]
  taxi?: string[]
  reserve?: string[]
}

const playersCache: Record<Sport, { at: number; data: Record<string, SleeperPlayer> | null }> = {
  nfl: { at: 0, data: null },
  nba: { at: 0, data: null },
}
const CACHE_TTL = 24 * 60 * 60 * 1000

async function getSleeperPlayers(sport: Sport): Promise<Record<string, SleeperPlayer>> {
  const now = Date.now()
  if (playersCache[sport].data && now - playersCache[sport].at < CACHE_TTL) {
    return playersCache[sport].data!
  }
  const data = (await getPlayersBySport(sport)) as unknown as Record<string, SleeperPlayer>
  if (!data || Object.keys(data).length === 0) throw new Error('Failed to fetch players')
  playersCache[sport] = { at: now, data }
  return data
}

function normalizeName(name?: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function calculateStockMovement(
  sleeperUsername: string,
  playerName: string,
  ownedLeagueCount: number,
  totalLeagues: number,
  position: string
): Promise<StockMovement> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  
  const tradeHistories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperUsername },
    select: { id: true },
  })
  
  let tradesIn = 0
  let tradesOut = 0
  
  if (tradeHistories.length > 0) {
    const historyIds = tradeHistories.map(h => h.id)
    const recentTrades = await prisma.leagueTrade.findMany({
      where: {
        historyId: { in: historyIds },
        createdAt: { gte: thirtyDaysAgo },
      },
      select: {
        playersGiven: true,
        playersReceived: true,
        platform: true,
      },
    })
    
    const normalizedPlayerName = normalizeName(playerName)
    
    for (const trade of recentTrades) {
      const given = trade.playersGiven as Array<{ name: string }> | null
      const received = trade.playersReceived as Array<{ name: string }> | null
      
      if (given?.some(p => normalizeName(p.name) === normalizedPlayerName)) {
        tradesOut++
      }
      if (received?.some(p => normalizeName(p.name) === normalizedPlayerName)) {
        tradesIn++
      }
    }
  }
  
  const ownershipPct = totalLeagues > 0 ? (ownedLeagueCount / totalLeagues) * 100 : 0
  
  try {
    const aiPrompt = `You are a fantasy sports stock analyst. Analyze this player's ownership and generate a buy/sell signal.

PLAYER: ${playerName} (${position})
OWNERSHIP DATA:
- Owned in ${ownedLeagueCount} of ${totalLeagues} leagues (${ownershipPct.toFixed(1)}%)
- Last 30 days: ${tradesIn} times acquired, ${tradesOut} times traded away

ANALYSIS RULES:
1. Ownership >= 50% = CONCENTRATION RISK, recommend selling to diversify
2. Ownership >= 30% with no recent trades = Consider selling to reduce exposure
3. Recent trades IN > OUT = Stock rising, but high ownership means sell opportunity
4. Recent trades OUT > IN = Stock falling, low ownership means potential buy-low
5. Ownership <= 10% = Low exposure, could be buy opportunity if you believe in player
6. Balanced ownership (15-25%) with stable activity = Hold

Return JSON only:
{
  "direction": "up" | "down" | "stable",
  "signal": "strong_buy" | "buy" | "hold" | "sell" | "strong_sell",
  "reason": "One concise sentence explaining the recommendation"
}`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: aiPrompt }],
      max_tokens: 150,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    })
    
    const content = completion.choices[0]?.message?.content
    if (content) {
      const parsed = JSON.parse(content)
      
      const validDirections = ['up', 'down', 'stable'] as const
      const validSignals = ['strong_buy', 'buy', 'hold', 'sell', 'strong_sell'] as const
      
      const direction = validDirections.includes(parsed.direction) 
        ? parsed.direction as 'up' | 'down' | 'stable'
        : 'stable'
      const signal = validSignals.includes(parsed.signal)
        ? parsed.signal as StockMovement['signal']
        : 'hold'
      
      return {
        direction,
        signal,
        reason: typeof parsed.reason === 'string' && parsed.reason.length > 0 
          ? parsed.reason 
          : `${ownershipPct.toFixed(0)}% ownership across your leagues.`,
        recentActivity: {
          tradesIn,
          tradesOut,
          waiverAdds: 0,
          waiverDrops: 0,
          last30Days: true,
        },
      }
    }
  } catch (err) {
    console.warn('AI stock signal failed, using fallback:', err)
  }
  
  let direction: 'up' | 'down' | 'stable' = 'stable'
  let signal: StockMovement['signal'] = 'hold'
  let reason = ''
  
  if (tradesIn > tradesOut) {
    direction = 'up'
    if (ownershipPct >= 40) {
      signal = 'sell'
      reason = `You've been acquiring ${playerName} and now have high exposure (${ownershipPct.toFixed(0)}%). Consider selling some shares while value is high.`
    } else {
      signal = 'hold'
      reason = `Recent acquisitions show confidence in ${playerName}. Healthy exposure level.`
    }
  } else if (tradesOut > tradesIn) {
    direction = 'down'
    if (ownershipPct <= 10 && ownedLeagueCount > 0) {
      signal = 'buy'
      reason = `You've been moving away from ${playerName}. Low exposure - could be a buy-low opportunity.`
    } else {
      signal = 'hold'
      reason = `Recent trade activity shows you're reducing ${playerName} exposure.`
    }
  } else {
    if (ownershipPct >= 50) {
      signal = 'strong_sell'
      reason = `CONCENTRATION RISK: ${playerName} is in ${ownershipPct.toFixed(0)}% of your leagues. Consider diversifying.`
    } else if (ownershipPct >= 30) {
      signal = 'sell'
      reason = `High exposure to ${playerName}. Market downturns could hurt multiple teams.`
    } else if (ownershipPct <= 5 && ownedLeagueCount > 0) {
      signal = 'buy'
      reason = `Low exposure to ${playerName}. If you believe in them, consider acquiring more.`
    } else {
      signal = 'hold'
      reason = `Balanced exposure to ${playerName}.`
    }
  }
  
  return {
    direction,
    signal,
    reason,
    recentActivity: {
      tradesIn,
      tradesOut,
      waiverAdds: 0,
      waiverDrops: 0,
      last30Days: true,
    },
  }
}

export const POST = withApiUsage({ endpoint: "/api/legacy/player-finder", tool: "LegacyPlayerFinder" })(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const searchQuery = String(body.query || '').trim()
    const sportRaw = String(body.sport || 'nfl').trim().toLowerCase()

    /*
     * Originally hand-rolled here (PR #287) and now routed through the shared gate so this
     * route cannot drift from the other 21. Same behaviour: session -> AppUser.legacyUser
     * link, 409 when unlinked, 403 when the body names someone else, and a per-actor limit
     * after the gate — one call can fan out to ~20 model completions.
     */
    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: String(body.sleeper_username || '').trim() || null,
      rateLimit: { action: 'player_finder', maxRequests: 10, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeperUsername = gate.identity.sleeperUsername

    if (!searchQuery || searchQuery.length < 2) {
      return NextResponse.json({ error: 'Search query must be at least 2 characters' }, { status: 400 })
    }

    const sport: Sport = sportRaw === 'nba' ? 'nba' : 'nfl'

    const legacyUser = await prisma.legacyUser.findUnique({
      where: { sleeperUsername },
      include: {
        leagues: {
          where: { sport },
          orderBy: { season: 'desc' },
        }
      }
    })

    if (!legacyUser || legacyUser.leagues.length === 0) {
      return NextResponse.json({ error: 'No leagues found. Please import your data first.' }, { status: 404 })
    }

    const players = await getSleeperPlayers(sport)
    
    const normalizedSearch = normalizeName(searchQuery)
    const matchingPlayerIds: string[] = []
    const matchingPlayers: Record<string, SleeperPlayer> = {}
    
    for (const [id, player] of Object.entries(players)) {
      const fullName = player.full_name || `${player.first_name || ''} ${player.last_name || ''}`
      if (normalizeName(fullName).includes(normalizedSearch)) {
        matchingPlayerIds.push(id)
        matchingPlayers[id] = player
        if (matchingPlayerIds.length >= 20) break
      }
    }

    if (matchingPlayerIds.length === 0) {
      return NextResponse.json({ 
        success: true, 
        players: [],
        message: `No players found matching "${searchQuery}"`
      })
    }

    const uniqueLeagueIds = Array.from(new Set(legacyUser.leagues.map(l => l.sleeperLeagueId)))
    const totalLeagueCount = uniqueLeagueIds.length
    const rostersByLeague = new Map<string, SleeperRoster[]>()
    const usersByLeague = new Map<string, Array<{ user_id?: string; display_name?: string; username?: string }>>()
    
    const results: Array<{
      playerId: string
      playerName: string
      position: string
      team: string | null
      age: number | null
      experience: number | null
      injuryStatus: string | null
      injuryBodyPart: string | null
      height: string | null
      weight: string | null
      college: string | null
      number: number | null
      depthChartPosition: string | null
      depthChartOrder: number | null
      fantasyPositions: string[]
      searchRank: number | null
      ownership: {
        count: number
        total: number
        percentage: number
      }
      stock: StockMovement
      leagues: Array<{
        leagueId: string
        leagueName: string
        season: number
        leagueType: string | null
        rosterStatus: 'starter' | 'bench' | 'taxi' | 'ir' | 'unknown'
        ownerName: string | null
        isUserOwned: boolean
      }>
    }> = []

    for (const playerId of matchingPlayerIds) {
      const player = matchingPlayers[playerId]
      const playerLeagues: typeof results[0]['leagues'] = []

      for (const leagueId of uniqueLeagueIds) {
        const league = legacyUser.leagues.find(l => l.sleeperLeagueId === leagueId)
        if (!league) continue

        let rosters = rostersByLeague.get(leagueId)
        if (!rosters) {
          const loadedRosters = await getLeagueRosters(leagueId) as unknown as SleeperRoster[]
          if (!Array.isArray(loadedRosters) || loadedRosters.length === 0) {
            continue
          }
          rosters = loadedRosters
          rostersByLeague.set(leagueId, rosters)
        }

        let users = usersByLeague.get(leagueId)
        if (!users) {
          const loadedUsers = await getLeagueUsers(leagueId) as unknown as Array<{ user_id?: string; display_name?: string; username?: string }>
          users = Array.isArray(loadedUsers) ? loadedUsers : []
          usersByLeague.set(leagueId, users)
        }
        
        for (const roster of rosters) {
          const allPlayers = roster.players || []
          if (!allPlayers.includes(playerId)) continue

          let rosterStatus: 'starter' | 'bench' | 'taxi' | 'ir' | 'unknown' = 'unknown'
          
          if (roster.starters?.includes(playerId)) {
            rosterStatus = 'starter'
          } else if (roster.taxi?.includes(playerId)) {
            rosterStatus = 'taxi'
          } else if (roster.reserve?.includes(playerId)) {
            rosterStatus = 'ir'
          } else if (allPlayers.includes(playerId)) {
            rosterStatus = 'bench'
          }

          let ownerName: string | null = null
          let isUserOwned = false

          if (users.length > 0) {
            const owner = users.find((u: any) => u.user_id === roster.owner_id)
            ownerName = owner?.display_name || owner?.username || null
            isUserOwned = normalizeName(ownerName || '') === normalizeName(sleeperUsername)
          }

          // Only include leagues where the user owns the player
          if (isUserOwned) {
            playerLeagues.push({
              leagueId,
              leagueName: league.name,
              season: league.season,
              leagueType: league.leagueType,
              rosterStatus,
              ownerName,
              isUserOwned,
            })
          }
          
          break
        }
      }

      if (playerLeagues.length > 0) {
        const playerName = player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim()
        const ownershipCount = playerLeagues.length
        const ownershipPct = totalLeagueCount > 0 ? (ownershipCount / totalLeagueCount) * 100 : 0
        
        const stock = await calculateStockMovement(
          sleeperUsername,
          playerName,
          ownershipCount,
          totalLeagueCount,
          player.position || 'Unknown'
        )
        
        results.push({
          playerId,
          playerName,
          position: player.position || 'Unknown',
          team: player.team || null,
          age: player.age || null,
          experience: player.years_exp ?? null,
          injuryStatus: player.injury_status || player.status || null,
          injuryBodyPart: player.injury_body_part || null,
          height: player.height || null,
          weight: player.weight || null,
          college: player.college || null,
          number: player.number ?? null,
          depthChartPosition: player.depth_chart_position || null,
          depthChartOrder: player.depth_chart_order ?? null,
          fantasyPositions: player.fantasy_positions || [],
          searchRank: player.search_rank ?? null,
          ownership: {
            count: ownershipCount,
            total: totalLeagueCount,
            percentage: Math.round(ownershipPct * 10) / 10,
          },
          stock,
          leagues: playerLeagues,
        })
      }
    }

    results.sort((a, b) => b.leagues.length - a.leagues.length)

    return NextResponse.json({
      success: true,
      players: results,
      totalLeaguesSearched: uniqueLeagueIds.length,
    })

  } catch (error) {
    console.error('Player finder error:', error)
    return NextResponse.json({ error: 'Failed to search players' }, { status: 500 })
  }
})
