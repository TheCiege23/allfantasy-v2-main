import { withApiUsage } from "@/lib/telemetry/usage"
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { trackLegacyToolUsage } from '@/lib/analytics-server'
import { getAllPlayers, getLeagueRosters, getLeagueTransactions, getLeagueUsers } from '@/lib/sleeper-client'
import { getOrCreateAiResult } from '@/lib/ai/ai-result-cache'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

type SleeperTransaction = {
  transaction_id: string
  type: string
  status: string
  roster_ids: number[]
  adds?: Record<string, number> | null
  drops?: Record<string, number> | null
  draft_picks?: Array<{
    season: string
    round: number
    roster_id: number
    previous_owner_id: number
    owner_id: number
  }> | null
  created: number
  leg?: number
}

type SleeperPlayer = {
  full_name?: string
  first_name?: string
  last_name?: string
  position?: string
  team?: string
}

const playersCache: { at: number; data: Record<string, SleeperPlayer> | null } = { at: 0, data: null }
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

async function getSleeperPlayers() {
  const now = Date.now()
  if (playersCache.data && now - playersCache.at < CACHE_TTL_MS) return playersCache.data

  playersCache.at = now
  playersCache.data = await getAllPlayers() as Record<string, SleeperPlayer>
  return playersCache.data
}

function getPlayerName(playerId: string, players: Record<string, SleeperPlayer>): string {
  const p = players[playerId]
  if (!p) return playerId
  return p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || playerId
}

const openai = getOpenAIRouteClient()

async function analyzeTrade(
  playersGiven: string[],
  playersReceived: string[],
  picksGiven: string[],
  picksReceived: string[],
  leagueName: string,
  opts?: { leagueId?: string | null; userId?: string | null }
) {
  const prompt = `Analyze this trade for the "sender" perspective (first person):

League: ${leagueName}

SENDER GIVES: ${[...playersGiven, ...picksGiven].join(', ') || 'Nothing'}
SENDER RECEIVES: ${[...playersReceived, ...picksReceived].join(', ') || 'Nothing'}

Provide a quick analysis with:
1. A letter grade (A+, A, A-, B+, B, B-, C+, C, C-, D, F) for the sender
2. A verdict (Fair, Slightly favors Sender, Slightly favors Receiver, Strongly favors Sender, Strongly favors Receiver)
3. A brief 2-3 sentence expert analysis
4. One counter-offer suggestion if the grade is C or lower

Return JSON only:
{
  "grade": "B+",
  "verdict": "Fair",
  "expertAnalysis": "Brief analysis...",
  "counterOffer": "Optional counter..."
}`

  const cachePayload = {
    feature: 'legacy-trades-check-analysis',
    leagueId: opts?.leagueId ?? null,
    userId: opts?.userId ?? null,
    leagueName,
    playersGiven: [...playersGiven].sort(),
    playersReceived: [...playersReceived].sort(),
    picksGiven: [...picksGiven].sort(),
    picksReceived: [...picksReceived].sort(),
    promptVersion: 'v1',
  }

  const aiResult = await getOrCreateAiResult({
    feature: 'legacy-trades-check-analysis',
    scopeType: 'league',
    scopeId: opts?.leagueId ?? `global:${leagueName.toLowerCase()}`,
    provider: 'openai',
    model: 'gpt-4o',
    payload: cachePayload,
    ttlSeconds: 2 * 60 * 60,
    onCacheMiss: async () => {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are an elite dynasty fantasy football analyst. Return valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 500,
        temperature: 0.7,
      })

      const content = completion.choices[0]?.message?.content || '{}'
      return {
        resultText: content,
        resultJson: { content },
        tokenPrompt: completion.usage?.prompt_tokens ?? null,
        tokenOutput: completion.usage?.completion_tokens ?? null,
      }
    },
  })

  if (aiResult.cacheHit) {
    console.log(`[legacy-trades/check] AI cache hit { leagueId: '${opts?.leagueId ?? 'unknown'}' }`)
  } else {
    console.log(`[legacy-trades/check] AI cache miss { leagueId: '${opts?.leagueId ?? 'unknown'}', modelCallMs: ${aiResult.modelDurationMs ?? -1} }`)
    console.log(`[legacy-trades/check] saved AiResult { id: '${aiResult.row.id}', resultKey: '${aiResult.row.resultKey}' }`)
  }

  const cachedContent =
    (typeof aiResult.row.resultText === 'string' && aiResult.row.resultText.trim()) ||
    ((aiResult.row.resultJson as any)?.content as string | undefined) ||
    '{}'

  try {
    const cleaned = cachedContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return JSON.parse(cleaned)
  } catch {
    return {
      grade: 'N/A',
      verdict: 'Unable to analyze',
      expertAnalysis: 'AI analysis failed',
      counterOffer: null,
    }
  }
}

