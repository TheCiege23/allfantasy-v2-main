import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { getPlayerValuesForNames, FantasyCalcSettings } from '@/lib/player-valuations/canonicalPlayerValuations'
import { requireAuthOrOrigin, forbiddenResponse } from '@/lib/api-auth'
import { getAllPlayers, getLeagueInfo, getLeagueRosters, getLeagueTransactions, getLeagueUsers } from '@/lib/sleeper-client'
import { assertSleeperBoundaryForLeagueId } from '@/lib/legacy/sleeper-boundary'

function formatPlayerValues(values: Record<string, any>): string {
  const lines: string[] = []
  for (const [name, val] of Object.entries(values)) {
    if (val && typeof val === 'object') {
      lines.push(`- ${name}: Value ${val.value || 'N/A'} (${val.position || 'UNK'})`)
    }
  }
  return lines.length > 0 ? lines.join('\n') : 'No value data available'
}

interface SleeperRoster {
  roster_id: number
  owner_id: string | null
  players?: string[] | null
  starters?: string[] | null
  settings?: { wins?: number; losses?: number }
}

interface SleeperUser {
  user_id: string
  display_name?: string
  username?: string
}

interface SleeperTransaction {
  type: string
  status: string
  roster_ids: number[]
  adds?: Record<string, number> | null
  drops?: Record<string, number> | null
  draft_picks?: any[]
  created?: number
}

async function fetchSleeperData(leagueId: string) {
  const [league, rosters, users, players] = await Promise.all([
    getLeagueInfo(leagueId),
    getLeagueRosters(leagueId),
    getLeagueUsers(leagueId),
    getAllPlayers(),
  ])
  
  return { league, rosters, users, players }
}

async function fetchTradeHistory(leagueId: string): Promise<SleeperTransaction[]> {
  const transactions: SleeperTransaction[] = []
  
  for (let week = 1; week <= 18; week++) {
    try {
      const weekTx = await getLeagueTransactions(leagueId, week)
      if (Array.isArray(weekTx)) {
        transactions.push(...weekTx.filter((t: any) => t.type === 'trade' && t.status === 'complete'))
      }
    } catch {
      break
    }
  }
  
  return transactions
}

function getManagerName(roster: SleeperRoster, users: SleeperUser[]): string {
  const user = users.find(u => u.user_id === roster.owner_id)
  return user?.display_name || user?.username || `Team ${roster.roster_id}`
}

function getPlayerName(playerId: string, players: Record<string, any>): string {
  const player = players[playerId]
  if (!player) return playerId
  return player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim() || playerId
}

function getPlayerPosition(playerId: string, players: Record<string, any>): string {
  return players[playerId]?.position || 'UNKNOWN'
}

function getPlayerTeam(playerId: string, players: Record<string, any>): string {
  return players[playerId]?.team || ''
}

function analyzeRosterNeeds(roster: SleeperRoster, players: Record<string, any>, leagueSettings: any) {
  const posCount: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 }
  const rosterPlayers: Array<{ id: string; name: string; pos: string; team: string }> = []
  
  for (const playerId of roster.players || []) {
    const pos = getPlayerPosition(playerId, players)
    const name = getPlayerName(playerId, players)
    const team = getPlayerTeam(playerId, players)
    if (posCount[pos] !== undefined) posCount[pos]++
    rosterPlayers.push({ id: playerId, name, pos, team })
  }
  
  const needs: string[] = []
  const surplus: string[] = []
  
  const rosterPositions = leagueSettings?.roster_positions || []
  const qbSlots = rosterPositions.filter((p: string) => p === 'QB' || p === 'SUPER_FLEX').length
  const rbSlots = rosterPositions.filter((p: string) => p === 'RB' || p === 'FLEX' || p === 'SUPER_FLEX').length
  const wrSlots = rosterPositions.filter((p: string) => p === 'WR' || p === 'FLEX' || p === 'SUPER_FLEX').length
  const teSlots = rosterPositions.filter((p: string) => p === 'TE' || p === 'FLEX' || p === 'SUPER_FLEX').length
  
  if (posCount.QB < qbSlots) needs.push('QB')
  else if (posCount.QB > qbSlots + 2) surplus.push('QB')
  
  if (posCount.RB < rbSlots) needs.push('RB')
  else if (posCount.RB > rbSlots + 3) surplus.push('RB')
  
  if (posCount.WR < wrSlots) needs.push('WR')
  else if (posCount.WR > wrSlots + 3) surplus.push('WR')
  
  if (posCount.TE < teSlots) needs.push('TE')
  else if (posCount.TE > teSlots + 2) surplus.push('TE')
  
  return { needs, surplus, posCount, rosterPlayers }
}

