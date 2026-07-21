import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import {
  getLeagueTransactions,
  getLeagueRosters,
  getLeagueUsers,
  getLeagueHistory,
  resolveSleeperUser,
} from '@/lib/sleeper-client'
import { getCanonicalPlayerMapForSport } from '@/lib/canonical/getCanonicalPlayer'
import { pricePlayer, pricePick, ValuationContext } from '@/lib/hybrid-valuation'
import { assertSleeperBoundaryForLeagueId } from '@/lib/legacy/sleeper-boundary'

const openai = getOpenAIRouteClient()

interface TradeParty {
  rosterId: number
  userId: string
  displayName: string
  playersReceived: Array<{ id: string; name: string; position: string; team: string }>
  picksReceived: Array<{ season: string; round: number }>
  faabReceived: number
}

interface ProcessedTrade {
  transactionId: string
  timestamp: number
  week: number
  season: string
  parties: TradeParty[]
  userInvolved: boolean
  userSide: 'gave' | 'received' | null
  userRosterId?: number
}

interface TradesByYear {
  [year: string]: ProcessedTrade[]
}

interface WaiverTransaction {
  playerId: string
  playerName: string
  position: string
  team: string
  type: 'add' | 'drop'
  timestamp: number
  week: number
  season: string
}

interface WaiverActivity {
  adds: WaiverTransaction[]
  drops: WaiverTransaction[]
  totalAdds: number
  totalDrops: number
}

interface WaiverMVPEvent {
  type: 'add' | 'drop'
  teamName: string
  timestamp: number
  date: string
}

interface WaiverMVP {
  playerId: string
  playerName: string
  position: string
  team: string
  timesAdded: number
  timesDropped: number
  totalMoves: number
  journey: WaiverMVPEvent[]
}

export const POST = withApiUsage({ endpoint: "/api/legacy/trade-history", tool: "LegacyTradeHistory" })(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const { leagueId, userId, action, trade } = body
    const normalizedLeagueId = String(leagueId || '').trim()

    if (!normalizedLeagueId || !userId) {
      return NextResponse.json({ error: 'Missing leagueId or userId' }, { status: 400 })
    }

    const boundary = await assertSleeperBoundaryForLeagueId(normalizedLeagueId)
    if (!boundary.ok) {
      return NextResponse.json({ error: boundary.message }, { status: boundary.status })
    }

    if (action === 'fetch') {
      const { tradesByYear, totalCount, managers, allSeasons, waiverActivity, waiverMVP } = await fetchAllLeagueTrades(normalizedLeagueId, userId)
      return NextResponse.json({ tradesByYear, total: totalCount, managers, allSeasons, waiverActivity, waiverMVP })
    }

    if (action === 'grade' && trade) {
      const gradedTrade = await gradeTrade(trade)
      return NextResponse.json({ gradedTrade })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    console.error('Trade history error:', error)
    return NextResponse.json({ error: error.message || 'Failed to process' }, { status: 500 })
  }
})