export const POST = withApiUsage({ endpoint: "/api/legacy/trades/check", tool: "LegacyTradesCheck" })(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: String(body.sleeper_username || '').trim() || null,
      rateLimit: { action: 'trades_check', maxRequests: 30, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeperUsername = gate.identity.sleeperUsername

    // 1) Find user in DB
    const legacyUser = await prisma.legacyUser.findUnique({
      where: { sleeperUsername },
      include: { leagues: { where: { season: { gte: 2024 } } } },
    })

    if (!legacyUser) {
      return NextResponse.json({ error: 'User not found - import your Sleeper data first' }, { status: 404 })
    }

    // 2) Get player dictionary
    const players = await getSleeperPlayers()

    // 3) Get league users for each league to map roster IDs to names AND find user's roster ID
    const leagueUserMaps: Map<string, Map<number, string>> = new Map()
    const leagueUserRosterIds: Map<string, number> = new Map() // Maps league ID -> user's roster ID

    for (const league of legacyUser.leagues) {
      const [users, rosters] = await Promise.all([
        getLeagueUsers(league.sleeperLeagueId) as Promise<Array<{ user_id: string; display_name?: string; username?: string }>>,
        getLeagueRosters(league.sleeperLeagueId) as Promise<Array<{ roster_id: number; owner_id: string | null }>>,
      ])

      if (Array.isArray(users) && Array.isArray(rosters) && users.length > 0 && rosters.length > 0) {

        const userMap = new Map(users.map((u) => [u.user_id, u.display_name || u.username || 'Unknown']))
        const rosterMap = new Map<number, string>()

        for (const roster of rosters) {
          if (roster.owner_id) {
            rosterMap.set(roster.roster_id, userMap.get(roster.owner_id) || 'Unknown')
            // Check if this roster belongs to our user
            if (roster.owner_id === legacyUser.sleeperUserId) {
              leagueUserRosterIds.set(league.sleeperLeagueId, roster.roster_id)
            }
          }
        }

        leagueUserMaps.set(league.sleeperLeagueId, rosterMap)
      }
    }

    // 4) Fetch recent completed trades from week 1 (Sleeper API doesn't expose pending trades)
    const newTrades: any[] = []
    const analyzedTrades: any[] = []
    const seenTradeIds: string[] = []
    
    // Only check 2024+ leagues and process in parallel batches
    const recentLeagues = legacyUser.leagues.filter(l => l.season >= 2024)
    const batchSize = 10
    
    for (let i = 0; i < recentLeagues.length; i += batchSize) {
      const batch = recentLeagues.slice(i, i + batchSize)
      
      await Promise.all(batch.map(async (league) => {
        const rosterMap = leagueUserMaps.get(league.sleeperLeagueId) || new Map()
        
        // Fetch week 1 transactions - Sleeper API only returns COMPLETED trades
        let allTrades: SleeperTransaction[] = []
        try {
          const weekTransactions = await getLeagueTransactions(league.sleeperLeagueId, 1) as SleeperTransaction[]
          // Get completed trades (pending trades are NOT exposed by Sleeper API)
          allTrades = (Array.isArray(weekTransactions) ? weekTransactions : []).filter(
            (tx) => tx.type === 'trade' && tx.status === 'complete'
          )
        } catch {
          // Ignore fetch failures
        }
        
        // Sort by created timestamp (newest first) and limit
        const trades = allTrades
          .sort((a, b) => (b.created || 0) - (a.created || 0))
          .slice(0, 5)

        for (const trade of trades) {
        // Check if we already have this trade
        const existing = await prisma.tradeNotification.findUnique({
          where: { transactionId: trade.transaction_id },
        })

        if (existing) {
          // Already tracked, add to results if not seen
          if (!existing.seenAt) {
            // Determine trade direction for existing trade
            const userRosterId = leagueUserRosterIds.get(league.sleeperLeagueId)
            let existingTradeDirection: 'outgoing' | 'incoming' | null = null
            if (userRosterId === existing.senderRosterId) {
              existingTradeDirection = 'outgoing'
            } else if (userRosterId === existing.receiverRosterId) {
              existingTradeDirection = 'incoming'
            }
            
            seenTradeIds.push(existing.id)
            analyzedTrades.push({
              id: existing.id,
              leagueId: existing.leagueId,
              leagueName: league.name,
              senderName: existing.senderName,
              receiverName: existing.receiverName,
              playersGiven: existing.playersGiven,
              playersReceived: existing.playersReceived,
              picksGiven: existing.picksGiven,
              picksReceived: existing.picksReceived,
              aiGrade: existing.aiGrade,
              aiVerdict: existing.aiVerdict,
              aiAnalysis: existing.aiAnalysis,
              createdAt: existing.sleeperCreatedAt || existing.createdAt,
              tradeStatus: existing.status === 'pending' ? 'pending' : 'complete',
              tradeDirection: existingTradeDirection,
              transactionId: existing.transactionId,
            })
          }
          continue
        }

        // Parse the trade
        const rosterIds = trade.roster_ids || []
        if (rosterIds.length < 2) continue

        const senderRosterId = rosterIds[0]
        const receiverRosterId = rosterIds[1]
        const senderName = rosterMap.get(senderRosterId) || `Team ${senderRosterId}`
        const receiverName = rosterMap.get(receiverRosterId) || `Team ${receiverRosterId}`
        
        // Determine trade direction based on user's roster ID
        const userRosterId = leagueUserRosterIds.get(league.sleeperLeagueId)
        let tradeDirection: 'outgoing' | 'incoming' | null = null
        if (userRosterId === senderRosterId) {
          tradeDirection = 'outgoing'
        } else if (userRosterId === receiverRosterId) {
          tradeDirection = 'incoming'
        } else {
          // User is not directly involved in this trade - skip for pending trades
          if (trade.status === 'pending') continue
        }

        // Parse adds/drops to determine what each side gave/received
        const playersGiven: string[] = []
        const playersReceived: string[] = []

        if (trade.adds) {
          for (const [playerId, rosterId] of Object.entries(trade.adds)) {
            if (rosterId === senderRosterId) {
              playersReceived.push(getPlayerName(playerId, players))
            } else if (rosterId === receiverRosterId) {
              playersGiven.push(getPlayerName(playerId, players))
            }
          }
        }

        // Parse picks
        const picksGiven: string[] = []
        const picksReceived: string[] = []

        if (trade.draft_picks) {
          for (const pick of trade.draft_picks) {
            const pickStr = `${pick.season} Round ${pick.round}`
            if (pick.owner_id === senderRosterId) {
              picksReceived.push(pickStr)
            } else if (pick.owner_id === receiverRosterId) {
              picksGiven.push(pickStr)
            }
          }
        }

        const isPending = trade.status === 'pending'

        // Only analyze completed trades automatically, pending trades get analyzed on demand.
        // Fix A: wrap in try/catch so an OpenAI or DB failure doesn't propagate through
        // Promise.all → outer catch → 500. Without this guard, a failing AI call prevents
        // the tradeNotification record from ever being saved, causing the hook to retry the
        // same failing path every 30 s indefinitely (infinite 500 loop).
        let analysis = null
        if (!isPending) {
          try {
            analysis = await analyzeTrade(
              playersGiven,
              playersReceived,
              picksGiven,
              picksReceived,
              league.name,
              { leagueId: league.sleeperLeagueId, userId: legacyUser.id }
            )
          } catch (err) {
            console.warn(
              '[legacy-trades/check] analyzeTrade failed, saving without AI grade:',
              err instanceof Error ? err.message : String(err)
            )
            // analysis stays null — trade is recorded without a grade.
            // Future polls see the existing record and skip it, breaking the retry loop.
          }
        }

        // Save to DB.
        // Fix B: upsert instead of create so that two concurrent requests (e.g. page-load
        // + Chimmy hook firing simultaneously) cannot both pass the findUnique check and
        // then race to insert the same transactionId, causing a Prisma P2002 unique
        // constraint violation → 500. The update: {} is an intentional no-op.
        const notification = await prisma.tradeNotification.upsert({
          where: { transactionId: trade.transaction_id },
          create: {
            userId: legacyUser.id,
            leagueId: league.id,
            sleeperLeagueId: league.sleeperLeagueId,
            transactionId: trade.transaction_id,
            status: isPending ? 'pending' : 'analyzed',
            type: 'trade',
            senderRosterId,
            senderName,
            receiverRosterId,
            receiverName,
            playersGiven,
            playersReceived,
            picksGiven,
            picksReceived,
            aiGrade: analysis?.grade || null,
            aiVerdict: analysis?.verdict || null,
            aiAnalysis: analysis,
            aiAnalyzedAt: analysis ? new Date() : null,
            sleeperCreatedAt: trade.created ? new Date(trade.created) : null,
          },
          update: {}, // no-op on conflict — race condition is idempotent
        })

        newTrades.push(notification)

        analyzedTrades.push({
          id: notification.id,
          leagueId: league.id,
          leagueName: league.name,
          senderName,
          receiverName,
          playersGiven,
          playersReceived,
          picksGiven,
          picksReceived,
          aiGrade: analysis?.grade || null,
          aiVerdict: analysis?.verdict || null,
          aiAnalysis: analysis,
          createdAt: notification.sleeperCreatedAt || notification.createdAt,
          isNew: true,
          tradeStatus: isPending ? 'pending' : 'complete',
          tradeDirection,
          transactionId: trade.transaction_id,
        })
        }
      })) // End Promise.all batch
    } // End batch loop

    // 5) Check for email preferences and send alerts for new trades
    if (newTrades.length > 0) {
      const emailPref = await prisma.emailPreference.findFirst({
        where: {
          OR: [
            { legacyUserId: legacyUser.id },
            { sleeperUsername: sleeperUsername },
          ],
          tradeAlerts: true,
          unsubscribedAt: null,
        },
      })

    }

    // 6) Mark unseen trades as seen (after they've been returned to user)
    const markSeen = body.mark_seen !== false
    if (markSeen && seenTradeIds.length > 0) {
      await prisma.tradeNotification.updateMany({
        where: { id: { in: seenTradeIds } },
        data: { seenAt: new Date() },
      })
    }

    // Track tool usage
    trackLegacyToolUsage('trade_check', legacyUser.id, null, { newCount: newTrades.length, totalCount: analyzedTrades.length })

    return NextResponse.json({
      success: true,
      trades: analyzedTrades,
      newCount: newTrades.length,
      totalCount: analyzedTrades.length,
    })
  } catch (e) {
    console.error('trades/check error', e)
    return NextResponse.json({ error: 'Failed to check trades', details: String(e) }, { status: 500 })
  }
})

