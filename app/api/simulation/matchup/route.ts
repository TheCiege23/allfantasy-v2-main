import { withPaidToolBilling, paidToolNotDelivered } from '@/lib/tokens/paidToolBilling'
/**
 * Matchup simulation API — deterministic, lineup-aware simulation output with optional AI overlays.
 *
 * Lineup slots may include `projectedStats` (raw stat projections). When `leagueId` is set, the server
 * converts those lines to fantasy points using `resolveScoringRulesForLeague` before Monte Carlo
 * (`runMatchupSimulation` → `applyLeagueScoringToMatchupInput`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { runMatchupSimulation } from '@/lib/simulation-engine/MatchupSimulator'
import { getDefaultScoreStdDev } from '@/lib/simulation-engine/SportSimulationResolver'
import { percentiles } from '@/lib/simulation-engine/ScoreDistributionModel'
import { getMatchupSimulationInsight } from '@/lib/simulation-engine/MatchupSimulationInsightAI'
import { authOptions } from '@/lib/auth'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import {
  predictMatchupDeterministic,
  type MatchupPredictionScoringRulesInput,
} from '@/lib/matchup-prediction-engine'
import { generateMatchupStory } from '@/lib/matchup-story-engine'
import type {
  MatchupLineupSlotInput,
  MatchupScheduleFactorsInput,
} from '@/lib/simulation-engine/types'

type MatchupRequestBody = {
  teamA?: {
    mean?: number
    stdDev?: number
    teamId?: string
    lineup?: MatchupLineupSlotInput[]
    scheduleFactors?: MatchupScheduleFactorsInput
  }
  teamB?: {
    mean?: number
    stdDev?: number
    teamId?: string
    lineup?: MatchupLineupSlotInput[]
    scheduleFactors?: MatchupScheduleFactorsInput
  }
  teamAName?: string
  teamBName?: string
  iterations?: number
  sport?: string
  leagueId?: string
  weekOrPeriod?: number
  persist?: boolean
  includeInsights?: boolean
  includeStoryNarrative?: boolean
  confirmTokenSpend?: boolean
  scoringRules?: MatchupPredictionScoringRulesInput
  deterministicSeed?: string
}

async function paidToolPost(req: NextRequest) {
  let body: MatchupRequestBody = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {}

  const hasLineupA = Array.isArray(body.teamA?.lineup) && body.teamA!.lineup!.length > 0
  const hasLineupB = Array.isArray(body.teamB?.lineup) && body.teamB!.lineup!.length > 0
  const meanA = Number(body.teamA?.mean ?? NaN)
  const meanB = Number(body.teamB?.mean ?? NaN)

  if ((!Number.isFinite(meanA) && !hasLineupA) || (!Number.isFinite(meanB) && !hasLineupB)) {
    return NextResponse.json(
      { error: 'teamA/teamB must include a mean or lineup slots' },
      { status: 400 }
    )
  }

  const sport = body.sport ?? 'NFL'
  const weekOrPeriod = Number(body.weekOrPeriod) || 1
  const persist = Boolean(body.persist && body.leagueId)
  const teamAName = String(body.teamAName ?? body.teamA?.teamId ?? 'Team A')
  const teamBName = String(body.teamBName ?? body.teamB?.teamId ?? 'Team B')
  const includeInsights = Boolean(body.includeInsights)
  let tokenFallbackSpend:
    | {
        id: string
        cost: number
        ruleCode: string
      }
    | null = null

  if (includeInsights) {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string; email?: string | null }
    } | null
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Sign in and upgrade to AF Pro for matchup AI explanations.',
        },
        { status: 401 }
      )
    }

    const gate = await requireFeatureEntitlement({
      userId: session.user.id,
      userEmail: session.user.email,
      featureId: 'matchup_explanations',
      allowTokenFallback: true,
      confirmTokenSpend: Boolean(body.confirmTokenSpend),
      tokenRuleCode: 'ai_matchup_explanation_single',
      tokenSourceType: 'matchup_simulation_ai_explanation',
      tokenSourceId: `${body.leagueId ?? 'matchup'}:${weekOrPeriod}:${Date.now()}`,
      tokenDescription: 'Matchup simulation AI explanation fallback',
      tokenMetadata: {
        leagueId: body.leagueId ?? null,
        sport,
        weekOrPeriod,
      },
    })
    if (!gate.ok) return gate.response
    if (gate.tokenSpend) {
      tokenFallbackSpend = {
        id: gate.tokenSpend.id,
        cost: Math.abs(gate.tokenSpend.tokenDelta),
        ruleCode: gate.tokenSpend.spendRuleCode ?? 'ai_matchup_explanation_single',
      }
    }
  }

  try {
    const out = await runMatchupSimulation(
      {
        sport,
        leagueId: body.leagueId,
        weekOrPeriod,
        deterministicSeed: body.deterministicSeed,
        teamA: {
          mean: Number.isFinite(meanA) ? meanA : undefined,
          stdDev: body.teamA?.stdDev,
          teamId: body.teamA?.teamId,
          lineup: body.teamA?.lineup,
          scheduleFactors: body.teamA?.scheduleFactors,
        },
        teamB: {
          mean: Number.isFinite(meanB) ? meanB : undefined,
          stdDev: body.teamB?.stdDev,
          teamId: body.teamB?.teamId,
          lineup: body.teamB?.lineup,
          scheduleFactors: body.teamB?.scheduleFactors,
        },
        iterations: body.iterations,
      },
      { persist }
    )

    const sortedA = [...(out.scoreDistributionA ?? [])].sort((scoreA, scoreB) => scoreA - scoreB)
    const sortedB = [...(out.scoreDistributionB ?? [])].sort((scoreA, scoreB) => scoreA - scoreB)
    const [a10, a90] = sortedA.length
      ? percentiles(sortedA, [10, 90])
      : [
          Math.max(0, out.expectedScoreA - getDefaultScoreStdDev(sport)),
          out.expectedScoreA + getDefaultScoreStdDev(sport),
        ]
    const [b10, b90] = sortedB.length
      ? percentiles(sortedB, [10, 90])
      : [
          Math.max(0, out.expectedScoreB - getDefaultScoreStdDev(sport)),
          out.expectedScoreB + getDefaultScoreStdDev(sport),
        ]

    const responseBody: Record<string, unknown> = {
      simulationId: out.simulationId ?? null,
      createdAt: out.createdAt ?? null,
      winProbabilityA: out.winProbabilityA,
      winProbabilityB: out.winProbabilityB,
      marginMean: out.marginMean,
      marginStdDev: out.marginStdDev,
      projectedScoreA: out.expectedScoreA,
      projectedScoreB: out.expectedScoreB,
      scoreRangeA: [Math.round(a10 * 10) / 10, Math.round(a90 * 10) / 10] as [number, number],
      scoreRangeB: [Math.round(b10 * 10) / 10, Math.round(b90 * 10) / 10] as [number, number],
      upsetChance: out.upsetChance,
      volatilityTag: out.volatilityTag,
      iterations: out.iterations,
      upsideScenario: out.upsideScenario ?? null,
      downsideScenario: out.downsideScenario ?? null,
      scoreDistributionA: out.scoreDistributionA ?? null,
      scoreDistributionB: out.scoreDistributionB ?? null,
      teamSummaryA: out.teamSummaryA ?? null,
      teamSummaryB: out.teamSummaryB ?? null,
      slotComparisons: out.slotComparisons ?? null,
      deterministicSeed: out.deterministicSeed ?? null,
    }

    responseBody.prediction = predictMatchupDeterministic({
      sport,
      projectedScoreA: out.expectedScoreA,
      projectedScoreB: out.expectedScoreB,
      stdDevA: out.teamSummaryA?.derivedStdDev ?? body.teamA?.stdDev ?? getDefaultScoreStdDev(sport),
      stdDevB: out.teamSummaryB?.derivedStdDev ?? body.teamB?.stdDev ?? getDefaultScoreStdDev(sport),
      scoringRules: body.scoringRules,
    })

    if (includeInsights) {
      const providerInsights = await getMatchupSimulationInsight(
        {
          ...out,
          scoreRangeA: responseBody.scoreRangeA as [number, number],
          scoreRangeB: responseBody.scoreRangeB as [number, number],
        },
        teamAName,
        teamBName
      ).catch(() => null)

      if (providerInsights) {
        responseBody.providerInsights = providerInsights
        if (!providerInsights.aiUsed) paidToolNotDelivered()
      } else { paidToolNotDelivered() }
    }
    if (tokenFallbackSpend) {
      responseBody.tokenFallbackSpend = tokenFallbackSpend
    }

    if (body.includeStoryNarrative) {
      const storyResult = await generateMatchupStory({
        sport,
        teamAName,
        teamBName,
        projectedScoreA: out.expectedScoreA,
        projectedScoreB: out.expectedScoreB,
        winProbabilityA: out.winProbabilityA,
        winProbabilityB: out.winProbabilityB,
        upsetChance: out.upsetChance,
        volatilityTag: out.volatilityTag,
      })

      if (storyResult.ok) {
        responseBody.storyNarrative = {
          text: storyResult.narrative,
          source: storyResult.source,
          model: storyResult.model,
        }
      } else {
        responseBody.storyNarrative = null
      }
    }

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('[simulation/matchup]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Simulation failed' },
      { status: 500 }
    )
  }
}

export const POST = withPaidToolBilling(paidToolPost)
