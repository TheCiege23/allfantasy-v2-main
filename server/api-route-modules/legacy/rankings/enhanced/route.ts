import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchFantasyCalcValues, type FantasyCalcSettings } from '@/lib/fantasycalc'
import { computeAdaptiveRankings, type RankingView } from '@/lib/rankings-engine/adaptive-rankings'
import { computeLeagueDemandIndex } from '@/lib/rankings-engine/league-demand-index'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'
import { computeEnhancedRankings, type EnhancedView } from '@/lib/rankings-engine/enhanced-rankings'
import type { LeagueRosterConfig } from '@/lib/vorp-engine'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getStrategyMetaReports } from '@/lib/strategy-meta'
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { getOrCreateAiResult } from '@/lib/ai/ai-result-cache'
import { getLeagueInfo, getLeagueRosters } from '@/lib/sleeper-client'

const openai = getOpenAIRouteClient()

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const VALID_VIEWS: EnhancedView[] = ['this_year', 'dynasty_horizon', 'overall']
const VALID_GOALS = ['win-now', 'balanced', 'rebuild'] as const

const PLAN_SYSTEM_PROMPT = `You are a fantasy football dynasty advisor. You generate structured 3-5 year strategic plans.

RULES:
- Use ONLY the computed data provided. Never invent stats or player projections.
- Maximum 5 bullet points total.
- Year 1: 2 specific actions based on roster gaps and strengths.
- Year 2-3: Draft/trade strategy based on pick inventory and age curve.
- Year 4-5: Refresh cycle plan based on aging assets.
- Include 1 "avoid" recommendation.
- Tone: motivational but honest. "Here's your path to the next tier."
- Reference specific positional strengths/weaknesses from the data.
- Keep each bullet under 25 words.
- Return valid JSON: { "plan": [{ "timeframe": "Year 1", "action": "...", "type": "action|strategy|avoid" }] }`

