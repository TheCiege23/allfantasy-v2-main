import { runCostControlledOpenAIText } from '@/lib/ai-cost-control'
import type { PremiumLineupDecisionJson } from './build-premium-lineup-decision'

interface LineupDecisionExplanation {
  summary: string
  bullets: string[]
  source: 'ai' | 'deterministic'
  /** Strict JSON echoed for clients that want the same payload the model saw */
  decisionJson: PremiumLineupDecisionJson
}

function deterministicExplanation(json: PremiumLineupDecisionJson): LineupDecisionExplanation {
  const top = json.optimizedLineup.slice(0, 3).map((r) => `${r.playerName} (${r.weeklyStartScore.toFixed(1)})`)
  return {
    summary: `${json.lineupMode}: ${json.teamContext.strategyRecommendation}`,
    bullets: [
      top.length ? `Priority starters by Weekly Start Score: ${top.join(', ')}.` : 'No starters computed.',
      ...json.alerts.slice(0, 2),
      json.autoSubPreview.length
        ? `Injury-only auto-sub preview: ${json.autoSubPreview.length} potential emergency swap(s).`
        : 'No inactive starters detected for auto-sub preview.',
    ],
    source: 'deterministic',
    decisionJson: json,
  }
}

export async function explainLineupDecisionEngine(input: {
  json: PremiumLineupDecisionJson
  useAI?: boolean
}): Promise<LineupDecisionExplanation> {
  const det = deterministicExplanation(input.json)
  if (!input.useAI) return det

  const ai = await runCostControlledOpenAIText({
    feature: 'lineup_decision_engine_explanation',
    enableAI: true,
    fallbackText: null,
    cacheTtlMs: 3 * 60 * 1000,
    repeatCooldownMs: 12 * 1000,
    cacheContext: {
      mode: input.json.lineupMode,
      starters: input.json.optimizedLineup.length,
    },
    messages: [
      {
        role: 'system',
        content: [
          'You are Chimmy, a calm fantasy co-manager.',
          'You MUST ground every claim in the provided JSON. Never invent injuries, statuses, or projections.',
          'Explain WHY starters/sits follow from Weekly Start Score, mode, matchup/usage/health CONTEXT in the JSON, and team strategy.',
          'Call out floor vs ceiling vs volatility when those fields support it.',
          'If autoSubPreview is non-empty, explain that swaps are injury/inactive-only and roster-legal.',
          'Never recommend swapping a healthy starter for optimization reasons.',
          'Respond with JSON only: {"summary":"string","bullets":["string","string","string","string"]}',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify(input.json),
      },
    ],
    temperature: 0.2,
    maxTokens: 450,
  })

  if (!ai.ok || !ai.text?.trim()) return det

  try {
    const cleaned = ai.text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()
    const parsed = JSON.parse(cleaned) as { summary?: unknown; bullets?: unknown }
    const summary =
      typeof parsed.summary === 'string' && parsed.summary.trim().length > 0 ? parsed.summary.trim() : det.summary
    const bullets = Array.isArray(parsed.bullets)
      ? parsed.bullets
          .filter((line): line is string => typeof line === 'string')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 6)
      : det.bullets

    return {
      summary,
      bullets: bullets.length > 0 ? bullets : det.bullets,
      source: 'ai',
      decisionJson: input.json,
    }
  } catch {
    return det
  }
}
