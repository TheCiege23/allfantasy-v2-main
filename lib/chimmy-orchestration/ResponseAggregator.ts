import type { AIModelRole, ModelOutput } from '@/lib/unified-ai/types'
import { buildDeterministicSummaryLine } from './deterministic-layer'
import type { ChimmyAggregationResult, ChimmyConfidenceResult, ChimmyDeterministicLayer } from './types'

function firstUsableOutput(modelOutputs: ModelOutput[], preferredOrder: AIModelRole[]): ModelOutput | null {
  for (const model of preferredOrder) {
    const found = modelOutputs.find((output) => output.model === model && !output.skipped && !output.error && output.raw.trim().length > 0)
    if (found) return found
  }
  const fallback = modelOutputs.find((output) => !output.skipped && !output.error && output.raw.trim().length > 0)
  return fallback ?? null
}

function firstSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  const match = trimmed.match(/(.+?[.!?])(\s|$)/)
  return (match?.[1] ?? trimmed).slice(0, 220)
}

export function aggregateChimmyResponse(input: {
  deterministicLayer: ChimmyDeterministicLayer
  modelOutputs: ModelOutput[]
  confidence: ChimmyConfidenceResult
  preferredFinalModel: AIModelRole
}): ChimmyAggregationResult {
  const { deterministicLayer, modelOutputs, confidence, preferredFinalModel } = input
  /*
   * Claude first, whatever the router preferred (user decision 2026-09-23: Claude is Chimmy's main
   * model). The orchestrator only calls the legacy providers when Claude failed, so in practice a
   * usable Claude output is the only kind this ever has to choose over.
   */
  const legacyOrder: AIModelRole[] =
    preferredFinalModel === 'openai'
      ? ['openai', 'deepseek', 'grok']
      : preferredFinalModel === 'deepseek'
        ? ['deepseek', 'openai', 'grok']
        : ['grok', 'openai', 'deepseek']
  const preferredOrder: AIModelRole[] = ['anthropic', ...legacyOrder]

  const primary = firstUsableOutput(modelOutputs, preferredOrder)
  const deterministicSummary = buildDeterministicSummaryLine(deterministicLayer)
  const primaryText = primary?.raw?.trim()
  const primaryAnswer = primaryText
    ? primaryText
    : `Based on current deterministic inputs, ${firstSentence(deterministicSummary)}.`

  const factGuardWarnings = deterministicLayer.missingSections.length
    ? [
        `Missing deterministic sections: ${deterministicLayer.missingSections.join(', ')}`,
        'AI explanation is constrained to available deterministic evidence.',
      ]
    : undefined

  return {
    primaryAnswer,
    reason: `Chimmy aggregated calm-style synthesis (${confidence.reason}).`,
    factGuardWarnings,
  }
}
