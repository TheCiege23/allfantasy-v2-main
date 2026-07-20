import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeLeagueRankingsV2 } from '@/lib/rankings-engine/league-rankings-v2'
import { resolveLegacyLeagueAccess } from '@/lib/legacy/assertLegacyLeagueAccess'
import { openaiChatText } from '@/lib/openai-client'
import { getCompositeWeightConfig } from '@/lib/rankings-engine/composite-weights'
import { buildRateLimit429, consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { recordLlmUsage } from '@/lib/telemetry/llm-usage'

type SessionUser = { user?: { id?: string } } | null

const COACH_MAX_TOKENS = 400

export const GET = withApiUsage({ endpoint: "/api/rankings/league-v2", tool: "RankingsLeagueV2" })(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const leagueId = searchParams?.get('leagueId')
  const weekParam = searchParams?.get('week')

  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  // `leagueId` here is a Sleeper league id (see computeLeagueRankingsV2 → LegacyLeague.sleeperLeagueId),
  // so membership resolves through the legacy import graph, not prisma.league.
  const session = (await getServerSession(authOptions as any)) as SessionUser
  const access = await resolveLegacyLeagueAccess(leagueId, session?.user?.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Authentication required' : 'Forbidden' },
      { status: access.status },
    )
  }

  const week = weekParam ? parseInt(weekParam, 10) : undefined

  try {
    const rankings = await computeLeagueRankingsV2(leagueId, week)
    if (!rankings) {
      return NextResponse.json({ error: 'League not found or no data' }, { status: 404 })
    }

    return NextResponse.json(rankings)
  } catch (err: any) {
    console.error('[League Rankings V2] Error:', err?.message || err, err?.stack?.slice(0, 500))
    return NextResponse.json(
      { error: 'Failed to compute league rankings', detail: err?.message || String(err) },
      { status: 500 },
    )
  }
})

function computeModelConfidence(team: any, leagueContext: any): { score: number; rating: 'HIGH' | 'MEDIUM' | 'LEARNING'; factors: string[] } {
  const factors: string[] = []
  let score = 50

  const week = leagueContext?.week ?? 0
  if (week >= 10) {
    score += 20
    factors.push(`${week} weeks of data (strong sample)`)
  } else if (week >= 5) {
    score += 10
    factors.push(`${week} weeks of data (moderate sample)`)
  } else if (week >= 1) {
    score += 3
    factors.push(`${week} weeks of data (early season)`)
  } else {
    factors.push('Pre-season projection only')
  }

  const driverCount = team.explanation?.drivers?.length ?? 0
  if (driverCount >= 3) {
    score += 10
    factors.push(`${driverCount} scoring drivers identified`)
  } else if (driverCount >= 1) {
    score += 5
    factors.push(`${driverCount} scoring driver(s) identified`)
  } else {
    factors.push('No scoring drivers available')
  }

  const confFromExplanation = team.explanation?.confidence?.score
  if (typeof confFromExplanation === 'number') {
    score += Math.round(confFromExplanation * 15)
    factors.push(`Engine confidence: ${Math.round(confFromExplanation * 100)}%`)
  }

  const hasPower = typeof team.powerScore === 'number' && team.powerScore > 0
  const hasWin = typeof team.winScore === 'number'
  const hasMarket = typeof team.marketValueScore === 'number' && team.marketValueScore > 0
  const dimensionCount = [hasPower, hasWin, hasMarket].filter(Boolean).length
  score += dimensionCount * 3

  score = Math.max(10, Math.min(95, score))
  const rating: 'HIGH' | 'MEDIUM' | 'LEARNING' = score >= 70 ? 'HIGH' : score >= 45 ? 'MEDIUM' : 'LEARNING'

  return { score, rating, factors }
}

function computeDataFreshness(leagueContext: any, computedAt?: number): { grade: string; ageHours: number; sources: Record<string, string> } {
  const now = Date.now()
  const age = computedAt ? now - computedAt : 0
  const ageHours = Math.round(age / (1000 * 60 * 60) * 10) / 10

  let grade: string
  if (ageHours <= 1) grade = 'fresh'
  else if (ageHours <= 6) grade = 'recent'
  else if (ageHours <= 24) grade = 'aging'
  else if (ageHours <= 72) grade = 'stale'
  else grade = 'expired'

  const week = leagueContext?.week ?? 0
  const sources: Record<string, string> = {
    rankings: grade,
    valuations: week > 0 ? (ageHours <= 24 ? 'fresh' : 'aging') : 'unavailable',
    matchups: week >= 1 ? 'fresh' : 'unavailable',
    injuries: ageHours <= 12 ? 'fresh' : ageHours <= 48 ? 'aging' : 'stale',
  }

  return { grade, ageHours, sources }
}