async function fetchAllLeagueTrades(leagueId: string, userId: string): Promise<{ 
  tradesByYear: TradesByYear; 
  totalCount: number; 
  managers: Record<string, string>;
  allSeasons: string[];
  waiverActivity: WaiverActivity;
  waiverMVP: WaiverMVP | null;
}> {
  // First, resolve the username to a consistent Sleeper user_id
  // This ensures we match the user correctly across all seasons
  const resolvedUser = await resolveSleeperUser(userId)
  const sleeperUserId = resolvedUser?.userId || userId
  
  console.log(`[TRADE-HISTORY] Resolved user "${userId}" to Sleeper user_id: ${sleeperUserId}`)
  
  // Pass userId to getLeagueHistory to enable searching for leagues by name across seasons
  const leagueHistory = await getLeagueHistory(leagueId, userId)
  // Phase 3 batch 2 — canonical read path. Historical trade/waiver log: it renders what already
  // happened, so cache-only is correct here; nothing downstream acts on live roster state.
  // Reshaped to the `Record<sleeperId, {...}>` the helper below already expects, so the
  // surrounding logic is untouched.
  const canonicalPlayers = await getCanonicalPlayerMapForSport('NFL')
  const allPlayers: Record<string, { full_name: string; position: string; team: string | null }> =
    Object.fromEntries(
      [...canonicalPlayers].map(([sleeperId, p]) => [
        sleeperId,
        { full_name: p.name, position: p.position, team: p.team },
      ]),
    )
  
  console.log('[TRADE-HISTORY] League history found:', leagueHistory.map(l => ({ id: l.league_id, name: l.name, season: l.season, prev: l.previous_league_id })))
  
  const tradesByYear: TradesByYear = {}
  let totalCount = 0
  const managers: Record<string, string> = {}
  const allSeasons: string[] = []
  const allWaiverAdds: WaiverTransaction[] = []
  const allWaiverDrops: WaiverTransaction[] = []
  
  // Track league-wide waiver activity for MVP calculation
  const leagueWaiverMoves: Map<string, { 
    playerName: string; 
    position: string; 
    team: string;
    events: WaiverMVPEvent[] 
  }> = new Map()
  
  for (const league of leagueHistory) {
    const season = league.season
    allSeasons.push(season)
    console.log(`[TRADE-HISTORY] Fetching trades for season ${season} (league ${league.league_id})...`)
    // Pass the resolved Sleeper user_id for consistent matching
    const { trades: seasonTrades, managerMap, waiverAdds, waiverDrops, leagueMoves } = await fetchSeasonTrades(league.league_id, sleeperUserId, season, allPlayers)
    
    console.log(`[TRADE-HISTORY] Season ${season}: Found ${seasonTrades.length} trades (user trades: ${seasonTrades.filter(t => t.userInvolved).length}), ${waiverAdds.length} adds, ${waiverDrops.length} drops`)
    
    // Merge manager maps
    Object.assign(managers, managerMap)
    
    // Always include the season (even if empty) so UI knows it exists
    tradesByYear[season] = seasonTrades
    totalCount += seasonTrades.length
    
    // Collect waiver activity
    allWaiverAdds.push(...waiverAdds)
    allWaiverDrops.push(...waiverDrops)
    
    // Merge league-wide moves for MVP calculation
    for (const [playerId, moveData] of leagueMoves.entries()) {
      const existing = leagueWaiverMoves.get(playerId)
      if (existing) {
        existing.events.push(...moveData.events)
      } else {
        leagueWaiverMoves.set(playerId, { ...moveData })
      }
    }
  }
  
  const waiverActivity: WaiverActivity = {
    adds: allWaiverAdds.sort((a, b) => b.timestamp - a.timestamp),
    drops: allWaiverDrops.sort((a, b) => b.timestamp - a.timestamp),
    totalAdds: allWaiverAdds.length,
    totalDrops: allWaiverDrops.length
  }
  
  // Find the waiver MVP (most added player)
  let waiverMVP: WaiverMVP | null = null
  let maxAdds = 0
  
  for (const [playerId, data] of leagueWaiverMoves.entries()) {
    const adds = data.events.filter(e => e.type === 'add').length
    if (adds > maxAdds) {
      maxAdds = adds
      const drops = data.events.filter(e => e.type === 'drop').length
      waiverMVP = {
        playerId,
        playerName: data.playerName,
        position: data.position,
        team: data.team,
        timesAdded: adds,
        timesDropped: drops,
        totalMoves: data.events.length,
        journey: data.events.sort((a, b) => a.timestamp - b.timestamp)
      }
    }
  }
  
  return { tradesByYear, totalCount, managers, allSeasons, waiverActivity, waiverMVP }
}

