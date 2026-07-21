import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { computeDualModeTradeDelta, UserTrade, ValuationMode } from '@/lib/hybrid-valuation'
import { computeReportCard } from '@/lib/trade-engine/report-card-engine'
import { isUserParty } from '@/lib/user-matching'
import { logUserEventByUsername } from '@/lib/user-events'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

interface TradeAnalyticsRequest {
  league_id: string
  sleeper_username: string
  sleeper_user_id?: string
  mode?: ValuationMode
  trades: Array<{
    transactionId: string
    timestamp: number
    week: number
    parties: Array<{
      userId: string
      teamName?: string
      playersReceived: Array<{ name: string; position?: string }>
      picksReceived: Array<{ round: number; season: string; slot?: string }>
    }>
    grade?: string
    verdict?: string
  }>
  managers?: Record<string, string>
  league?: { qb_format?: string }
}

function adaptTradeForDualMode(
  trade: TradeAnalyticsRequest['trades'][0],
  sleeperUsername: string,
  sleeperUserId?: string
): {
  date: string;
  sideAPlayers: string[];
  sideBPlayers: string[];
  sideAPicks: { year: number; round: number; tier?: 'early' | 'mid' | 'late' }[];
  sideBPicks: { year: number; round: number; tier?: 'early' | 'mid' | 'late' }[];
} | null {
  const userParty = trade.parties?.find(p => isUserParty(p, sleeperUsername, sleeperUserId))
  const otherParty = trade.parties?.find(p => !isUserParty(p, sleeperUsername, sleeperUserId))
  
  if (!userParty || !otherParty) return null
  
  const tradeDate = trade.timestamp
    ? new Date(trade.timestamp).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  
  const parsePick = (pick: { round: number; season: string; slot?: string }) => {
    const year = parseInt(pick.season) || new Date().getFullYear()
    const tier = pick.slot === 'early' || pick.slot === 'mid' || pick.slot === 'late' 
      ? pick.slot as 'early' | 'mid' | 'late' 
      : undefined
    return { year, round: pick.round, tier }
  }
  
  const userReceived = userParty.playersReceived?.map(p => p.name) || []
  const userReceivedPicks = userParty.picksReceived?.map(parsePick) || []
  const otherReceived = otherParty.playersReceived?.map(p => p.name) || []
  const otherReceivedPicks = otherParty.picksReceived?.map(parsePick) || []
  
  return {
    date: tradeDate,
    sideAPlayers: userReceived,
    sideBPlayers: otherReceived,
    sideAPicks: userReceivedPicks,
    sideBPicks: otherReceivedPicks,
  }
}