function getPickValue(round: number, season: string): number {
  const currentYear = new Date().getFullYear()
  const pickYear = parseInt(season) || currentYear
  const yearDiff = pickYear - currentYear
  
  const baseValues: Record<number, number> = {
    1: 7000,
    2: 3500,
    3: 1500,
    4: 500,
    5: 200,
  }
  
  let value = baseValues[round] || 100
  
  if (yearDiff > 0) {
    value = Math.round(value * Math.pow(0.85, yearDiff))
  } else if (yearDiff < 0) {
    value = Math.round(value * 0.5)
  }
  
  return value
}

function calculateAcceptanceProbability(
  targetNeeds: string[],
  targetSurplus: string[],
  userSending: Array<{ pos: string }>,
  userReceiving: Array<{ pos: string }>,
  targetTradeCount: number,
  valueBalance: number
): number {
  let probability = 50
  
  const sendingPos = userSending.map(p => p.pos)
  const receivingPos = userReceiving.map(p => p.pos)
  
  for (const pos of sendingPos) {
    if (targetNeeds.includes(pos)) probability += 15
    if (targetSurplus.includes(pos)) probability -= 10
  }
  
  for (const pos of receivingPos) {
    if (targetSurplus.includes(pos)) probability += 10
    if (targetNeeds.includes(pos)) probability -= 15
  }
  
  if (valueBalance > 500) probability += 10
  else if (valueBalance > 200) probability += 5
  else if (valueBalance < -500) probability -= 15
  else if (valueBalance < -200) probability -= 8
  
  if (targetTradeCount > 5) probability += 10
  else if (targetTradeCount > 2) probability += 5
  else if (targetTradeCount === 0) probability -= 15
  
  return Math.max(5, Math.min(95, probability))
}