export const GET = withApiUsage({ endpoint: "/api/legacy/trades/check", tool: "LegacyTradesCheck" })(async (req: NextRequest) => {
  try {
    const unseenOnly = req.nextUrl.searchParams?.get('unseen_only') === 'true'
    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: req.nextUrl.searchParams?.get('sleeper_username')?.trim() ?? null,
      rateLimit: { action: 'trades_check_read', maxRequests: 60, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeperUsername = gate.identity.sleeperUsername

    const legacyUser = await prisma.legacyUser.findUnique({
      where: { sleeperUsername },
      include: { leagues: true },
    })

    if (!legacyUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Build a map of sleeperLeagueId -> user's roster ID
    const leagueUserRosterIds: Map<string, number> = new Map()
    for (const league of legacyUser.leagues) {
      const rosters = await getLeagueRosters(league.sleeperLeagueId) as Array<{ roster_id: number; owner_id: string | null }>
      if (Array.isArray(rosters)) {
        for (const roster of rosters) {
          if (roster.owner_id === legacyUser.sleeperUserId) {
            leagueUserRosterIds.set(league.sleeperLeagueId, roster.roster_id)
            break
          }
        }
      }
    }

    const where: any = { userId: legacyUser.id }
    if (unseenOnly) {
      where.seenAt = null
    }

    const trades = await prisma.tradeNotification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const leagueMap = new Map(legacyUser.leagues.map((l) => [l.id, l.name]))
    const sleeperLeagueMap = new Map(legacyUser.leagues.map((l) => [l.id, l.sleeperLeagueId]))

    return NextResponse.json({
      success: true,
      trades: trades.map((t) => {
        // Determine trade direction
        const sleeperLeagueId = sleeperLeagueMap.get(t.leagueId)
        const userRosterId = sleeperLeagueId ? leagueUserRosterIds.get(sleeperLeagueId) : undefined
        let tradeDirection: 'outgoing' | 'incoming' | null = null
        if (userRosterId === t.senderRosterId) {
          tradeDirection = 'outgoing'
        } else if (userRosterId === t.receiverRosterId) {
          tradeDirection = 'incoming'
        }
        
        return {
          id: t.id,
          leagueId: t.leagueId,
          leagueName: leagueMap.get(t.leagueId) || 'Unknown',
          senderName: t.senderName,
          receiverName: t.receiverName,
          playersGiven: t.playersGiven,
          playersReceived: t.playersReceived,
          picksGiven: t.picksGiven,
          picksReceived: t.picksReceived,
          aiGrade: t.aiGrade,
          aiVerdict: t.aiVerdict,
          aiAnalysis: t.aiAnalysis,
          createdAt: t.sleeperCreatedAt || t.createdAt,
          seen: !!t.seenAt,
          tradeStatus: t.status === 'pending' ? 'pending' : 'complete',
          tradeDirection,
          transactionId: t.transactionId,
        }
      }),
    })
  } catch (e) {
    console.error('trades/check GET error', e)
    return NextResponse.json({ error: 'Failed to get trades' }, { status: 500 })
  }
})