export const POST = withApiUsage({ endpoint: "/api/legacy/trade-analytics", tool: "LegacyTradeAnalytics" })(async (req: NextRequest) => {
  try {
    const body: TradeAnalyticsRequest = await req.json()
    const { league_id, sleeper_user_id, trades, managers } = body

    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: String(body.sleeper_username || '').trim() || null,
      rateLimit: { action: 'trade_analytics', maxRequests: 15, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeper_username = gate.identity.sleeperUsername

    if (!league_id || !trades || trades.length === 0) {
      return NextResponse.json({ error: 'league_id and trades are required' }, { status: 400 })
    }

    if (sleeper_username) {
      logUserEventByUsername(sleeper_username, 'trade_analysis_started', { league_id, trade_count: trades.length })
    }

    const userTrades = trades.filter(t => 
      t.parties?.some(p => isUserParty(p, sleeper_username, sleeper_user_id))
    )
    
    console.log(`[trade-analytics] Filtering trades for user: username=${sleeper_username}, user_id=${sleeper_user_id}`)
    console.log(`[trade-analytics] Found ${userTrades.length} user trades out of ${trades.length} total`)

    let wins = 0, losses = 0, even = 0
    let totalValueGained = 0
    
    const multiStats = {
      atTime: { wins: 0, losses: 0, even: 0, netValue: 0, avgPerTrade: 0, winRate: 0 },
      hindsight: { wins: 0, losses: 0, even: 0, netValue: 0, avgPerTrade: 0, winRate: 0 },
      lineupImpact: { wins: 0, losses: 0, even: 0, netValue: 0, avgPerTrade: 0, winRate: 0 },
    }
    let partnerStats: Record<string, {
      name: string
      trades: number
      netValue: number
      grades: string[]
      positionsReceived: Record<string, number>
      positionsGiven: Record<string, number>
      picksReceived: number
      picksGiven: number
      tradeShapes: string[]
      tradeValues: number[]
    }> = {}
    let bestTrade: any = null
    let worstTrade: any = null
    let bestTradeValue = -Infinity
    let worstTradeValue = Infinity
    
    const gradeValues: Record<string, number> = {
      'A+': 95, 'A': 90, 'A-': 85,
      'B+': 80, 'B': 75, 'B-': 70,
      'C+': 65, 'C': 60, 'C-': 55,
      'D+': 50, 'D': 45, 'D-': 40,
      'F': 30
    }

    const gradeToValue = (grade: string): number => {
      const baseGrade = grade?.toUpperCase() || 'C'
      return gradeValues[baseGrade] || 60
    }

    const valueToGrade = (value: number): string => {
      if (value >= 93) return 'A+'
      if (value >= 88) return 'A'
      if (value >= 83) return 'A-'
      if (value >= 78) return 'B+'
      if (value >= 73) return 'B'
      if (value >= 68) return 'B-'
      if (value >= 63) return 'C+'
      if (value >= 58) return 'C'
      if (value >= 53) return 'C-'
      if (value >= 48) return 'D+'
      if (value >= 43) return 'D'
      if (value >= 38) return 'D-'
      return 'F'
    }

    const getTraderLabel = (grade: string): string => {
      if (['A+', 'A'].includes(grade)) return 'Elite Trader'
      if (['A-', 'B+'].includes(grade)) return 'Great Trader'
      if (['B', 'B-'].includes(grade)) return 'Above Average Trader'
      if (['C+', 'C'].includes(grade)) return 'Average Trader'
      if (['C-', 'D+'].includes(grade)) return 'Below Average Trader'
      if (['D', 'D-'].includes(grade)) return 'Poor Trader'
      return 'Struggling Trader'
    }

    const isSF = body.league?.qb_format === 'sf'
    const mode: ValuationMode = body.mode || 'atTime'
    
    const scoredTrades = await Promise.all(
      userTrades.map(async (trade) => {
        let realValue = 0
        let dualResult: Awaited<ReturnType<typeof computeDualModeTradeDelta>> | null = null
        
        const userTrade: UserTrade = {
          transactionId: trade.transactionId,
          timestamp: trade.timestamp,
          week: trade.week,
          parties: trade.parties.map(p => ({
            userId: p.userId,
            teamName: p.teamName,
            playersReceived: p.playersReceived || [],
            picksReceived: p.picksReceived || [],
          })),
          grade: trade.grade,
          verdict: trade.verdict,
        }
        
        try {
          dualResult = await computeDualModeTradeDelta(userTrade, sleeper_username, isSF, sleeper_user_id)
          const selectedMode = mode === 'hindsight' ? dualResult.withHindsight : dualResult.atTheTime
          realValue = selectedMode?.deltaValue || 0
        } catch (e) {
          console.error('Failed to compute dual mode delta:', e)
          const gradeValue = gradeToValue(trade.grade || 'C')
          realValue = (gradeValue - 60) * 100
        }
        
        return {
          ...trade,
          value: Math.round(realValue),
          _analytics: dualResult ? {
            atTheTime: dualResult.atTheTime,
            withHindsight: dualResult.withHindsight,
            comparison: dualResult.comparison,
          } : null,
        }
      })
    )
    
    const WIN_THRESHOLD = 300
    const PPG_PROXY_DIVISOR = 250
    
    for (const trade of scoredTrades) {
      const estimatedValue = trade.value
      
      if (estimatedValue > WIN_THRESHOLD) {
        wins++
        totalValueGained += estimatedValue
      } else if (estimatedValue < -WIN_THRESHOLD) {
        losses++
        totalValueGained += estimatedValue
      } else {
        even++
        totalValueGained += estimatedValue
      }

      const atTimeDelta = trade._analytics?.atTheTime?.deltaValue ?? 0
      if (atTimeDelta > WIN_THRESHOLD) multiStats.atTime.wins++
      else if (atTimeDelta < -WIN_THRESHOLD) multiStats.atTime.losses++
      else multiStats.atTime.even++
      multiStats.atTime.netValue += Math.round(atTimeDelta)

      const hindsightDelta = trade._analytics?.withHindsight?.deltaValue ?? 0
      if (hindsightDelta > WIN_THRESHOLD) multiStats.hindsight.wins++
      else if (hindsightDelta < -WIN_THRESHOLD) multiStats.hindsight.losses++
      else multiStats.hindsight.even++
      multiStats.hindsight.netValue += Math.round(hindsightDelta)

      const ppgDelta = (trade._analytics?.withHindsight?.deltaValue ?? trade._analytics?.atTheTime?.deltaValue ?? 0) / PPG_PROXY_DIVISOR
      if (ppgDelta > 0.5) multiStats.lineupImpact.wins++
      else if (ppgDelta < -0.5) multiStats.lineupImpact.losses++
      else multiStats.lineupImpact.even++
      multiStats.lineupImpact.netValue += Math.round(ppgDelta * 10) / 10

      if (estimatedValue > bestTradeValue) {
        bestTradeValue = estimatedValue
        bestTrade = trade
      }
      if (estimatedValue < worstTradeValue) {
        worstTradeValue = estimatedValue
        worstTrade = trade
      }

      const partner = trade.parties?.find(p => !isUserParty(p, sleeper_username, sleeper_user_id))
      
      if (partner) {
        const partnerId = partner.userId || partner.teamName || 'Unknown'
        const partnerName = partner.teamName || (partner as any).displayName || managers?.[partner.userId] || partner.userId || 'Unknown'
        
        if (!partnerStats[partnerId]) {
          partnerStats[partnerId] = {
            name: partnerName, trades: 0, netValue: 0, grades: [],
            positionsReceived: {}, positionsGiven: {},
            picksReceived: 0, picksGiven: 0,
            tradeShapes: [], tradeValues: [],
          }
        }
        const ps = partnerStats[partnerId]
        ps.trades++
        ps.netValue += estimatedValue
        ps.grades.push(trade.grade || 'C')
        ps.tradeValues.push(estimatedValue)

        const userParty = trade.parties?.find((p: any) => isUserParty(p, sleeper_username, sleeper_user_id))

        if (userParty) {
          for (const pl of (userParty.playersReceived || [])) {
            const pos = pl.position || 'Unknown'
            ps.positionsReceived[pos] = (ps.positionsReceived[pos] || 0) + 1
          }
          ps.picksReceived += (userParty as any).picksReceived?.length || 0
        }

        for (const pl of (partner.playersReceived || [])) {
          const pos = (pl as any).position || 'Unknown'
          ps.positionsGiven[pos] = (ps.positionsGiven[pos] || 0) + 1
        }
        ps.picksGiven += (partner as any).picksReceived?.length || 0

        const userPieces = ((userParty as any)?.playersReceived?.length || 0) + ((userParty as any)?.picksReceived?.length || 0)
        const partnerPieces = (partner.playersReceived?.length || 0) + ((partner as any).picksReceived?.length || 0)
        if (userPieces < partnerPieces) ps.tradeShapes.push('consolidation')
        else if (userPieces > partnerPieces) ps.tradeShapes.push('dispersion')
        else ps.tradeShapes.push('swap')
      }
    }

    function computeStyleMatch(ps: typeof partnerStats[string]): {
      score: number
      label: string
      insights: string[]
      drivers: string[]
      dealShapes: string[]
    } {
      const insights: string[] = []
      const drivers: string[] = []

      const topPosGiven = Object.entries(ps.positionsGiven).sort(([,a],[,b]) => b - a)
      const topPosReceived = Object.entries(ps.positionsReceived).sort(([,a],[,b]) => b - a)
      const totalGiven = topPosGiven.reduce((s,[,v]) => s + v, 0)
      const totalReceived = topPosReceived.reduce((s,[,v]) => s + v, 0)

      if (topPosGiven[0] && totalGiven > 0) {
        const pct = Math.round((topPosGiven[0][1] / totalGiven) * 100)
        if (pct >= 40) {
          insights.push(`They give away ${topPosGiven[0][0]}s frequently (${pct}% of assets sent to you)`)
          drivers.push(`${topPosGiven[0][0]} seller`)
        }
      }
      if (topPosReceived[0] && totalReceived > 0) {
        const pct = Math.round((topPosReceived[0][1] / totalReceived) * 100)
        if (pct >= 40) {
          insights.push(`They acquire ${topPosReceived[0][0]}s heavily (${pct}% of what you send them)`)
          drivers.push(`${topPosReceived[0][0]} buyer`)
        }
      }

      if (ps.picksGiven > ps.picksReceived + 1) {
        insights.push('Willing to include picks to sweeten deals')
        drivers.push('Pick seller')
      } else if (ps.picksReceived > ps.picksGiven + 1) {
        insights.push('Prefers acquiring picks — likely rebuilding')
        drivers.push('Pick hoarder')
      }

      const avgDelta = ps.netValue / (ps.trades || 1)
      if (avgDelta > 400) {
        insights.push('You consistently win trades against this partner')
        drivers.push('Overpays in your deals')
      } else if (avgDelta < -400) {
        insights.push('This partner tends to get the better end of deals')
        drivers.push('Hard negotiator')
      } else {
        insights.push('Trades with this partner tend to be fair and balanced')
        drivers.push('Fair trader')
      }

      const variance = ps.tradeValues.length > 1
        ? Math.sqrt(ps.tradeValues.reduce((s, v) => s + Math.pow(v - avgDelta, 2), 0) / ps.tradeValues.length)
        : 0
      if (variance > 1000) {
        drivers.push('Volatile — big swings')
      } else if (variance < 300 && ps.trades >= 3) {
        drivers.push('Predictable outcomes')
      }

      const consolidationPct = ps.tradeShapes.filter(s => s === 'consolidation').length / (ps.trades || 1)
      const dispersionPct = ps.tradeShapes.filter(s => s === 'dispersion').length / (ps.trades || 1)

      const shapeCounts: Record<string, number> = {}
      for (const s of ps.tradeShapes) shapeCounts[s] = (shapeCounts[s] || 0) + 1
      const topShapes = Object.entries(shapeCounts).sort(([,a],[,b]) => b - a)

      const suggestedDeals: string[] = []
      if (consolidationPct >= 0.5) {
        suggestedDeals.push('Package 2-3 pieces for their stud — they prefer consolidation trades')
      }
      if (dispersionPct >= 0.5) {
        suggestedDeals.push('Offer a star for multiple assets — they like spreading value')
      }
      if (topPosGiven[0] && topPosGiven[0][1] >= 2) {
        suggestedDeals.push(`Target their ${topPosGiven[0][0]}s — they are willing to move that position`)
      }
      if (ps.picksGiven > ps.picksReceived) {
        suggestedDeals.push('Ask for pick sweeteners — they have included picks before')
      }
      if (suggestedDeals.length === 0) {
        suggestedDeals.push('Start with a fair 1-for-1 swap at a position of need')
        suggestedDeals.push('Consider including a mid-round pick to close value gaps')
      }

      const sampleWeight = Math.min(1, ps.trades / 5)
      const styleScore = Math.round(
        (Math.min(insights.length, 4) / 4) * 100 * sampleWeight
      )

      return {
        score: Math.min(100, Math.max(10, styleScore)),
        label: styleScore >= 70 ? 'Strong Read' : styleScore >= 40 ? 'Partial Read' : 'Limited Data',
        insights,
        drivers,
        dealShapes: suggestedDeals.slice(0, 2),
      }
    }

    function computeWeightedScore(ps: typeof partnerStats[string]): number {
      const sampleFactor = Math.min(1, ps.trades / 5)
      return ps.netValue * sampleFactor
    }

    const enrichedPartners = Object.values(partnerStats)
      .map(p => ({
        ...p,
        weightedScore: computeWeightedScore(p),
        styleMatch: computeStyleMatch(p),
        avgGrade: valueToGrade(p.grades.reduce((sum, g) => sum + gradeToValue(g), 0) / p.grades.length),
        avgPerTrade: p.trades > 0 ? Math.round(p.netValue / p.trades) : 0,
        topShape: (() => {
          const sc: Record<string, number> = {}
          for (const s of p.tradeShapes) sc[s] = (sc[s] || 0) + 1
          const sorted = Object.entries(sc).sort(([,a],[,b]) => b - a)
          return sorted[0]?.[0] || 'swap'
        })(),
      }))

    const partners = enrichedPartners
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .map((p, idx) => ({ ...p, rank: idx + 1 }))

    const bestMark = partners[0]
    const nemesis = partners[partners.length - 1]

    const totalTradeCount = userTrades.length
    const winRate = totalTradeCount > 0 ? Math.round((wins / totalTradeCount) * 100) : 0
    
    for (const key of ['atTime', 'hindsight', 'lineupImpact'] as const) {
      const s = multiStats[key]
      s.avgPerTrade = totalTradeCount > 0 ? Math.round((s.netValue / totalTradeCount) * 10) / 10 : 0
      s.winRate = totalTradeCount > 0 ? Math.round((s.wins / totalTradeCount) * 100) : 0
    }
    
    const avgGradeValue = userTrades.reduce((sum, t) => sum + gradeToValue(t.grade || 'C'), 0) / (totalTradeCount || 1)
    const overallGrade = valueToGrade(avgGradeValue)
    const overallScore = Math.round(avgGradeValue)
    const traderLabel = getTraderLabel(overallGrade)

    const managerTradeCount: Record<string, number> = {}
    const managerWaiverCount: Record<string, number> = {}
    const pairTradeCount: Record<string, { team1: string; team2: string; count: number }> = {}
    
    trades.forEach(trade => {
      trade.parties?.forEach(p => {
        const name = p.teamName || managers?.[p.userId] || p.userId || 'Unknown'
        managerTradeCount[name] = (managerTradeCount[name] || 0) + 1
      })
      
      if (trade.parties?.length === 2) {
        const t1 = trade.parties[0].teamName || managers?.[trade.parties[0].userId] || 'Team1'
        const t2 = trade.parties[1].teamName || managers?.[trade.parties[1].userId] || 'Team2'
        const pairKey = [t1, t2].sort().join('|')
        if (!pairTradeCount[pairKey]) {
          pairTradeCount[pairKey] = { team1: t1, team2: t2, count: 0 }
        }
        pairTradeCount[pairKey].count++
      }
    })

    const sortedManagers = Object.entries(managerTradeCount).sort(([, a], [, b]) => b - a)
    const theAddict = sortedManagers[0]
    const areTheyAlive = sortedManagers[sortedManagers.length - 1]
    
    const sortedPairs = Object.values(pairTradeCount).sort((a, b) => b.count - a.count)
    const colluders = sortedPairs[0]
    
    const allPossiblePairs = new Set<string>()
    const tradedPairs = new Set(Object.keys(pairTradeCount))
    const allManagers = Object.keys(managerTradeCount)
    for (let i = 0; i < allManagers.length; i++) {
      for (let j = i + 1; j < allManagers.length; j++) {
        allPossiblePairs.add([allManagers[i], allManagers[j]].sort().join('|'))
      }
    }
    const untradedPairs = [...allPossiblePairs].filter(p => !tradedPairs.has(p))
    const frenemies = untradedPairs.length > 0 ? untradedPairs[0].split('|') : null

    // DATA-DRIVEN LEAGUE AWARDS
    // Computed from user's scored trades (which have accurate directional analytics)
    // These are user-perspective awards using real dual-mode valuation data
    const userScoredCount = scoredTrades.length

    // Build per-trade metrics from user's scored trades
    const userTradeMetrics = scoredTrades.map(trade => {
      const atTimeDelta = trade._analytics?.atTheTime?.deltaValue ?? trade.value
      const hindsightDelta = trade._analytics?.withHindsight?.deltaValue ?? trade.value
      const gradeVal = gradeToValue(trade.grade || 'C')
      const isHighConf = gradeVal >= 78 || gradeVal <= 45
      const marketShift = hindsightDelta - atTimeDelta
      const ppgDelta = trade.value / PPG_PROXY_DIVISOR
      const opponent = trade.parties?.find((p: any) => !isUserParty(p, sleeper_username, sleeper_user_id))
      const opponentName = opponent?.teamName || (opponent as any)?.displayName || managers?.[opponent?.userId || ''] || opponent?.userId || 'Unknown'
      return {
        value: trade.value,
        atTimeDelta,
        hindsightDelta,
        marketShift,
        ppgDelta,
        gradeVal,
        isHighConf,
        isWin: trade.value > WIN_THRESHOLD,
        opponentName,
      }
    })

    // Per-opponent breakdown for Best Negotiator
    const opponentStats: Record<string, { name: string; trades: number; wins: number; totalDelta: number }> = {}
    for (const t of userTradeMetrics) {
      if (!opponentStats[t.opponentName]) {
        opponentStats[t.opponentName] = { name: t.opponentName, trades: 0, wins: 0, totalDelta: 0 }
      }
      const os = opponentStats[t.opponentName]
      os.trades++
      os.totalDelta += t.value
      if (t.isWin) os.wins++
    }

    // 1. Best Negotiator: highest win rate at lowest overpay
    // Computed per-opponent to find who you negotiate best against (min 2 trades)
    const bestNegotiator = userScoredCount >= 2 ? (() => {
      const opponents = Object.values(opponentStats).filter(o => o.trades >= 2)
      if (opponents.length === 0) {
        const globalWinRate = userTradeMetrics.filter(t => t.isWin).length / userScoredCount
        const avgDelta = userTradeMetrics.reduce((s, t) => s + t.value, 0) / userScoredCount
        const avgOverpay = Math.max(0, -avgDelta)
        const efficiency = 1 / (1 + avgOverpay / 500)
        return {
          name: sleeper_username,
          trades: userScoredCount,
          winRate: Math.round(globalWinRate * 100),
          avgOverpay: Math.round(avgOverpay),
          score: Math.round(globalWinRate * efficiency * 100),
        }
      }
      const scored = opponents.map(o => {
        const winRate = o.wins / o.trades
        const avgOverpay = Math.max(0, -(o.totalDelta / o.trades))
        const efficiency = 1 / (1 + avgOverpay / 500)
        return { name: o.name, trades: o.trades, winRate: Math.round(winRate * 100), avgOverpay: Math.round(avgOverpay), score: Math.round(winRate * efficiency * 100) }
      }).sort((a, b) => b.score - a.score)
      return scored[0]
    })() : null

    // 2. Market Sniper: best timing — trades that gained value over time
    const marketSniper = userScoredCount >= 2 ? (() => {
      const shifts = userTradeMetrics.map(t => t.marketShift)
      const avgShift = shifts.reduce((a, b) => a + b, 0) / shifts.length
      const bestTrade = userTradeMetrics.reduce((best, t) => t.marketShift > best.marketShift ? t : best, userTradeMetrics[0])
      return {
        name: sleeper_username,
        trades: userScoredCount,
        avgShift: Math.round(avgShift),
        bestShift: Math.round(bestTrade.marketShift),
        bestShiftOpponent: bestTrade.opponentName,
      }
    })() : null

    // 3. Starter Builder: most net starting PPG gained
    const starterBuilder = userScoredCount >= 2 ? (() => {
      const netPPG = userTradeMetrics.reduce((s, t) => s + t.ppgDelta, 0)
      return {
        name: sleeper_username,
        trades: userScoredCount,
        netPPG: Math.round(netPPG * 10) / 10,
        ppgPerTrade: Math.round((netPPG / userScoredCount) * 10) / 10,
      }
    })() : null

    // 4. Risk King: highest volatility WITH long-term profit
    const riskKing = (() => {
      if (userScoredCount < 2) return null
      const totalDelta = userTradeMetrics.reduce((s, t) => s + t.value, 0)
      if (totalDelta <= 0) return null
      const mean = totalDelta / userScoredCount
      const variance = userTradeMetrics.reduce((s, t) => s + Math.pow(t.value - mean, 2), 0) / userScoredCount
      const stdDev = Math.sqrt(variance)
      if (stdDev < 100) return null
      return {
        name: sleeper_username,
        trades: userScoredCount,
        volatility: Math.round(stdDev),
        netProfit: Math.round(totalDelta),
      }
    })()

    // 5. The Fleecer: highest avg fairness delta with high-confidence trades only
    const theFleecer = (() => {
      const highConf = userTradeMetrics.filter(t => t.isHighConf)
      if (highConf.length < 2) return null
      const avgDelta = highConf.reduce((s, t) => s + t.value, 0) / highConf.length
      return {
        name: sleeper_username,
        trades: userScoredCount,
        avgFairnessDelta: Math.round(avgDelta),
        highConfCount: highConf.length,
      }
    })()

    const cumulativeJourney = userTrades
      .sort((a, b) => a.timestamp - b.timestamp)
      .reduce((acc: Array<{ date: string; value: number; grade: string }>, trade, idx) => {
        const prev = acc[idx - 1]?.value || 0
        const tradeValue = (gradeToValue(trade.grade || 'C') - 60) * 100
        acc.push({
          date: new Date(trade.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
          value: prev + tradeValue,
          grade: trade.grade || 'C'
        })
        return acc
      }, [])

    const response = {
      leagueId: league_id,
      username: sleeper_username,
      updatedAt: new Date().toISOString(),
      
      gradeCard: {
        grade: overallGrade,
        score: overallScore,
        label: traderLabel,
      },
      
      tradingStats: {
        netValueGained: totalValueGained,
        wins,
        losses,
        even,
        winRate,
        avgPerTrade: totalTradeCount > 0 ? Math.round(totalValueGained / totalTradeCount) : 0,
        valueGiven: Math.abs(Math.min(0, totalValueGained)) + Math.round(totalTradeCount * 1000),
        valueReceived: Math.max(0, totalValueGained) + Math.round(totalTradeCount * 1000),
        multiDimensional: multiStats,
      },
      
      tradingJourney: cumulativeJourney,
      
      tradingPartners: {
        bestMark: bestMark ? {
          name: bestMark.name, trades: bestMark.trades, netValue: bestMark.netValue,
          avgGrade: bestMark.avgGrade, avgPerTrade: bestMark.avgPerTrade,
          weightedScore: bestMark.weightedScore, styleMatch: bestMark.styleMatch,
          topShape: bestMark.topShape,
        } : null,
        nemesis: nemesis ? {
          name: nemesis.name, trades: nemesis.trades, netValue: nemesis.netValue,
          avgGrade: nemesis.avgGrade, avgPerTrade: nemesis.avgPerTrade,
          weightedScore: nemesis.weightedScore, styleMatch: nemesis.styleMatch,
          topShape: nemesis.topShape,
        } : null,
        all: partners.map(p => ({
          rank: p.rank, name: p.name, trades: p.trades, netValue: p.netValue,
          avgGrade: p.avgGrade, avgPerTrade: p.avgPerTrade,
          weightedScore: p.weightedScore, styleMatch: p.styleMatch,
          topShape: p.topShape,
        })),
      },
      
      bestTrade: bestTrade ? {
        value: bestTradeValue,
        opponent: (() => { const op = bestTrade.parties?.find((p: any) => !isUserParty(p, sleeper_username, sleeper_user_id)); return op?.teamName || op?.displayName || 'Unknown' })(),
        date: new Date(bestTrade.timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        gave: bestTrade.parties?.find((p: any) => isUserParty(p, sleeper_username, sleeper_user_id))?.playersReceived?.map((pl: any) => pl.name) || [],
        received: bestTrade.parties?.find((p: any) => !isUserParty(p, sleeper_username, sleeper_user_id))?.playersReceived?.map((pl: any) => pl.name) || [],
      } : null,
      
      worstTrade: worstTrade && worstTradeValue < 0 ? {
        value: Math.abs(worstTradeValue),
        opponent: (() => { const op = worstTrade.parties?.find((p: any) => !isUserParty(p, sleeper_username, sleeper_user_id)); return op?.teamName || op?.displayName || 'Unknown' })(),
        date: new Date(worstTrade.timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        gave: worstTrade.parties?.find((p: any) => isUserParty(p, sleeper_username, sleeper_user_id))?.playersReceived?.map((pl: any) => pl.name) || [],
        received: worstTrade.parties?.find((p: any) => !isUserParty(p, sleeper_username, sleeper_user_id))?.playersReceived?.map((pl: any) => pl.name) || [],
      } : null,
      
      leagueAwards: {
        theAddict: theAddict ? { name: theAddict[0], trades: theAddict[1] } : null,
        areTheyAlive: areTheyAlive ? { name: areTheyAlive[0], trades: areTheyAlive[1] } : null,
        colluders: colluders ? { team1: colluders.team1, team2: colluders.team2, trades: colluders.count } : null,
        frenemies: frenemies ? { team1: frenemies[0], team2: frenemies[1] } : null,
        bestNegotiator: bestNegotiator ? {
          name: bestNegotiator.name, trades: bestNegotiator.trades,
          winRate: bestNegotiator.winRate, avgOverpay: bestNegotiator.avgOverpay,
          score: bestNegotiator.score,
          method: 'Win rate × efficiency (1/(1 + avgOverpay/500))',
        } : null,
        marketSniper: marketSniper ? {
          name: marketSniper.name, trades: marketSniper.trades,
          avgShift: marketSniper.avgShift, bestShift: marketSniper.bestShift,
          method: 'Avg (hindsight value − at-time value) per trade',
        } : null,
        starterBuilder: starterBuilder ? {
          name: starterBuilder.name, trades: starterBuilder.trades,
          netPPG: starterBuilder.netPPG, ppgPerTrade: starterBuilder.ppgPerTrade,
          method: 'Net starting PPG gained via trades (value ÷ 250)',
        } : null,
        riskKing: riskKing ? {
          name: riskKing.name, trades: riskKing.trades,
          volatility: riskKing.volatility, netProfit: riskKing.netProfit,
          method: 'Highest trade volatility with net positive outcome',
        } : null,
        theFleecer: theFleecer ? {
          name: theFleecer.name, trades: theFleecer.trades,
          avgFairnessDelta: theFleecer.avgFairnessDelta, highConfCount: theFleecer.highConfCount,
          method: 'Highest avg fairness delta on high-confidence trades only (B+ or D and below)',
        } : null,
      },
      
      allTrades: scoredTrades.map(t => {
        const atTime = t._analytics?.atTheTime
        const hindsight = t._analytics?.withHindsight
        const marketShift = (hindsight?.deltaValue ?? 0) - (atTime?.deltaValue ?? 0)
        const atTimeAbs = Math.abs(atTime?.deltaValue ?? t.value)
        const hindsightAbs = Math.abs(hindsight?.deltaValue ?? t.value)
        const controversyScore = Math.abs(marketShift) > 200
          ? Math.round(Math.abs(marketShift) * (Math.abs(atTime?.percentDiff ?? 0) < 15 ? 1.3 : 1))
          : Math.round(Math.abs(atTime?.percentDiff ?? 0) < 10 ? atTimeAbs * 0.8 : 0)

        const mapAssets = (assets: any[]) => assets?.map((a: any) => ({
          name: a.name,
          type: a.type,
          position: a.position || null,
          value: a.value,
          market: a.assetValue?.marketValue ?? 0,
          impact: a.assetValue?.impactValue ?? 0,
          vorp: a.assetValue?.vorpValue ?? 0,
          volatility: a.assetValue?.volatility ?? 0,
          source: a.source,
        })) || []

        const opParty = t.parties?.find(p => !isUserParty(p, sleeper_username, sleeper_user_id))
        const meParty = t.parties?.find(p => isUserParty(p, sleeper_username, sleeper_user_id))

        const receivedPlayers = meParty?.playersReceived?.map((p: any) => ({ name: p.name, position: p.position || null })) || []
        const gavePlayers = opParty?.playersReceived?.map((p: any) => ({ name: p.name, position: p.position || null })) || []
        const receivedPicks = meParty?.picksReceived?.map((pk: any) => ({
          round: pk.round,
          season: pk.season,
          label: `${pk.season} Round ${pk.round}${pk.slot ? ` (${pk.slot})` : ''}`
        })) || []
        const gavePicks = opParty?.picksReceived?.map((pk: any) => ({
          round: pk.round,
          season: pk.season,
          label: `${pk.season} Round ${pk.round}${pk.slot ? ` (${pk.slot})` : ''}`
        })) || []

        return {
          id: t.transactionId,
          grade: t.grade || 'C',
          opponent: opParty?.teamName || (opParty as any)?.displayName || managers?.[opParty?.userId || ''] || 'Unknown',
          date: new Date(t.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
          timestamp: t.timestamp,
          playersOut: gavePlayers.length + gavePicks.length,
          playersIn: receivedPlayers.length + receivedPicks.length,
          receivedPlayers,
          gavePlayers,
          receivedPicks,
          gavePicks,
          netValue: t.value,
          verdict: t.verdict,
          marketShift: Math.round(marketShift),
          controversyScore: controversyScore,
          atTimeDelta: Math.round(atTime?.deltaValue ?? t.value),
          hindsightDelta: Math.round(hindsight?.deltaValue ?? t.value),
          atTimeGrade: atTime?.grade || t.grade || 'C',
          hindsightGrade: hindsight?.grade || t.grade || 'C',
          confidence: atTime?.confidence ?? 0,
          comparison: t._analytics?.comparison || null,
          drivers: {
            received: mapAssets(atTime?.receivedAssets ?? []),
            gave: mapAssets(atTime?.gaveAssets ?? []),
            receivedTotal: Math.round(atTime?.userReceivedValue ?? 0),
            gaveTotal: Math.round(atTime?.userGaveValue ?? 0),
          },
        }
      }).sort((a, b) => b.timestamp - a.timestamp),
    }

    let reportCard = null
    try {
      reportCard = computeReportCard(scoredTrades, sleeper_username, sleeper_user_id)
    } catch (e) {
      console.error('Report card computation error:', e)
    }

    if (sleeper_username) {
      logUserEventByUsername(sleeper_username, 'trade_analysis_completed', {
        leagueId: league_id,
        totalTrades: trades.length,
        userTrades: userTrades.length,
      })
    }

    return NextResponse.json({ ...response, reportCard })
  } catch (error) {
    console.error('Trade analytics error:', error)
    return NextResponse.json({ error: 'Failed to generate trade analytics' }, { status: 500 })
  }
})
