import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { 
  buildComprehensiveTradeContext,
  generateAIGMAnalysis,
  runPreAnalysisForUser,
  TradeParty,
  ComprehensiveTradeContext,
} from '@/lib/ai-gm-intelligence'
import { getSleeperUser, getLeagueInfo, getLeagueRosters, getAllPlayers, getLeagueUsers } from '@/lib/sleeper-client'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { trackLegacyToolUsage } from '@/lib/analytics-server'
import { forbiddenResponse, validateRequestOrigin } from '@/lib/api-auth'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

export const GET = withApiUsage({ endpoint: "/api/legacy/ai-gm-analyze", tool: "LegacyAiGmAnalyze" })(async (request: NextRequest) => {
  if (!validateRequestOrigin(request)) {
    return forbiddenResponse('Invalid origin')
  }

  /*
   * The origin check above is CSRF hygiene, not authentication -- this read the pre-analysis
   * readiness of whatever `username` was named. The param is now only compared; the
   * readiness read is the caller's own.
   */
  const { searchParams } = new URL(request.url)
  const leagueId = searchParams?.get('leagueId')
  const gate = await requireLegacySleeperIdentity(request, {
    requestedUsername: searchParams?.get('username'),
  })
  if (!gate.ok) return gate.response
  const username = gate.identity.sleeperUsername

  try {
    const readiness = await runPreAnalysisForUser(username, leagueId || '')
    return NextResponse.json(readiness)
  } catch (error) {
    console.error('Pre-analysis check failed:', error)
    return NextResponse.json({ error: 'Failed to check readiness' }, { status: 500 })
  }
})

export const POST = withApiUsage({ endpoint: "/api/legacy/ai-gm-analyze", tool: "LegacyAiGmAnalyze" })(async (request: NextRequest) => {
  /*
   * Was `requireAuthOrOrigin`, which passes any anonymous caller sending a matching `Origin`
   * header -- so this paid-model endpoint ran for anyone, as anyone. The origin check stays
   * as CSRF protection; identity comes from the shared legacy gate, and a guest (no account,
   * no plan) cannot spend model calls here.
   */
  if (!validateRequestOrigin(request)) return forbiddenResponse('Invalid request origin')

  const ip = getClientIp(request)
  const rateLimitResult = consumeRateLimit({
    scope: 'legacy',
    action: 'ai_gm_analyze',
    ip,
    maxRequests: 5,
    windowMs: 60000,
  })

  if (!rateLimitResult.success) {
    return NextResponse.json({
      error: 'Rate limited. Please wait before trying again.',
      retryAfter: rateLimitResult.retryAfterSec,
    }, { status: 429 })
  }

  try {
    const body = await request.json()
    const {
      leagueId,
      trade,
    } = body

    const gate = await requireLegacySleeperIdentity(request, {
      requestedUsername: typeof body?.username === 'string' ? body.username : null,
      rateLimit: { action: 'ai_gm_analyze', maxRequests: 5, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const username = gate.identity.sleeperUsername

    if (!username || !leagueId || !trade) {
      return NextResponse.json({ 
        error: 'Username, leagueId, and trade data required' 
      }, { status: 400 })
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
    const allPlayers = await getAllPlayers()
    const leagueUsers = await getLeagueUsers(leagueId)

    const userRoster = rosters?.find(r => r.owner_id === sleeperUser.user_id)
    if (!userRoster) {
      return NextResponse.json({ error: 'User roster not found' }, { status: 404 })
    }

    const formatPlayer = (playerId: string) => {
      const player = allPlayers[playerId]
      return {
        id: playerId,
        name: player ? `${player.first_name} ${player.last_name}` : playerId,
        position: player?.position || 'Unknown',
      }
    }

    const userParty: TradeParty = {
      rosterId: userRoster.roster_id,
      managerId: sleeperUser.user_id,
      managerName: sleeperUser.display_name || sleeperUser.username,
      players: (trade.playersGiving || []).map((id: string) => formatPlayer(id)),
      picks: trade.picksGiving || [],
    }

    const otherParties: TradeParty[] = []
    
    if (trade.partnerRosterId) {
      const partnerRoster = rosters?.find(r => r.roster_id === trade.partnerRosterId)
      if (partnerRoster) {
        let partnerName = `Manager ${trade.partnerRosterId}`
        try {
          const partner = leagueUsers.find((u) => u.user_id === partnerRoster.owner_id)
          if (partner) {
            partnerName = partner.display_name || partner.username || partnerName
          }
        } catch {}

        otherParties.push({
          rosterId: partnerRoster.roster_id,
          managerId: partnerRoster.owner_id || String(partnerRoster.roster_id),
          managerName: partnerName,
          players: (trade.playersReceiving || []).map((id: string) => formatPlayer(id)),
          picks: trade.picksReceiving || [],
        })
      }
    }

    const settings = leagueInfo.settings as { type?: number } | null
    const isDynasty = settings?.type === 2
    const rosterPositions = leagueInfo.roster_positions || []
    const isSuperFlex = rosterPositions.includes('SUPER_FLEX')
    const isTeePremium = rosterPositions.filter((p: string) => p === 'TE').length > 1

    const leagueSettings: ComprehensiveTradeContext['leagueSettings'] = {
      isDynasty,
      isSuperFlex,
      isTeePremium,
      scoringType: 'PPR',
      rosterPositions,
      teamCount: rosters?.length || 12,
    }

    const context = await buildComprehensiveTradeContext(
      leagueId,
      username,
      userParty,
      otherParties,
      leagueSettings
    )

    const analysis = await generateAIGMAnalysis(context)

    await trackLegacyToolUsage(
      'ai_gm_analyze',
      username,
      null,
      {
        leagueId,
        verdict: analysis.verdict,
        confidence: analysis.confidence,
        playersInTrade: context.marketValues.playersGiven.length + context.marketValues.playersReceived.length,
      }
    )

    return NextResponse.json({
      analysis,
      context: {
        leagueName: context.leagueName,
        leagueSettings: context.leagueSettings,
        marketValues: context.marketValues,
        userTradingProfile: context.userTradingProfile,
        playerNews: context.playerNewsAndSentiment,
      },
    })
  } catch (error) {
    console.error('AI GM analysis failed:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to generate AI GM analysis',
    }, { status: 500 })
  }
})