export const POST = withApiUsage({ endpoint: "/api/legacy/trade-ideas", tool: "LegacyTradeIdeas" })(async (req: NextRequest) => {
  try {
    const auth = requireAuthOrOrigin(req)
    if (!auth.authenticated) {
      return forbiddenResponse(auth.error || 'Unauthorized')
    }

    const body = await req.json()
    const { leagueId, username, goals, depth, count = 5 } = body
    const normalizedLeagueId = String(leagueId || '').trim()
    
    if (!normalizedLeagueId || !username) {
      return NextResponse.json({ error: 'leagueId and username are required' }, { status: 400 })
    }

    const boundary = await assertSleeperBoundaryForLeagueId(normalizedLeagueId)
    if (!boundary.ok) {
      return NextResponse.json({ error: boundary.message }, { status: boundary.status })
    }
    
    const [sleeperData, tradeHistory] = await Promise.all([
      fetchSleeperData(normalizedLeagueId),
      fetchTradeHistory(normalizedLeagueId)
    ])
    
    const { league, rosters, users, players } = sleeperData
    
    if (!league || !users || !rosters || !Array.isArray(users) || !Array.isArray(rosters)) {
      return NextResponse.json({ error: 'Invalid league ID or league data unavailable' }, { status: 400 })
    }
    
    const userRoster = rosters.find(r => {
      const user = users.find(u => u.user_id === r.owner_id)
      return user?.username?.toLowerCase() === username.toLowerCase() ||
             user?.display_name?.toLowerCase() === username.toLowerCase()
    })
    
    if (!userRoster) {
      return NextResponse.json({ error: 'User roster not found in this league' }, { status: 404 })
    }
    
    const userAnalysis = analyzeRosterNeeds(userRoster, players, league)
    const userManagerName = getManagerName(userRoster, users)
    const userRecord = `${userRoster.settings?.wins || 0}-${userRoster.settings?.losses || 0}`
    
    // Check if rosters have actual player data
    const totalPlayers = rosters.reduce((sum, r) => sum + (r.players?.length || 0), 0)
    if (totalPlayers === 0) {
      return NextResponse.json({ 
        ideas: [],
        error: 'This league has no roster data yet. This typically happens with BestBall leagues before the draft or during the season. Trade Finder requires roster data to generate trade ideas.',
        leagueInfo: {
          name: league?.name ?? 'Unknown league',
          type: league?.settings?.type === 2 ? 'Dynasty' : 'Redraft',
          teams: rosters.length,
          scoring: 'Unknown'
        }
      })
    }
    
    const managerTradeCount: Record<number, number> = {}
    for (const tx of tradeHistory) {
      for (const rosterId of tx.roster_ids) {
        managerTradeCount[rosterId] = (managerTradeCount[rosterId] || 0) + 1
      }
    }
    
    const otherManagers = rosters
      .filter(r => r.roster_id !== userRoster.roster_id)
      .map(r => {
        const analysis = analyzeRosterNeeds(r, players, league)
        return {
          rosterId: r.roster_id,
          name: getManagerName(r, users),
          record: `${r.settings?.wins || 0}-${r.settings?.losses || 0}`,
          needs: analysis.needs,
          surplus: analysis.surplus,
          players: analysis.rosterPlayers,
          tradeCount: managerTradeCount[r.roster_id] || 0
        }
      })
    
    const userPlayerNames = userAnalysis.rosterPlayers.map(p => p.name)
    const allOtherPlayerNames = otherManagers.flatMap(m => m.players.map(p => p.name))
    
    const qbSlotCount = (league.roster_positions || []).filter((p: string) => p === 'QB' || p === 'SUPER_FLEX').length
    const numQbs: 1 | 2 = qbSlotCount >= 2 ? 2 : 1

    const rawPpr = Number(league.scoring_settings?.rec ?? 0)
    const ppr: 0 | 0.5 | 1 = rawPpr >= 1 ? 1 : rawPpr >= 0.5 ? 0.5 : 0

    const fcSettings: FantasyCalcSettings = {
      isDynasty: league.settings?.type === 2,
      numQbs,
      numTeams: rosters.length,
      ppr,
    }
    
    const [userValuesMap, otherValuesMap] = await Promise.all([
      getPlayerValuesForNames(userPlayerNames.slice(0, 30), fcSettings).catch(() => new Map()),
      getPlayerValuesForNames(allOtherPlayerNames.slice(0, 100), fcSettings).catch(() => new Map())
    ])
    
    // Convert Maps to plain objects with lowercase keys
    const userValues: Record<string, any> = {}
    const otherValues: Record<string, any> = {}
    
    if (userValuesMap instanceof Map) {
      userValuesMap.forEach((val, key) => { userValues[key.toLowerCase()] = val })
    }
    if (otherValuesMap instanceof Map) {
      otherValuesMap.forEach((val, key) => { otherValues[key.toLowerCase()] = val })
    }
    
    const numIdeas = Math.min(Math.max(count || 5, 3), 7)
    
    const prompt = `You are an expert fantasy football trade analyst. Generate ${numIdeas} SPECIFIC trade proposals for "${userManagerName}" (${userRecord}).

YOUR ROSTER:
${userAnalysis.rosterPlayers.slice(0, 20).map(p => `- ${p.name} (${p.pos}, ${p.team || 'FA'})`).join('\n')}

YOUR ROSTER NEEDS: ${userAnalysis.needs.join(', ') || 'Balanced'}
YOUR SURPLUS: ${userAnalysis.surplus.join(', ') || 'None'}

YOUR PLAYER VALUES:
${formatPlayerValues(userValues)}

OTHER MANAGERS:
${otherManagers.map(m => `
📋 ${m.name} (${m.record}) - ${m.tradeCount} trades this season
   Needs: ${m.needs.join(', ') || 'Balanced'} | Surplus: ${m.surplus.join(', ') || 'None'}
   Key Players: ${m.players.slice(0, 8).map(p => `${p.name} (${p.pos})`).join(', ')}
`).join('\n')}

THEIR PLAYER VALUES:
${formatPlayerValues(otherValues)}

LEAGUE SETTINGS:
- Name: ${league.name}
- Type: ${league.settings?.type === 2 ? 'Dynasty' : 'Redraft'}
- Scoring: ${league.scoring_settings?.rec === 1 ? 'PPR' : league.scoring_settings?.rec === 0.5 ? 'Half PPR' : 'Standard'}
- Teams: ${rosters.length}
- Superflex: ${(league.roster_positions || []).includes('SUPER_FLEX') ? 'Yes' : 'No'}

USER'S GOALS: ${goals || 'Improve roster overall - find the best value trades'}

INSTRUCTIONS:
Generate ${numIdeas} SPECIFIC trade proposals. Each trade must include:
1. EXACT players from YOUR roster to SEND
2. EXACT players from the TARGET manager's roster to RECEIVE
3. The TARGET MANAGER's name (must be one from the list above)
4. Acceptance probability (5-95%) based on:
   - Does this fill their roster needs?
   - Are they an active trader? (check their trade count)
   - Is the value fair for them?
5. Clear explanation of WHY you should make this trade
6. Clear explanation of WHY the target manager would accept

CRITICAL: Only use players that actually exist on each roster. Do not invent players.

Return JSON:
{
  "trades": [
    {
      "targetManager": "Manager Name",
      "targetRosterId": 1,
      "send": [
        {"name": "Player Name", "position": "RB", "team": "KC"}
      ],
      "receive": [
        {"name": "Player Name", "position": "WR", "team": "CIN"}
      ],
      "acceptanceProbability": 72,
      "title": "Upgrade at WR",
      "whyForYou": "Explanation of why you should make this trade",
      "whyTheyAccept": "Explanation of why the other manager would accept based on their needs and trading history",
      "valueAnalysis": "Brief comparison of trade values",
      "urgency": "high"
    }
  ]
}`

    const completion = await openaiChatJson({
      messages: [
        { role: 'system', content: 'You are an expert fantasy football trade analyst. Generate specific, realistic trade proposals using ONLY players that exist on the rosters provided. Never invent players.' },
        { role: 'user', content: prompt }
      ],
      maxTokens: depth === 'deep' ? 4000 : 2500,
      temperature: 0.8
    })
    
    if (!completion.ok) {
      return NextResponse.json({ 
        ideas: [],
        opportunities: [],
        error: 'Failed to generate trade ideas'
      })
    }
    
    const result = parseJsonContentFromChatCompletion(completion.json)
    
    if (!result?.trades || !Array.isArray(result.trades)) {
      return NextResponse.json({ 
        ideas: [],
        opportunities: [],
        error: 'Failed to parse trade ideas'
      })
    }
    
    const allValues: Record<string, any> = { ...userValues, ...otherValues }
    
    // Create a lookup from Sleeper players data for team info fallback
    const sleeperPlayerLookup: Record<string, any> = {}
    for (const [id, player] of Object.entries(players as Record<string, any>)) {
      if (player && player.full_name) {
        sleeperPlayerLookup[player.full_name.toLowerCase()] = player
      }
    }
    
    const ideas = result.trades.map((trade: any, idx: number) => {
      const targetManager = otherManagers.find(m => 
        m.name.toLowerCase() === trade.targetManager?.toLowerCase() ||
        m.rosterId === trade.targetRosterId
      )
      
      // Enrich players with FantasyCalc values
      const sendWithValues = (trade.send || []).map((p: any) => {
        const fcData = allValues[p.name?.toLowerCase()]
        const sleeperPlayer = sleeperPlayerLookup[p.name?.toLowerCase()]
        return {
          ...p,
          value: fcData?.value || 0,
          tier: fcData?.tier ?? null,
          team: fcData?.team || sleeperPlayer?.team || p.team || ''
        }
      })
      
      const receiveWithValues = (trade.receive || []).map((p: any) => {
        const fcData = allValues[p.name?.toLowerCase()]
        const sleeperPlayer = sleeperPlayerLookup[p.name?.toLowerCase()]
        return {
          ...p,
          value: fcData?.value || 0,
          tier: fcData?.tier ?? null,
          team: fcData?.team || sleeperPlayer?.team || p.team || ''
        }
      })
      
      // Handle picks if included
      const picksToSend = (trade.picksSend || []).map((pick: any) => ({
        season: pick.season || pick.year,
        round: pick.round,
        value: getPickValue(pick.round, pick.season || pick.year || '2025')
      }))
      
      const picksToReceive = (trade.picksReceive || []).map((pick: any) => ({
        season: pick.season || pick.year,
        round: pick.round,
        value: getPickValue(pick.round, pick.season || pick.year || '2025')
      }))
      
      // Handle FAAB if included
      const faabSend = trade.faabSend || 0
      const faabReceive = trade.faabReceive || 0
      
      // Calculate total values for each side
      const sendPlayerValue = sendWithValues.reduce((sum: number, p: any) => sum + (p.value || 0), 0)
      const sendPickValue = picksToSend.reduce((sum: number, p: any) => sum + (p.value || 0), 0)
      const totalSendValue = sendPlayerValue + sendPickValue + faabSend
      
      const receivePlayerValue = receiveWithValues.reduce((sum: number, p: any) => sum + (p.value || 0), 0)
      const receivePickValue = picksToReceive.reduce((sum: number, p: any) => sum + (p.value || 0), 0)
      const totalReceiveValue = receivePlayerValue + receivePickValue + faabReceive
      
      // Calculate fairness
      const maxValue = Math.max(totalSendValue, totalReceiveValue, 1)
      const valueDiff = totalReceiveValue - totalSendValue
      const percentDiff = Math.abs(valueDiff) / maxValue * 100
      const fairnessScore = Math.max(0, 100 - percentDiff)
      
      let calculatedProbability = trade.acceptanceProbability || 50
      if (targetManager) {
        const sendingPlayers = sendWithValues.map((p: any) => ({ pos: p.position }))
        const receivingPlayers = receiveWithValues.map((p: any) => ({ pos: p.position }))
        
        calculatedProbability = calculateAcceptanceProbability(
          targetManager.needs,
          targetManager.surplus,
          sendingPlayers,
          receivingPlayers,
          targetManager.tradeCount,
          valueDiff
        )
      }
      
      return {
        id: idx + 1,
        title: trade.title || `Trade with ${trade.targetManager}`,
        targetManager: trade.targetManager,
        targetRosterId: trade.targetRosterId,
        targetRecord: targetManager?.record || '',
        targetTradeCount: targetManager?.tradeCount || 0,
        send: sendWithValues,
        receive: receiveWithValues,
        picksSend: picksToSend,
        picksReceive: picksToReceive,
        faabSend,
        faabReceive,
        totalSendValue,
        totalReceiveValue,
        valueDiff,
        fairnessScore: Math.round(fairnessScore),
        percentDiff: Math.round(percentDiff),
        acceptanceProbability: calculatedProbability,
        whyForYou: trade.whyForYou || trade.whyForUser,
        whyTheyAccept: trade.whyTheyAccept || trade.whyForTarget,
        valueAnalysis: trade.valueAnalysis,
        urgency: trade.urgency || 'medium',
        icon: calculatedProbability >= 70 ? '🔥' : calculatedProbability >= 50 ? '💡' : '🎯'
      }
    })
    // Filter out trades that are bad for the user
    .filter((idea: any) => {
      // Filter trades where user gives up significantly more value (>15% loss)
      if (idea.valueDiff < 0 && idea.percentDiff > 15) {
        console.log(`Filtered trade (user loses value): ${idea.title} - ${idea.valueDiff} value loss (Send: ${idea.totalSendValue}, Receive: ${idea.totalReceiveValue})`)
        return false
      }
      // Filter trades that are too lopsided in either direction (>30% difference)
      if (idea.percentDiff > 30) {
        console.log(`Filtered trade (too lopsided): ${idea.title} - ${idea.percentDiff}% difference`)
        return false
      }
      return true
    })
    
    ideas.sort((a: any, b: any) => b.acceptanceProbability - a.acceptanceProbability)
    
    const opportunities: any[] = []
    
    for (const mgr of otherManagers) {
      if (opportunities.filter(o => o.type === 'NEED_FIT').length >= 2) break
      const matchPos = mgr.needs.filter((n: string) => userAnalysis.surplus.includes(n))
      if (matchPos.length === 0) continue
      const relevantPlayers: any[] = []
      for (const pos of matchPos) {
        const userPlayersAtPos = userAnalysis.rosterPlayers
          .filter(p => p.pos === pos)
          .slice(0, 1)
        for (const p of userPlayersAtPos) {
          const fcData = allValues[p.name.toLowerCase()]
          relevantPlayers.push({
            name: p.name, position: pos, value: fcData?.value || 0,
            reason: `${mgr.name} needs ${pos} — your depth could fill their gap`
          })
        }
      }
      if (relevantPlayers.length > 0) {
        opportunities.push({
          type: 'NEED_FIT', title: 'Need-Fit Deal', icon: '🎯',
          description: `${mgr.name} needs ${matchPos.join('/')} and you have surplus depth.`,
          targetManager: mgr.name,
          relevantPlayers: relevantPlayers.slice(0, 3),
          confidence: Math.min(70, 35 + matchPos.length * 15),
          actionable: true
        })
      }
    }

    const consolidationTargets: any[] = []
    for (const mgr of otherManagers) {
      const elites = mgr.players
        .filter((p: any) => {
          const fc = allValues[p.name.toLowerCase()]
          return fc && fc.value >= 5000
        })
        .slice(0, 2)
      for (const elite of elites) {
        const fc = allValues[elite.name.toLowerCase()]
        consolidationTargets.push({
          name: elite.name, position: elite.pos, value: fc?.value || 0,
          reason: `Bundle your depth pieces to trade up to this star from ${mgr.name}`
        })
      }
    }
    if (consolidationTargets.length > 0) {
      opportunities.push({
        type: 'CONSOLIDATION', title: 'Consolidation Offers', icon: '📦',
        description: 'No clean 1-for-1 matches, but you have depth to bundle for a star upgrade.',
        relevantPlayers: consolidationTargets.slice(0, 3),
        confidence: Math.min(55, 25 + consolidationTargets.length * 10),
        actionable: true
      })
    }

    const activeTradingManagers = otherManagers.filter(m => m.tradeCount >= 3)
    if (activeTradingManagers.length > 0) {
      const volatilePlayers: any[] = []
      for (const mgr of activeTradingManagers.slice(0, 3)) {
        for (const p of mgr.players.slice(0, 3)) {
          const fc = allValues[p.name.toLowerCase()]
          if (fc && fc.value >= 2000) {
            volatilePlayers.push({
              name: p.name, position: p.pos, value: fc.value,
              reason: `${mgr.name} has ${mgr.tradeCount} trades this season — they're open to dealing`
            })
          }
        }
      }
      if (volatilePlayers.length > 0) {
        opportunities.push({
          type: 'VOLATILITY_SWAP', title: 'Volatility Swaps', icon: '🎰',
          description: 'These active traders may accept creative offers.',
          relevantPlayers: volatilePlayers.slice(0, 3),
          confidence: Math.min(50, 20 + volatilePlayers.length * 10),
          actionable: true
        })
      }
    }

    const monitorPlayers: any[] = []
    for (const mgr of otherManagers) {
      for (const p of mgr.players) {
        const fc = allValues[p.name.toLowerCase()]
        if (!fc || fc.value < 2000) continue
        if (userAnalysis.needs.includes(p.pos)) {
          monitorPlayers.push({
            name: p.name, position: p.pos, value: fc.value,
            reason: `Fills your ${p.pos} need — watch for their value to shift`
          })
        }
      }
    }
    const seenNames = new Set<string>()
    const uniqueMonitor = monitorPlayers.filter(p => {
      if (seenNames.has(p.name)) return false
      seenNames.add(p.name)
      return true
    }).sort((a: any, b: any) => b.value - a.value).slice(0, 3)

    if (uniqueMonitor.length > 0) {
      opportunities.push({
        type: 'MONITOR', title: 'Watch & Wait', icon: '👀',
        description: 'Keep these players on your radar for future opportunities.',
        relevantPlayers: uniqueMonitor,
        confidence: 30,
        actionable: false
      })
    }

    if (!opportunities.some(o => o.type === 'MONITOR')) {
      const fallbackPlayers = userAnalysis.needs.slice(0, 3).map(pos => ({
        name: `Best available ${pos}`, position: pos, value: 0,
        reason: `You need ${pos} — monitor the market for value shifts`
      }))
      opportunities.push({
        type: 'MONITOR', title: 'Watch & Wait', icon: '👀',
        description: 'No clear moves right now. Keep watching the market for value shifts.',
        relevantPlayers: fallbackPlayers.length > 0 ? fallbackPlayers : [{ name: 'League landscape', position: 'ALL', value: 0, reason: 'Monitor for injured starters or bye-week fire sales' }],
        confidence: 20,
        actionable: false
      })
    }

    return NextResponse.json({ 
      ideas,
      opportunities,
      leagueInfo: {
        name: league.name,
        type: league.settings?.type === 2 ? 'Dynasty' : 'Redraft',
        teams: rosters.length,
        scoring: league.scoring_settings?.rec === 1 ? 'PPR' : league.scoring_settings?.rec === 0.5 ? 'Half PPR' : 'Standard'
      },
      userInfo: {
        name: userManagerName,
        record: userRecord,
        needs: userAnalysis.needs,
        surplus: userAnalysis.surplus
      }
    })
    
  } catch (error: any) {
    console.error('Trade ideas error:', error)
    return NextResponse.json({ error: error.message || 'Failed to generate trade ideas' }, { status: 500 })
  }
})
