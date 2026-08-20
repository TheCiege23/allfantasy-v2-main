/**
 * AI-generated forecast summary (OpenAI: readable narrative from simulation outputs).
 */

import { NextRequest, NextResponse } from 'next/server'
import { openaiChatText } from '@/lib/openai-client'
import { getInsightBundle } from '@/lib/ai-simulation-integration'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

type TeamForecast = {
  teamId: string
  teamName?: string
  playoffProbability: number
  firstPlaceProbability: number
  championshipProbability: number
  expectedWins: number
  expectedFinalSeed: number
  finishRange: { min: number; max: number }
  eliminationRisk: number
  confidenceScore: number
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await ctx.params
  // Membership gate. Reachable both directly and via the [section]
  // dispatcher, and was open to anyone holding a league id.
  const gate = await requireLeagueApiAccess(leagueId)
  if (!gate.ok) return gate.response
  let body: { season?: number; week?: number; teamForecasts?: TeamForecast[] } = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {}

  const forecasts = body.teamForecasts ?? []
  if (!forecasts.length) {
    return NextResponse.json({ error: 'teamForecasts required' }, { status: 400 })
  }

  const sorted = [...forecasts].sort(
    (a, b) => b.championshipProbability - a.championshipProbability
  )
  const top = sorted.slice(0, 5)
  const bubble = forecasts.filter(
    (t) => t.playoffProbability >= 20 && t.playoffProbability <= 80
  )
  const insightBundle = await getInsightBundle(leagueId, 'playoff', {
    season: body.season,
    week: body.week,
  }).catch(() => null)

  const summaryInput = `
Season: ${body.season ?? 'current'}, Week: ${body.week ?? 'current'}
Top contenders (championship %): ${top.map((t) => `${t.teamName ?? t.teamId}: ${t.championshipProbability.toFixed(1)}%`).join(', ')}
Bubble teams (playoff prob 20–80%): ${bubble.map((t) => `${t.teamName ?? t.teamId}: ${t.playoffProbability.toFixed(0)}%`).join(', ') || 'None'}
Playoff odds range: ${Math.min(...forecasts.map((t) => t.playoffProbability)).toFixed(0)}% – ${Math.max(...forecasts.map((t) => t.playoffProbability)).toFixed(0)}%
${insightBundle?.contextText ? `\nSimulation/Warehouse context:\n${insightBundle.contextText}` : ''}
  `.trim()

  try {
    const result = await openaiChatText({
      messages: [
        {
          role: 'system',
          content:
            `You are a concise fantasy sports analyst. In 2-4 sentences, summarize the playoff race: who is in the driver's seat, who is on the bubble, and one notable takeaway. Use percentages only when they add clarity. Be neutral and factual.
Model role context:
- DeepSeek: ${insightBundle?.modelResponsibilities.deepseek ?? 'quant modeling'}
- Grok: ${insightBundle?.modelResponsibilities.grok ?? 'trend framing'}
- OpenAI: ${insightBundle?.modelResponsibilities.openai ?? 'user-facing explanation'}.`,
        },
        {
          role: 'user',
          content: `Based on this simulation forecast, write a short weekly playoff race summary.\n\n${summaryInput}`,
        },
      ],
      temperature: 0.5,
      maxTokens: 280,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: 'AI summary failed', detail: result.details },
        { status: 502 }
      )
    }

    return NextResponse.json({
      summary: result.text.trim(),
      leagueId,
      season: body.season,
      week: body.week,
    })
  } catch (e) {
    console.error('[forecast-summary]', e)
    return NextResponse.json(
      { error: 'Failed to generate summary' },
      { status: 500 }
    )
  }
}
