/**
 * Tournament AI service: generate explanations, announcements, recaps from deterministic context only.
 * AI never decides outcomes. PROMPT 4.
 */

import { createHash } from 'crypto'
import { openaiChatText } from '@/lib/openai-client'
import { buildTournamentAIPrompt, type TournamentAIType } from './TournamentAIPrompts'

interface TournamentAIResult {
  text: string
  model?: string
  ok: boolean
  error?: string
}

export function buildTournamentAiCacheContextSummary(context: string): Record<string, unknown> {
  const normalized = context.trim()
  return {
    contextLength: normalized.length,
    contextHash: createHash('sha256').update(normalized).digest('hex'),
    contextHead: normalized.slice(0, 600),
    contextTail: normalized.slice(-300),
  }
}

/**
 * Generate AI text for the given type using deterministic context.
 * Context must be built by the caller from tournament/standings/bracket data.
 */
export async function generateTournamentAI(
  type: TournamentAIType,
  context: string,
  options?: { roundIndex?: number; announcementType?: string }
): Promise<TournamentAIResult> {
  const { system, user } = buildTournamentAIPrompt(type, context, options)
  try {
    const res = await openaiChatText({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.5,
      maxTokens: 600,
    })
    if (res.ok) {
      return { text: res.text.trim(), model: res.model, ok: true }
    }
    return { text: '', ok: false, error: res.details }
  } catch (e) {
    const err = e instanceof Error ? e.message : 'Unknown error'
    return { text: '', ok: false, error: err }
  }
}
