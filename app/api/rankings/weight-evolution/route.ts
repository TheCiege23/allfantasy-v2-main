import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { getWeightEvolution, blendMultiYearWeights, getBaselineWeights, resolveLeagueClass } from '@/lib/rankings-engine/adaptive-weight-learning'

export const GET = withApiUsage({ endpoint: "/api/rankings/weight-evolution", tool: "RankingsWeightEvolution" })(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams
  const leagueType = sp?.get('leagueType') ?? 'redraft'
  const isSF = sp?.get('isSF') === 'true'
  const specialty = sp?.get('specialty') ?? null

  const leagueClass = resolveLeagueClass({
    leagueType,
    specialtyFormat: specialty,
    isSF,
  })

  const evolution = await getWeightEvolution(leagueClass)
  const baseline = getBaselineWeights(leagueClass)
  const blended = evolution.length > 0
    ? blendMultiYearWeights(evolution, 3)
    : baseline

  return NextResponse.json({
    leagueClass,
    baseline,
    blended,
    seasons: evolution,
  })
})

