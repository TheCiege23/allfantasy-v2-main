import { withApiUsage } from "@/lib/telemetry/usage"
import { getOpenAIRouteClient } from '@/lib/ai/openai-route-client'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { recordLlmUsage } from '@/lib/telemetry/llm-usage'
import { buildDynastyRoadmapPrompt } from '@/lib/rankings-engine/dynastyRoadmapPrompt'

const openai = getOpenAIRouteClient()

const ROADMAP_MODEL = 'gpt-4o'
const ROADMAP_MAX_TOKENS = 2000

interface RosterSignal {
  position: string
  playerName: string
  age: number | null
  marketValue: number
  impactScore: number
  trend30Day: number
}

interface RoadmapRequest {
  /** The league's sport (NFL when omitted, for older clients). */
  sport?: string
  leagueType: string
  isSF: boolean
  goal: string
  rosterSignals: RosterSignal[]
  avgAge: number
  totalValue: number
  positionStrengths: Record<string, number>
  weakPositions: string[]
  topAssets: string[]
  leagueName?: string
}

interface YearPlan {
  year: number
  label: string
  priorities: string[]
  targetPositions: string[]
  keyMoves: string[]
}

interface DynastyRoadmap {
  horizon: string
  currentPhase: string
  overallStrategy: string
  yearPlans: YearPlan[]
  riskFactors: string[]
  confidence: string
}