export const POST = withApiUsage({ endpoint: "/api/rankings/league-v2", tool: "RankingsLeagueV2" })(async (request: NextRequest) => {
  try {
    // Callers post their own already-computed team/leagueContext (no league id in the body), so
    // there is nothing to scope a membership check against — but this reaches a paid LLM, so it
    // must not be callable anonymously.
    const session = (await getServerSession(authOptions as any)) as SessionUser
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const userId = session.user.id

    // Bucket per authenticated user AND per IP: a session gate alone still lets one signup (or one
    // script cycling free signups from a host) burn unbounded model spend. `sleeperUsername` is
    // consumeRateLimit's user-key parameter — the name is legacy, the value is any stable user id.
    const rl = consumeRateLimit({
      scope: 'rankings',
      action: 'ai_coach',
      sleeperUsername: userId,
      ip: getClientIp(request),
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

    const body = await request.json()
    const { team, leagueContext } = body

    if (!team || !leagueContext) {
      return NextResponse.json({ error: 'team and leagueContext required' }, { status: 400 })
    }

    const weightConfig = await getCompositeWeightConfig()
    const confidence = computeModelConfidence(team, leagueContext)
    const freshness = computeDataFreshness(leagueContext, leagueContext.computedAt)

    const modelMeta = {
      confidence,
      dataFreshness: freshness,
      weightVersion: weightConfig.version,
      weightCalibratedAt: weightConfig.calibratedAt,
    }

    const explanationDrivers = team.explanation?.drivers || []
    const driversText = explanationDrivers
      .map((d: any) => {
        const label = d.id?.replace(/_/g, ' ') || 'unknown'
        const polarity = d.polarity === 'UP' ? '+' : d.polarity === 'DOWN' ? '-' : '~'
        const evidenceStr = d.evidence ? Object.entries(d.evidence).map(([k, v]) => `${k}=${v}`).join(', ') : ''
        return `- [${polarity}] ${label} (impact ${Math.round((d.impact || 0) * 100)}%)${evidenceStr ? `: ${evidenceStr}` : ''}`
      })
      .join('\n')

    const prompt = `You are an AI fantasy sports coach. Given the structured data below, write a brief motivational analysis (3 bullets + 1 challenge). Be honest, cite the specific scores, never invent stats. Highlight strengths first, then one improvement opportunity. Never say "you suck" — instead say "here's the lever."

Team: ${team.displayName || team.username} (Rank #${team.rank})
Record: ${team.record.wins}-${team.record.losses}${team.record.ties > 0 ? `-${team.record.ties}` : ''}
Rank Movement: ${team.rankDelta !== null ? (team.rankDelta > 0 ? `Up ${team.rankDelta}` : team.rankDelta < 0 ? `Down ${Math.abs(team.rankDelta)}` : 'No change') : 'First week'}
Composite Score: ${team.composite}/100

Scores:
- Power Score: ${team.powerScore}/100
- Win Score: ${team.winScore}/100
- Luck Score: ${team.luckScore}/100
- Market Value: ${team.marketValueScore}/100
- Manager Skill: ${team.managerSkillScore}/100

Expected Wins: ${team.expectedWins?.toFixed(1)} (Actual: ${team.record.wins})
Streak: ${team.streak > 0 ? `${team.streak}W` : team.streak < 0 ? `${Math.abs(team.streak)}L` : 'None'}

Key Drivers:
${driversText || 'None identified'}

League Context:
- Dynasty: ${leagueContext.isDynasty ? 'Yes' : 'No'}
- Superflex: ${leagueContext.isSuperFlex ? 'Yes' : 'No'}
- Week: ${leagueContext.week}
- Phase: ${leagueContext.phase}

Format your response as JSON with this exact structure:
{
  "bullets": ["string", "string", "string"],
  "challenge": "string",
  "tone": "motivational" | "cautious" | "celebration"
}`

    const result = await openaiChatText({
      messages: [
        { role: 'system', content: 'You are AllFantasy AI Coach. Respond with valid JSON only. No markdown, no code blocks.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      maxTokens: COACH_MAX_TOKENS,
    })

    // openaiChatText resolves to {ok, text, model, baseUrl} and does not surface the provider's
    // usage block, so meter the call against its configured ceiling rather than exact counts.
    await recordLlmUsage({
      endpoint: '/api/rankings/league-v2',
      tool: 'RankingsLeagueV2',
      userId,
      model: result.model,
      maxTokens: COACH_MAX_TOKENS,
      ok: result.ok,
    })

    if (!result.ok) {
      return NextResponse.json({
        bullets: [
          `Ranked #${team.rank} with a composite score of ${team.composite}/100.`,
          `Power Score ${team.powerScore} | Win Score ${team.winScore} | Luck ${team.luckScore}.`,
          team.expectedWins > team.record.wins
            ? `You're ${(team.expectedWins - team.record.wins).toFixed(1)} expected wins better than your record shows — keep pushing.`
            : `Your record matches your performance — stay consistent.`,
        ],
        challenge: 'Focus on improving your weakest scoring dimension this week.',
        tone: 'motivational',
        modelMeta,
      })
    }

    try {
      const cleaned = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const parsed = JSON.parse(cleaned)
      return NextResponse.json({
        bullets: parsed.bullets || [],
        challenge: parsed.challenge || '',
        tone: parsed.tone || 'motivational',
        modelMeta,
      })
    } catch {
      return NextResponse.json({
        bullets: [result.text.slice(0, 200)],
        challenge: '',
        tone: 'motivational',
        modelMeta,
      })
    }
  } catch (err: any) {
    console.error('[AI Coach] Error:', err?.message || err)
    return NextResponse.json(
      { error: 'AI Coach failed' },
      { status: 500 },
    )
  }
})