export const POST = withApiUsage({ endpoint: "/api/legacy/rankings/enhanced", tool: "LegacyRankingsEnhanced" })(async (req: NextRequest) => {
  // Rate limit now runs inside the identity gate below, keyed on the authenticated actor.

  try {
    const body = await req.json()
    const leagueId = String(body?.league_id || '').trim()
    const view = String(body?.view || 'overall') as EnhancedView
    const goalInput = String(body?.goal || '').toLowerCase()
    const includePlan = body?.include_plan !== false
    const limit = Math.min(Math.max(Number(body?.limit) || 100, 10), 300)

    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: String(body?.sleeper_username || '').trim() || null,
      rateLimit: { action: 'enhanced_rankings', maxRequests: 8, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const username = gate.identity.sleeperUsername

    if (!leagueId) {
      return NextResponse.json({ error: 'Missing league_id' }, { status: 400 })
    }
    if (!VALID_VIEWS.includes(view)) {
      return NextResponse.json({ error: 'Invalid view. Use: this_year, dynasty_horizon, overall' }, { status: 400 })
    }

    const user = await prisma.legacyUser.findUnique({
      where: { sleeperUsername: username.toLowerCase() },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found. Import your Sleeper account first.' }, { status: 404 })
    }

    const [league, rosters] = await Promise.all([
      getLeagueInfo(leagueId),
      getLeagueRosters(leagueId),
    ])

    if (!league || !Array.isArray(rosters) || rosters.length === 0) {
      return NextResponse.json({ error: 'Failed to fetch league data from Sleeper' }, { status: 502 })
    }
    const normalizedSport = normalizeToSupportedSport(String(league?.sport || 'NFL'))

    const rosterPositions: string[] = league.roster_positions || []
    const isSF = rosterPositions.some((p: string) => p === 'SUPER_FLEX')
    const numTeams = rosters.length || league.total_rosters || 12
    const isDynasty = league.settings?.type === 2
    const leagueType = isDynasty ? 'Dynasty' : 'Redraft'

    const config: LeagueRosterConfig = {
      numTeams,
      startingQB: rosterPositions.filter((p: string) => p === 'QB').length || 1,
      startingRB: rosterPositions.filter((p: string) => p === 'RB').length || 2,
      startingWR: rosterPositions.filter((p: string) => p === 'WR').length || 2,
      startingTE: rosterPositions.filter((p: string) => p === 'TE').length || 1,
      startingFlex: rosterPositions.filter((p: string) => ['FLEX', 'SUPER_FLEX', 'REC_FLEX'].includes(p)).length || 2,
      superflex: isSF,
    }

    const ppr = league.scoring_settings?.rec === 1 ? 1 : league.scoring_settings?.rec === 0.5 ? 0.5 : 0
    const isTEP = (league.scoring_settings?.bonus_rec_te ?? 0) > 0
    const fcSettings: FantasyCalcSettings = {
      isDynasty,
      numQbs: isSF ? 2 : 1,
      numTeams,
      ppr: ppr as 0 | 0.5 | 1,
    }

    const userRoster = rosters.find((r: any) => r.owner_id === user.sleeperUserId)
    const userPlayerIds: string[] = userRoster?.players?.filter(Boolean) || []

    const userWins = userRoster?.settings?.wins ?? 0
    const userLosses = userRoster?.settings?.losses ?? 0
    const userPts = userRoster?.settings?.fpts ?? 0
    const leagueAvgPts = rosters.reduce((sum: number, r: any) => sum + (r.settings?.fpts ?? 0), 0) / Math.max(rosters.length, 1)
    const winPct = (userWins + userLosses) > 0 ? userWins / (userWins + userLosses) : 0.5

    let goal: typeof VALID_GOALS[number]
    if (goalInput && VALID_GOALS.includes(goalInput as any)) {
      goal = goalInput as typeof VALID_GOALS[number]
    } else {
      if (winPct >= 0.6 && userPts >= leagueAvgPts * 0.95) goal = 'win-now'
      else if (winPct <= 0.35 || userPts < leagueAvgPts * 0.8) goal = 'rebuild'
      else goal = 'balanced'
    }

    const baseView: RankingView = view === 'this_year' ? 'win_now' : view === 'dynasty_horizon' ? 'rebuild' : 'league'

    const [fcPlayers, ldi, strategyMetaContext] = await Promise.all([
      fetchFantasyCalcValues(fcSettings),
      computeLeagueDemandIndex(leagueId),
      getStrategyMetaReports({ sport: normalizedSport, timeframe: '30d' }).then((rows) => rows.slice(0, 3)).catch(() => []),
    ])

    const adaptiveOutput = computeAdaptiveRankings(fcPlayers, userPlayerIds, config, ldi, baseView, 300)

    const enhanced = computeEnhancedRankings(adaptiveOutput, goal, view, numTeams)

    let aiPlan: { timeframe: string; action: string; type: string }[] = []
    if (includePlan && isDynasty) {
      try {
        const planInput = {
          leagueType,
          scoring: ppr === 1 ? 'PPR' : ppr === 0.5 ? 'Half PPR' : 'Standard',
          isSF,
          isTEP,
          numTeams,
          goal,
          rosterProfile: enhanced.rosterProfile,
          positionalStrength: enhanced.positionalStrength,
          topAssets: enhanced.players.filter(p => p.isOnUserRoster).slice(0, 8).map(p => ({
            name: p.name, position: p.position, age: p.age, value: p.marketValue,
            trend: p.trend30Day > 0 ? 'rising' : p.trend30Day < 0 ? 'falling' : 'stable',
          })),
          weakPositions: enhanced.positionalStrength.filter(ps => ps.strengthPct < 85).map(ps => ps.position),
          strongPositions: enhanced.positionalStrength.filter(ps => ps.strengthPct > 115).map(ps => ps.position),
          strategyMetaContext: strategyMetaContext.map((row) => ({
            strategyType: row.strategyLabel ?? row.strategyType,
            usageRate: Math.round(row.usageRate * 100),
            successRate: Math.round(row.successRate * 100),
            trend: row.trendingDirection,
          })),
        }

        const userPrompt = `Generate a 3-5 year dynasty plan for this team:\n${JSON.stringify(planInput, null, 2)}`
        const aiPayload = {
          featureName: 'legacy-rankings-enhanced',
          sport: normalizedSport,
          season: String(league?.season || ''),
          scoringFormat: ppr === 1 ? 'ppr' : ppr === 0.5 ? 'half_ppr' : 'standard',
          leagueId,
          week: Number(league?.settings?.leg || 0) || null,
          view,
          goal,
          includePlan,
          options: {
            model: 'gpt-4o',
            temperature: 0.5,
            maxTokens: 600,
            responseFormat: 'json_object',
          },
          systemPrompt: PLAN_SYSTEM_PROMPT,
          userPrompt,
          planInput,
        }

        const aiResult = await getOrCreateAiResult({
          feature: 'legacy-rankings-enhanced-plan',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o',
          payload: aiPayload,
          ttlSeconds: 4 * 60 * 60,
          onCacheMiss: async () => {
            const completion = await openai.chat.completions.create({
              model: 'gpt-4o',
              temperature: 0.5,
              max_tokens: 600,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: PLAN_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
              ],
            })

            const content = completion.choices[0]?.message?.content || '{"plan":[]}'
            const parsed = JSON.parse(content)
            return {
              resultText: content,
              resultJson: parsed,
              tokenPrompt: completion.usage?.prompt_tokens ?? null,
              tokenOutput: completion.usage?.completion_tokens ?? null,
            }
          },
        })

        if (aiResult.cacheHit) {
          console.log(`[legacy-rankings/enhanced] AI cache hit { leagueId: '${leagueId}', view: '${view}', goal: '${goal}' }`)
        } else {
          console.log(`[legacy-rankings/enhanced] AI cache miss { leagueId: '${leagueId}', view: '${view}', goal: '${goal}', modelCallMs: ${aiResult.modelDurationMs ?? -1} }`)
          console.log(`[legacy-rankings/enhanced] saved AiResult { id: '${aiResult.row.id}', resultKey: '${aiResult.row.resultKey}' }`)
        }

        const parsed =
          aiResult.row.resultJson && typeof aiResult.row.resultJson === 'object'
            ? (aiResult.row.resultJson as Record<string, unknown>)
            : JSON.parse(aiResult.row.resultText || '{"plan":[]}')
        aiPlan = Array.isArray((parsed as any).plan) ? (parsed as any).plan.slice(0, 5) : []
      } catch (e) {
        console.error('AI plan generation failed:', e)
        aiPlan = [
          { timeframe: 'Year 1', action: `Focus on strengthening ${enhanced.positionalStrength.filter(ps => ps.strengthPct < 85).map(ps => ps.position).join(', ') || 'roster depth'}`, type: 'action' },
          { timeframe: 'Year 2-3', action: `Build around your ${enhanced.positionalStrength.filter(ps => ps.strengthPct > 110).map(ps => ps.position).join(', ') || 'core'} advantage`, type: 'strategy' },
        ]
      }
    }

    const topPlayers = enhanced.players.slice(0, limit)

    return NextResponse.json({
      success: true,
      view,
      goal,
      players: topPlayers.map(p => ({
        playerId: p.playerId,
        name: p.name,
        position: p.position,
        team: p.team,
        age: p.age,
        marketValue: p.marketValue,
        marketRank: p.marketRank,
        impactScore: p.impactScore,
        impactRank: p.impactRank,
        scarcityScore: p.scarcityScore,
        demandScore: p.demandScore,
        compositeScore: p.compositeScore,
        compositeRank: p.compositeRank,
        leagueRankScore: p.leagueRankScore,
        teamFitScore: p.teamFitScore,
        goalAlignmentScore: p.goalAlignmentScore,
        riskFitScore: p.riskFitScore,
        userRankScore: p.userRankScore,
        userRank: p.userRank,
        trend30Day: p.trend30Day,
        positionRank: p.positionRank,
        isOnUserRoster: p.isOnUserRoster,
        estimatedPPG: p.estimatedPPG,
        tfsBreakdown: p.tfsBreakdown,
        goalDetails: p.goalDetails,
        riskDetails: p.riskDetails,
      })),
      positionalStrength: enhanced.positionalStrength,
      rosterProfile: enhanced.rosterProfile,
      aiPlan,
      leagueDemandIndex: {
        tradesAnalyzed: ldi.tradesAnalyzed,
        positionDemand: ldi.positionDemand,
        hotPlayers: ldi.hotPlayers.slice(0, 8),
      },
      meta: {
        totalPlayers: enhanced.totalPlayers,
        userRosterSize: enhanced.userRosterSize,
        leagueName: league.name,
        leagueType,
        scoring: ppr === 1 ? 'PPR' : ppr === 0.5 ? 'Half PPR' : 'Standard',
        isSF,
        isTEP,
        numTeams,
        strategyMetaContext,
      },
    })
  } catch (error: any) {
    console.error('Enhanced rankings error:', error)
    return NextResponse.json({ error: error.message || 'Failed to compute rankings' }, { status: 500 })
  }
})
