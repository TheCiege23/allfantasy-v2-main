import { prisma } from '@/lib/prisma'
import { resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'

export interface InsightCitation {
  source: string
  timestamp: string
  confidence: 'high' | 'medium' | 'low'
}

export interface InsightItem {
  id?: string
  type: string
  category: string
  title: string
  body: string
  priority: number
  confidence: number
  data?: Record<string, any>
  citations?: InsightCitation[]
}

export interface InsightsResult {
  insights: InsightItem[]
  audit: {
    sourcesUsed: string[]
    generatedAt: string
    insightCount: number
    errors: string[]
    partialData: boolean
    missingSources: string[]
  }
}

export async function generateUserInsights(
  userId: string,
  sleeperUsername: string,
  leagueId?: string
): Promise<InsightsResult> {
  const insights: InsightItem[] = []
  const sourcesUsed = new Set<string>()
  const errors: string[] = []

  await Promise.all([
    generateInjuryAlerts(insights, sourcesUsed, errors, sleeperUsername, leagueId),
    generateTradingPatternInsights(insights, sourcesUsed, errors, sleeperUsername),
    generatePositionBoomBust(insights, sourcesUsed, errors, sleeperUsername, leagueId),
    generateNewsInsights(insights, sourcesUsed, errors),
  ])

  const errorPrefixToSource: Record<string, string> = {
    injury_alerts: 'injuries',
    trading_patterns: 'trading_patterns',
    position_analysis: 'position_analysis',
    news_insights: 'news',
  }
  const missingSources: string[] = []
  for (const e of errors) {
    const prefix = e.split(':')[0].trim()
    const source = errorPrefixToSource[prefix]
    if (source && !missingSources.includes(source)) {
      missingSources.push(source)
    }
  }

  insights.sort((a, b) => b.priority - a.priority)

  for (const insight of insights.slice(0, 20)) {
    try {
      await prisma.aIInsight.create({
        data: {
          userId,
          sleeperUsername,
          leagueId: leagueId || null,
          insightType: insight.type,
          category: insight.category,
          title: insight.title,
          body: insight.body,
          data: insight.data || {},
          priority: insight.priority,
          confidence: insight.confidence,
        },
      })
    } catch (err) {
      console.warn('[Insights] Failed to save insight:', err)
    }
  }

  return {
    insights,
    audit: {
      sourcesUsed: Array.from(sourcesUsed),
      generatedAt: new Date().toISOString(),
      insightCount: insights.length,
      errors,
      partialData: missingSources.length > 0,
      missingSources,
    },
  }
}

async function generateInjuryAlerts(
  insights: InsightItem[],
  sourcesUsed: Set<string>,
  errors: string[],
  sleeperUsername: string,
  leagueId?: string
): Promise<void> {
  try {
    const user = await prisma.legacyUser.findUnique({
      where: { sleeperUsername },
      include: {
        leagues: {
          where: leagueId ? { sleeperLeagueId: leagueId } : {},
          include: { rosters: { where: { isOwner: true } } },
        },
      },
    })

    if (!user || user.leagues.length === 0) return

    const ownedPlayerIds: Set<string> = new Set()
    for (const league of user.leagues) {
      for (const roster of league.rosters) {
        const players = roster.players as string[] | null
        if (Array.isArray(players)) {
          for (const pid of players) ownedPlayerIds.add(pid)
        }
      }
    }

    if (ownedPlayerIds.size === 0) return

    const identities = await prisma.playerIdentityMap.findMany({
      where: { sleeperId: { in: Array.from(ownedPlayerIds) } },
    })

    if (identities.length === 0) return

    /*
     * 🛑 THROUGH THE CANONICAL INJURY PORT, ONE FACT PER PLAYER. This read used to take every
     * `SportsInjury` row whose NAME matched — any sport, any age, every provider's copy — and
     * raise one alert per ROW. So a name shared by two athletes (WR vs LB Justin Jefferson)
     * alerted on the other player's status, a months-old "Out" alerted as news, and one injury
     * reported by three feeds alerted three times. The port binds by name VERIFIED by team and
     * position, drops expired rows, and marks stale ones; a stale claim does not alert.
     */
    const ALERT_STATUSES = new Set(['Out', 'Doubtful', 'Questionable', 'IR'])
    const bySport = new Map<string, typeof identities>()
    for (const i of identities) {
      const sport = (i.sport || 'NFL').toUpperCase()
      bySport.set(sport, [...(bySport.get(sport) ?? []), i])
    }

    for (const [sport, group] of bySport) {
      const res = await resolveInjuryFacts({
        sport,
        players: group.map(i => ({ name: i.canonicalName, team: i.currentTeam, position: i.position })),
      })
      for (const i of group) {
        const fact = res.byPlayer.get(normalizeMatchName(i.canonicalName))
        if (!fact || fact.stale || !fact.status || !ALERT_STATUSES.has(String(fact.status))) continue
        sourcesUsed.add('injury_reports')
        const severity = fact.status === 'Out' || fact.status === 'IR' ? 90 : fact.status === 'Doubtful' ? 75 : 55
        insights.push({
          type: 'injury_alert',
          category: 'roster',
          title: `${i.canonicalName} is ${fact.status}`,
          body: `Your player ${i.canonicalName} (${i.currentTeam || 'Unknown'}) is listed as ${fact.status}${fact.description ? ': ' + fact.description : ''}. Consider checking your waiver wire for a replacement.`,
          priority: severity,
          confidence: 0.95,
          data: {
            playerName: i.canonicalName,
            team: i.currentTeam,
            status: fact.status,
            description: fact.description,
          },
          citations: [{
            source: 'API-Sports Injury Report',
            timestamp: fact.reportedAt.toISOString(),
            confidence: 'high',
          }],
        })
      }
    }
  } catch (err) {
    errors.push(`injury_alerts: ${String(err)}`)
    console.warn('[Insights] Injury alerts failed:', err)
  }
}

async function generateTradingPatternInsights(
  insights: InsightItem[],
  sourcesUsed: Set<string>,
  errors: string[],
  sleeperUsername: string
): Promise<void> {
  try {
    const tradeHistories = await prisma.leagueTradeHistory.findMany({
      where: { sleeperUsername },
    })

    if (tradeHistories.length === 0) return

    const historyIds = tradeHistories.map(h => h.id)
    const trades = await prisma.leagueTrade.findMany({
      where: { historyId: { in: historyIds } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    if (trades.length < 5) return

    const positionAcquired: Record<string, number> = {}
    const positionTraded: Record<string, number> = {}
    let youthCount = 0
    let veteranCount = 0

    for (const trade of trades) {
      const received = (trade.playersReceived as Array<{ position: string; age?: number }>) || []
      const given = (trade.playersGiven as Array<{ position: string; age?: number }>) || []

      for (const p of received) {
        positionAcquired[p.position] = (positionAcquired[p.position] || 0) + 1
        if (p.age && p.age < 25) youthCount++
        if (p.age && p.age >= 28) veteranCount++
      }
      for (const p of given) {
        positionTraded[p.position] = (positionTraded[p.position] || 0) + 1
      }
    }

    const positions = [...new Set([...Object.keys(positionAcquired), ...Object.keys(positionTraded)])]
    let heaviestPos = ''
    let heaviestNet = 0

    for (const pos of positions) {
      const net = (positionAcquired[pos] || 0) - (positionTraded[pos] || 0)
      if (Math.abs(net) > Math.abs(heaviestNet)) {
        heaviestNet = net
        heaviestPos = pos
      }
    }

    sourcesUsed.add('trade_history')
    const tradeCitation: InsightCitation = {
      source: 'Sleeper Trade History',
      timestamp: trades[0]?.createdAt?.toISOString() || new Date().toISOString(),
      confidence: 'high',
    }

    if (heaviestPos && Math.abs(heaviestNet) >= 3) {
      const direction = heaviestNet > 0 ? 'acquiring' : 'trading away'
      insights.push({
        type: 'pattern_analysis',
        category: 'strategy',
        title: `You've been heavily ${direction} ${heaviestPos}s`,
        body: `Over your last ${trades.length} trades, you have a net ${heaviestNet > 0 ? '+' : ''}${heaviestNet} at ${heaviestPos}. ${
          heaviestNet > 0
            ? 'Make sure you\'re not overinvesting in one position at the expense of overall roster balance.'
            : 'Consider whether you\'re undervaluing this position in your overall strategy.'
        }`,
        priority: 60,
        confidence: 0.8,
        data: { position: heaviestPos, netAcquired: heaviestNet, totalTrades: trades.length },
        citations: [tradeCitation],
      })
    }

    if (youthCount > veteranCount * 2 && youthCount >= 5) {
      insights.push({
        type: 'boom_bust',
        category: 'strategy',
        title: 'Youth-Heavy Strategy: Boom/Bust Analysis',
        body: `You favor young players (${youthCount} youth acquisitions vs ${veteranCount} vets). Young players have higher ceilings but more bust risk. Consider balancing with a proven veteran to stabilize your roster.`,
        priority: 55,
        confidence: 0.75,
        data: { youthCount, veteranCount, ratio: youthCount / Math.max(veteranCount, 1) },
        citations: [tradeCitation],
      })
    } else if (veteranCount > youthCount * 2 && veteranCount >= 5) {
      insights.push({
        type: 'boom_bust',
        category: 'strategy',
        title: 'Veteran-Heavy Strategy: Window Analysis',
        body: `You've been loading up on veterans (${veteranCount} vet acquisitions vs ${youthCount} youth). This is a win-now strategy — make sure your window is truly open, or you risk rapid depreciation.`,
        priority: 55,
        confidence: 0.75,
        data: { youthCount, veteranCount },
        citations: [tradeCitation],
      })
    }
  } catch (err) {
    errors.push(`trading_patterns: ${String(err)}`)
    console.warn('[Insights] Trading pattern analysis failed:', err)
  }
}

async function generatePositionBoomBust(
  insights: InsightItem[],
  sourcesUsed: Set<string>,
  errors: string[],
  sleeperUsername: string,
  leagueId?: string
): Promise<void> {
  try {
    const user = await prisma.legacyUser.findUnique({
      where: { sleeperUsername },
      include: {
        leagues: {
          where: leagueId ? { sleeperLeagueId: leagueId } : {},
          include: { rosters: { where: { isOwner: true } } },
        },
      },
    })

    if (!user || user.leagues.length === 0) return

    const positionCounts: Record<string, number> = {}
    let totalPlayers = 0

    for (const league of user.leagues) {
      for (const roster of league.rosters) {
        const players = roster.players as string[] | null
        if (!Array.isArray(players)) continue
        totalPlayers += players.length
      }
    }

    if (totalPlayers > 0) {
      const leagueCount = user.leagues.length
      if (leagueCount >= 3) {
        sourcesUsed.add('league_rosters')
        insights.push({
          type: 'portfolio_overview',
          category: 'strategy',
          title: `Multi-League Portfolio: ${leagueCount} Leagues`,
          body: `You're managing ${totalPlayers} total roster spots across ${leagueCount} leagues. Diversification across leagues can reduce risk, but over-exposure to specific players creates correlated risk.`,
          priority: 45,
          confidence: 0.85,
          data: { leagueCount, totalPlayers },
          citations: [{
            source: 'Sleeper League Import',
            timestamp: 'historical',
            confidence: 'high',
          }],
        })
      }
    }
  } catch (err) {
    errors.push(`position_analysis: ${String(err)}`)
    console.warn('[Insights] Position analysis failed:', err)
  }
}

async function generateNewsInsights(
  insights: InsightItem[],
  sourcesUsed: Set<string>,
  errors: string[]
): Promise<void> {
  try {
    const recentNews = await prisma.sportsNews.findMany({
      where: {
        publishedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { publishedAt: 'desc' },
      take: 5,
    })

    if (recentNews.length >= 3) {
      const newsSources = [...new Set(recentNews.map(n => n.source).filter(Boolean))]
      for (const s of newsSources) sourcesUsed.add(`news:${s}`)

      insights.push({
        type: 'trending_news',
        category: 'news',
        title: 'Trending NFL News',
        body: `${recentNews.length} news stories in the last 24 hours. Key headlines: ${recentNews.slice(0, 3).map(n => n.title).join('; ')}`,
        priority: 40,
        confidence: 0.9,
        data: {
          articles: recentNews.map(n => ({
            title: n.title,
            source: n.source,
            team: n.team,
          })),
        },
        citations: recentNews.slice(0, 3).map(n => ({
          source: n.source || 'NFL News',
          timestamp: n.publishedAt?.toISOString() || new Date().toISOString(),
          confidence: 'high' as const,
        })),
      })
    }
  } catch (err) {
    errors.push(`news_insights: ${String(err)}`)
    console.warn('[Insights] News insights failed:', err)
  }
}

export async function getUnreadInsights(
  username: string,
  limit: number = 20
): Promise<any[]> {
  return prisma.aIInsight.findMany({
    where: {
      AND: [
        {
          OR: [
            { sleeperUsername: username },
            { userId: username },
          ],
        },
        { isDismissed: false },
        {
          OR: [
            { expiresAt: null },
            { expiresAt: { gte: new Date() } },
          ],
        },
      ],
    },
    orderBy: [{ isRead: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  })
}

export async function markInsightRead(insightId: string): Promise<void> {
  await prisma.aIInsight.update({
    where: { id: insightId },
    data: { isRead: true },
  })
}

export async function dismissInsight(insightId: string): Promise<void> {
  await prisma.aIInsight.update({
    where: { id: insightId },
    data: { isDismissed: true },
  })
}