async function fetchSeasonTrades(
  leagueId: string, 
  userId: string, 
  season: string,
  allPlayers: Record<string, any>
): Promise<{ 
  trades: ProcessedTrade[]; 
  managerMap: Record<string, string>; 
  waiverAdds: WaiverTransaction[]; 
  waiverDrops: WaiverTransaction[];
  leagueMoves: Map<string, { playerName: string; position: string; team: string; events: WaiverMVPEvent[] }>;
}> {
  const [rosters, users] = await Promise.all([
    getLeagueRosters(leagueId),
    getLeagueUsers(leagueId),
  ])

  const rosterToUser = new Map<number, string>()
  const userIdToName = new Map<string, string>()
  const rosterIdToName = new Map<number, string>()
  const managerMap: Record<string, string> = {}
  
  rosters.forEach(r => rosterToUser.set(r.roster_id, r.owner_id))
  users.forEach(u => {
    userIdToName.set(u.user_id, u.display_name || u.user_id)
    // Build manager map: userId -> displayName
    managerMap[u.user_id] = u.display_name || u.user_id
  })

  // Build rosterId to team name map
  rosters.forEach(r => {
    const ownerId = r.owner_id
    const ownerName = userIdToName.get(ownerId) || `Team ${r.roster_id}`
    rosterIdToName.set(r.roster_id, ownerName)
  })

  // userId should now be a resolved Sleeper user_id (numeric string)
  // But we also support matching by display_name/username as fallback
  // First try direct roster match by owner_id (most reliable for historical seasons)
  let userRosterId = rosters.find(r => r.owner_id === userId)?.roster_id
  
  // Check co_owners if no direct match
  if (!userRosterId) {
    userRosterId = rosters.find(r => (r as any).co_owners?.includes(userId))?.roster_id
  }
  
  // If no direct match, try matching through users list
  if (!userRosterId) {
    const matchedUser = users.find(u => 
      u.user_id === userId || 
      u.display_name?.toLowerCase() === userId.toLowerCase() ||
      (u as any).username?.toLowerCase() === userId.toLowerCase()
    )
    if (matchedUser) {
      userRosterId = rosters.find(r => 
        r.owner_id === matchedUser.user_id || 
        (r as any).co_owners?.includes(matchedUser.user_id)
      )?.roster_id
    }
  }
    
  console.log(`[TRADE-HISTORY] Season ${season}: Looking for user "${userId}" in ${rosters.length} rosters. Found rosterId: ${userRosterId || 'NONE'}`)

  const allTrades: ProcessedTrade[] = []
  const waiverAdds: WaiverTransaction[] = []
  const waiverDrops: WaiverTransaction[] = []
  const leagueMoves: Map<string, { playerName: string; position: string; team: string; events: WaiverMVPEvent[] }> = new Map()

  // Include all possible weeks for transactions:
  // Week 0: Offseason/preseason trades
  // Weeks 1-18: Regular season
  // Weeks 19+: Playoff and late-season
  for (let week = 0; week <= 21; week++) {
    const transactions = await getLeagueTransactions(leagueId, week)
    const trades = transactions.filter(t => t.type === 'trade' && t.status === 'complete')
    
    // Process ALL waiver/free agent transactions for league-wide MVP tracking
    const allWaiverTxns = transactions.filter(t => 
      (t.type === 'waiver' || t.type === 'free_agent') && 
      t.status === 'complete'
    )
    
    for (const txn of allWaiverTxns) {
      const timestamp = txn.created || txn.status_updated || Date.now()
      const dateStr = new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      
      // Process adds (league-wide tracking + user-specific)
      if (txn.adds) {
        for (const [playerId, toRosterId] of Object.entries(txn.adds)) {
          const player = allPlayers[playerId]
          const playerName = player?.full_name || `${player?.first_name || ''} ${player?.last_name || ''}`.trim() || playerId
          const position = player?.position || 'Unknown'
          const team = player?.team || 'FA'
          const teamName = rosterIdToName.get(toRosterId as number) || `Team ${toRosterId}`
          
          // Track for league-wide MVP
          if (!leagueMoves.has(playerId)) {
            leagueMoves.set(playerId, { playerName, position, team, events: [] })
          }
          leagueMoves.get(playerId)!.events.push({
            type: 'add',
            teamName,
            timestamp,
            date: dateStr
          })
          
          // Track user-specific adds
          if (toRosterId === userRosterId) {
            waiverAdds.push({
              playerId,
              playerName,
              position,
              team,
              type: 'add',
              timestamp,
              week,
              season
            })
          }
        }
      }
      
      // Process drops (league-wide tracking + user-specific)
      if (txn.drops) {
        for (const [playerId, fromRosterId] of Object.entries(txn.drops)) {
          const player = allPlayers[playerId]
          const playerName = player?.full_name || `${player?.first_name || ''} ${player?.last_name || ''}`.trim() || playerId
          const position = player?.position || 'Unknown'
          const team = player?.team || 'FA'
          const teamName = rosterIdToName.get(fromRosterId as number) || `Team ${fromRosterId}`
          
          // Track for league-wide MVP
          if (!leagueMoves.has(playerId)) {
            leagueMoves.set(playerId, { playerName, position, team, events: [] })
          }
          leagueMoves.get(playerId)!.events.push({
            type: 'drop',
            teamName,
            timestamp,
            date: dateStr
          })
          
          // Track user-specific drops
          if (fromRosterId === userRosterId) {
            waiverDrops.push({
              playerId,
              playerName,
              position,
              team,
              type: 'drop',
              timestamp,
              week,
              season
            })
          }
        }
      }
    }

    for (const trade of trades) {
      const parties: TradeParty[] = []

      for (const rosterId of trade.roster_ids) {
        const ownerId = rosterToUser.get(rosterId) || ''
        const displayName = userIdToName.get(ownerId) || `Team ${rosterId}`

        const playersReceived: TradeParty['playersReceived'] = []
        const picksReceived: TradeParty['picksReceived'] = []
        let faabReceived = 0

        if (trade.adds) {
          for (const [playerId, toRosterId] of Object.entries(trade.adds)) {
            if (toRosterId === rosterId) {
              const player = allPlayers[playerId]
              playersReceived.push({
                id: playerId,
                name: player?.full_name || `${player?.first_name || ''} ${player?.last_name || ''}`.trim() || playerId,
                position: player?.position || 'Unknown',
                team: player?.team || 'FA',
              })
            }
          }
        }

        if (trade.draft_picks) {
          for (const pick of trade.draft_picks) {
            if (pick.owner_id === rosterId) {
              picksReceived.push({ season: pick.season, round: pick.round })
            }
          }
        }

        if (trade.waiver_budget) {
          for (const budget of trade.waiver_budget) {
            if (budget.receiver === rosterId) {
              faabReceived += budget.amount
            }
          }
        }

        parties.push({
          rosterId,
          userId: ownerId,
          displayName,
          playersReceived,
          picksReceived,
          faabReceived,
        })
      }

      const userInvolved = userRosterId ? trade.roster_ids.includes(userRosterId) : false
      const userParty = parties.find(p => p.rosterId === userRosterId)

      allTrades.push({
        transactionId: trade.transaction_id,
        timestamp: trade.created,
        week,
        season,
        parties,
        userInvolved,
        userSide: userParty ? (userParty.playersReceived.length > 0 || userParty.picksReceived.length > 0 ? 'received' : 'gave') : null,
        userRosterId: userRosterId,
      })
    }
  }

  return { trades: allTrades.sort((a, b) => b.timestamp - a.timestamp), managerMap, waiverAdds, waiverDrops, leagueMoves }
}

