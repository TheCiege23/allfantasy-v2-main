import type { ChimmyFollowUpPrompt } from '@/lib/chimmy-chat/response-contract'
import type { ChimmyFollowUpSuggestion } from '@/lib/chimmy-orchestration/types'

export type ChimmyFollowUpChip = {
  label: string
  prompt: string
  portfolioState?: import('@/lib/chimmy/portfolio/types').PortfolioState
  origin: 'contract' | 'orchestration' | 'fallback'
}

type BuildSmartFollowUpChipsInput = {
  contractFollowUps?: ChimmyFollowUpPrompt[] | null
  orchestrationFollowUps?: ChimmyFollowUpSuggestion[] | null
  fallbackFollowUps?: ChimmyFollowUpChip[] | null
  limit?: number
}

function sanitizeChip(raw: { label: unknown; prompt: unknown } | null | undefined): ChimmyFollowUpChip | null {
  if (!raw) return null
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : ''
  if (!label || !prompt) return null
  return { label, prompt, origin: 'fallback' }
}

export function buildSmartFollowUpChips({
  contractFollowUps,
  orchestrationFollowUps,
  fallbackFollowUps,
  limit = 5,
}: BuildSmartFollowUpChipsInput): ChimmyFollowUpChip[] {
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5
  const orderedRaw = [
    ...(contractFollowUps ?? []).map((chip) => ({ ...chip, origin: 'contract' as const })),
    ...(orchestrationFollowUps ?? []).map((chip) => ({ ...chip, origin: 'orchestration' as const })),
    ...(fallbackFollowUps ?? []).map((chip) => ({ ...chip, origin: 'fallback' as const })),
  ]

  const seenPrompts = new Set<string>()
  const output: ChimmyFollowUpChip[] = []

  for (const raw of orderedRaw) {
    const chip = sanitizeChip(raw)
    if (!chip) continue
    if ((raw as { origin?: ChimmyFollowUpChip['origin'] })?.origin) {
      chip.origin = (raw as { origin: ChimmyFollowUpChip['origin'] }).origin
    }
    if (seenPrompts.has(chip.prompt)) continue
    seenPrompts.add(chip.prompt)
    output.push(chip)
    if (output.length >= max) break
  }

  return output
}