export const POST = withApiUsage({ endpoint: "/api/rankings/dynasty-roadmap", tool: "RankingsDynastyRoadmap" })(async (req: NextRequest) => {
  try {
    // Every input is caller-supplied (no league id to scope a membership check against), but this
    // reaches gpt-4o at up to 2000 completion tokens per call — it must not be callable anonymously.
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const userId = session.user.id

    // This is the most expensive endpoint in the group (gpt-4o at 2000 completion tokens), so the
    // session gate alone is not enough — bucket per authenticated user AND per IP.
    const rl = consumeRateLimit({
      scope: 'rankings',
      action: 'dynasty_roadmap',
      sleeperUsername: userId,
      ip: getClientIp(req),
      maxRequests: 10,
      windowMs: 60_000,
      includeIpInKey: true,
    })
    if (!rl.success) {
      return NextResponse.json(
        buildRateLimit429({ message: 'Too many requests. Please wait a moment and try again.', rl }),
        { status: 429 },
      )
    }

    const body: RoadmapRequest = await req.json()

    const {
      leagueType,
      isSF,
      goal,
      rosterSignals,
      avgAge,
      totalValue,
      positionStrengths,
      weakPositions,
      topAssets,
      leagueName,
      sport,
    } = body

    if (!rosterSignals || !Array.isArray(rosterSignals) || rosterSignals.length === 0) {
      return NextResponse.json({ error: 'Roster signals required' }, { status: 400 })
    }

    if (typeof avgAge !== 'number' || isNaN(avgAge)) {
      return NextResponse.json({ error: 'Valid avgAge required' }, { status: 400 })
    }

    if (typeof totalValue !== 'number' || isNaN(totalValue)) {
      return NextResponse.json({ error: 'Valid totalValue required' }, { status: 400 })
    }

    const agingAssets = rosterSignals.filter(p => (p.age ?? 25) >= 29).length
    const youngCore = rosterSignals.filter(p => (p.age ?? 25) <= 24).length
    const totalPlayers = rosterSignals.length
    const agingPct = totalPlayers > 0 ? Math.round((agingAssets / totalPlayers) * 100) : 0
    const youngPct = totalPlayers > 0 ? Math.round((youngCore / totalPlayers) * 100) : 0

    const posStrengthStr = Object.entries(positionStrengths)
      .map(([pos, str]) => `${pos}: ${str}/100`)
      .join(', ')

    const topAssetsStr = topAssets.slice(0, 5).join(', ')
    const weakPosStr = weakPositions.join(', ')

    const prompt = buildDynastyRoadmapPrompt({
      sport,
      leagueType,
      isSF,
      goal,
      leagueName,
      avgAge,
      totalValue,
      agingAssets,
      agingPct,
      youngCore,
      youngPct,
      posStrengthStr,
      weakPosStr,
      topAssetsStr,
      totalPlayers,
    })

    const response = await openai.chat.completions.create({
      model: ROADMAP_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: ROADMAP_MAX_TOKENS,
    })

    // This call path exposes the provider's usage block, so exact token spend is attributable.
    await recordLlmUsage({
      endpoint: '/api/rankings/dynasty-roadmap',
      tool: 'RankingsDynastyRoadmap',
      userId,
      model: ROADMAP_MODEL,
      usage: (response as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage,
      maxTokens: ROADMAP_MAX_TOKENS,
      ok: true,
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      return NextResponse.json({
        roadmap: buildFallbackRoadmap(avgAge, weakPositions, goal),
        source: 'fallback',
      })
    }

    let roadmap: DynastyRoadmap
    try {
      roadmap = JSON.parse(content)
    } catch {
      return NextResponse.json({
        roadmap: buildFallbackRoadmap(avgAge, weakPositions, goal),
        source: 'fallback',
      })
    }

    return NextResponse.json({
      roadmap,
      source: 'ai',
      model: 'gpt-4o',
    })
  } catch (err: any) {
    console.error('[Dynasty Roadmap] Error:', err?.message)
    return NextResponse.json(
      { error: 'Failed to generate dynasty roadmap' },
      { status: 500 },
    )
  }
})

function buildFallbackRoadmap(
  avgAge: number,
  weakPositions: string[],
  goal: string,
): DynastyRoadmap {
  const isOld = avgAge > 27
  const phase = isOld ? 'Retooling' : avgAge < 24 ? 'Emerging' : 'Contending'
  const horizon = isOld ? '3-Year Plan' : '5-Year Plan'

  const yearPlans: YearPlan[] = [
    {
      year: 1,
      label: `Year 1: ${isOld ? 'Retool & Compete' : 'Maximize Window'}`,
      priorities: [
        weakPositions.length > 0
          ? `Address ${weakPositions[0]} weakness via trades or waiver wire`
          : 'Maintain roster depth across all positions',
        goal === 'rebuild'
          ? 'Sell aging assets at peak value for future picks'
          : 'Target high-impact starters to strengthen lineup',
      ],
      targetPositions: weakPositions.slice(0, 2),
      keyMoves: [
        'Evaluate roster for buy-low opportunities',
        'Monitor trade market for undervalued assets',
      ],
    },
    {
      year: 2,
      label: 'Year 2: Build Depth',
      priorities: [
        'Develop young players acquired in year 1',
        'Continue addressing positional weaknesses',
      ],
      targetPositions: weakPositions.slice(0, 2),
      keyMoves: [
        'Target rookie draft picks for long-term value',
        'Trade overperforming veterans at peak value',
      ],
    },
    {
      year: 3,
      label: 'Year 3: Sustain & Evolve',
      priorities: [
        'Reassess core roster composition',
        'Plan for next contention window',
      ],
      targetPositions: [],
      keyMoves: [
        'Evaluate which aging assets to move',
        'Double down on young breakout candidates',
      ],
    },
  ]

  return {
    horizon,
    currentPhase: phase,
    overallStrategy: `With an average age of ${avgAge.toFixed(1)}, this roster is in a ${phase.toLowerCase()} phase. Focus on ${goal === 'rebuild' ? 'accumulating future assets' : 'maximizing current competitiveness'} while building sustainable depth.`,
    yearPlans,
    riskFactors: [
      isOld ? 'Aging roster may decline faster than expected' : 'Young roster may take time to develop',
      weakPositions.length > 0 ? `${weakPositions[0]} remains a critical weakness` : 'Maintaining balance across all positions is key',
    ],
    confidence: 'MEDIUM',
  }
}