async function gradeTrade(trade: ProcessedTrade) {
  // Convert trade timestamp to ISO date for historical lookup
  const tradeDate = new Date(trade.timestamp).toISOString().split('T')[0]
  
  console.log(`[GRADE] Trade date: ${tradeDate}, using hybrid valuation (Excel -> FantasyCalc fallback)`)

  // Create valuation context for the trade date
  const ctx: ValuationContext = {
    asOfDate: tradeDate,
    isSuperFlex: true
  }

  let sideAValue = 0
  let sideBValue = 0
  const sideAAssets: string[] = []
  const sideBAssets: string[] = []
  const valuationSources: string[] = []

  // Find the user's party to correctly attribute wins/losses
  if (trade.parties.length >= 2) {
    const [partyA, partyB] = trade.parties

    // Price all players in parallel
    const allPlayers = [
      ...partyA.playersReceived.map(p => ({ party: 'A', player: p })),
      ...partyB.playersReceived.map(p => ({ party: 'B', player: p }))
    ]
    const allPicks = [
      ...partyA.picksReceived.map(p => ({ party: 'A', pick: p })),
      ...partyB.picksReceived.map(p => ({ party: 'B', pick: p }))
    ]
    
    const [playerPrices, pickPrices] = await Promise.all([
      Promise.all(allPlayers.map(({ player }) => pricePlayer(player.name, ctx))),
      Promise.all(allPicks.map(({ pick }) => pricePick({ year: parseInt(pick.season) || 2025, round: pick.round, tier: 'mid' }, ctx)))
    ])

    // Process player values
    for (let i = 0; i < allPlayers.length; i++) {
      const { party, player } = allPlayers[i]
      const priced = playerPrices[i]
      valuationSources.push(priced.source)
      console.log(`[GRADE] ${player.name} value: ${priced.value} (source: ${priced.source})`)
      
      if (party === 'A') {
        sideAValue += priced.value
        sideAAssets.push(`${player.name} (${player.position})`)
      } else {
        sideBValue += priced.value
        sideBAssets.push(`${player.name} (${player.position})`)
      }
    }

    // Process pick values
    for (let i = 0; i < allPicks.length; i++) {
      const { party, pick } = allPicks[i]
      const priced = pickPrices[i]
      valuationSources.push(priced.source)
      console.log(`[GRADE] ${pick.season} Rd ${pick.round} value: ${priced.value} (source: ${priced.source})`)
      
      if (party === 'A') {
        sideAValue += priced.value
        sideAAssets.push(`${pick.season} Round ${pick.round}`)
      } else {
        sideBValue += priced.value
        sideBAssets.push(`${pick.season} Round ${pick.round}`)
      }
    }
  }
  
  // Log valuation sources summary
  const excelCount = valuationSources.filter(s => s === 'excel').length
  const fcCount = valuationSources.filter(s => s === 'fantasycalc').length
  const curveCount = valuationSources.filter(s => s === 'curve').length
  console.log(`[GRADE] Valuation sources: excel=${excelCount}, fantasycalc=${fcCount}, curve=${curveCount}`)

  const diff = sideAValue - sideBValue
  const total = sideAValue + sideBValue
  const percentDiff = total > 0 ? Math.abs(diff) / total * 100 : 0

  // Determine winner based on value difference (Side A vs Side B)
  const sideAName = trade.parties[0]?.displayName || 'Side A'
  const sideBName = trade.parties[1]?.displayName || 'Side B'
  
  let winner: string = 'Even'
  if (percentDiff >= 5) {
    winner = diff > 0 ? sideAName : sideBName
  }
  
  console.log(`[GRADE] Result: ${sideAName}=${sideAValue} vs ${sideBName}=${sideBValue} | Winner: ${winner} | Diff: ${percentDiff.toFixed(1)}%`)

  // Grade reflects FAIRNESS of the trade (A = fair, D = lopsided)
  let grade = 'C'
  if (percentDiff < 5) {
    grade = 'A'
  } else if (percentDiff < 10) {
    grade = 'B+'
  } else if (percentDiff < 15) {
    grade = 'B'
  } else if (percentDiff < 25) {
    grade = 'C+'
  } else if (percentDiff < 35) {
    grade = 'C'
  } else {
    grade = 'D'
  }

  const prompt = `Grade this fantasy trade briefly:
${sideAName} received: ${sideAAssets.join(', ') || 'Nothing'}
${sideBName} received: ${sideBAssets.join(', ') || 'Nothing'}
Value difference: ${Math.abs(diff).toFixed(0)} points (${percentDiff.toFixed(1)}%)
${winner === 'Even' ? 'Trade is balanced' : `${winner} got the better side`}

Provide:
1. A 10-word brief explanation
2. A 2-3 sentence full analysis

Format as JSON: { "brief": "...", "full": "..." }`

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.5,
    })

    const content = response.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(content.replace(/```json?|```/g, '').trim())

    return {
      ...trade,
      grade,
      briefExplanation: parsed.brief || 'Trade analysis complete',
      fullAnalysis: parsed.full || 'Unable to generate detailed analysis.',
      winner,
      valueDifferential: diff,
    }
  } catch {
    return {
      ...trade,
      grade,
      briefExplanation: percentDiff < 10 ? 'Fair and balanced trade' : `${winner} got the better value`,
      fullAnalysis: `Value differential of ${Math.abs(diff).toFixed(0)} points (${percentDiff.toFixed(1)}%). ${winner === 'Even' ? 'Both sides received comparable value.' : `${winner} came out ahead in this trade.`}`,
      winner,
      valueDifferential: diff,
    }
  }
}
