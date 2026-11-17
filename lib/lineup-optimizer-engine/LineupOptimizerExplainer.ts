import { runCostControlledOpenAIText } from '@/lib/ai-cost-control'
import type { LineupOptimizerResult } from './types'

interface LineupOptimizerExplanation {
  summary: string
  bullets: string[]
  source: 'ai' | 'deterministic'
}

function deterministicExplanation(result: LineupOptimizerResult): LineupOptimizerExplanation {
  const topStarters = result.starters
    .slice(0, 3)
    .map((starter) => `${starter.playerName} (${starter.projectedPoints.toFixed(1)})`)
  const benchPivot = result.bench[0]
  const bullets = [
    ...result.deterministicNotes,
    topStarters.length > 0 ? `Top starters by projection: ${topStarters.join(', ')}.` : 'No starter projections were available.',
    benchPivot
      ? `First bench option is ${benchPivot.playerName} at ${benchPivot.projectedPoints.toFixed(1)} projected points.`
      : 'No bench alternatives were available.',
  ]

  return {
    summary:
      result.unfilledSlots.length > 0
        ? `Optimized lineup projects ${result.totalProjectedPoints.toFixed(1)} points with ${result.unfilledSlots.length} unfilled required slot(s).`
        : `Optimized lineup projects ${result.totalProjectedPoints.toFixed(1)} points.`,
    bullets,
    source: 'deterministic',
  }
}

export async function explainOptimizedLineup(input: {
  result: LineupOptimizerResult
  useAI?: boolean
}): Promise<LineupOptimizerExplanation> {
  const deterministic = deterministicExplanation(input.result)
  if (!input.useAI) return deterministic

  const ai = await runCostControlledOpenAIText({
    feature: 'lineup_optimizer_explanation',
    enableAI: true,
    fallbackText: null,
    cacheTtlMs: 4 * 60 * 1000,
    repeatCooldownMs: 10 * 1000,
    cacheContext: {
      totalProjectedPoints: input.result.totalProjectedPoints,
      starters: input.result.starters.map((item) => ({
        slotCode: item.slotCode,
        playerName: item.playerName,
        projectedPoints: item.projectedPoints,
      })),
      bench: input.result.bench.slice(0, 5).map((item) => ({
        playerName: item.playerName,
        projectedPoints: item.projectedPoints,
      })),
      unfilled: input.result.unfilledSlots.map((slot) => slot.slotCode),
    },
    messages: [
      {
        role: 'system',
        content:
          'You explain fantasy lineup optimization decisions. Never alter deterministic output. Keep it concise.',
      },
      {
        role: 'user',
        content: [
          'Explain this deterministic lineup optimization result in plain language.',
          `Total projected points: ${input.result.totalProjectedPoints.toFixed(1)}`,
          `Starters: ${input.result.starters
            .map((starter) => `${starter.slotCode} ${starter.playerName} (${starter.projectedPoints.toFixed(1)})`)
            .join(' | ')}`,
          `Bench: ${input.result.bench
            .slice(0, 5)
            .map((benchPlayer) => `${benchPlayer.playerName} (${benchPlayer.projectedPoints.toFixed(1)})`)
            .join(' | ')}`,
          `Unfilled: ${input.result.unfilledSlots.map((slot) => slot.slotCode).join(', ') || 'none'}`,
          'Respond with JSON only: {"summary":"...","bullets":["...","...","..."]}',
        ].join('\n'),
      },
    ],
    temperature: 0.25,
    maxTokens: 250,
  })

  if (!ai.ok || !ai.text?.trim()) return deterministic

  try {
    const cleaned = ai.text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()
    const parsed = JSON.parse(cleaned) as { summary?: unknown; bullets?: unknown }
    const summary =
      typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : deterministic.summary
    const bullets = Array.isArray(parsed.bullets)
      ? parsed.bullets
          .filter((line): line is string => typeof line === 'string')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 5)
      : deterministic.bullets

    return {
      summary,
      bullets: bullets.length > 0 ? bullets : deterministic.bullets,
      source: 'ai',
    }
  } catch {
    return deterministic
  }
}
