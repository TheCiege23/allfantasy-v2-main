/**
 * AIDramaNarrativeAdapter — optional AI-generated narrative summary for a drama event.
 * Can be extended to call OpenAI/DeepSeek for "Tell me the story" responses.
 */

import type { DramaEventView } from './DramaTimelineBuilder'
import { openaiChatText } from '@/lib/openai-client'

export interface DramaNarrativeResult {
  narrative: string
  source: 'template' | 'ai'
}

/**
 * The fact-built narrative: the event's own headline, summary, managers and score, no model. Served on its
 * own when the league's AI write-ups are locked or capped (lib/league-story-ai/leagueStoryAiGate.ts).
 */
export function buildTemplateNarrative(event: DramaEventView): DramaNarrativeResult {
  const parts: string[] = []
  parts.push(event.headline)
  if (event.summary) parts.push(event.summary)
  if (event.relatedManagerIds.length > 0) {
    parts.push(`Involving: ${event.relatedManagerIds.slice(0, 4).join(', ')}.`)
  }
  parts.push(`Drama score: ${event.dramaScore.toFixed(0)}/100.`)
  return {
    narrative: parts.join(' '),
    source: 'template',
  }
}

/**
 * Produce a short narrative for the drama event.
 * Uses AI when configured and falls back to deterministic template text.
 */
export async function buildDramaNarrative(event: DramaEventView): Promise<DramaNarrativeResult> {
  const fallback = buildTemplateNarrative(event)
  const ai = await openaiChatText({
    messages: [
      {
        role: 'system',
        content:
          'You are a fantasy league storyteller. Write a concise 3-5 sentence storyline in energetic but factual tone. End with one forward-looking hook.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          dramaType: event.dramaType,
          headline: event.headline,
          summary: event.summary,
          sport: event.sport,
          season: event.season,
          relatedManagerIds: event.relatedManagerIds,
          relatedTeamIds: event.relatedTeamIds,
          relatedMatchupId: event.relatedMatchupId,
          dramaScore: event.dramaScore,
        }),
      },
    ],
    temperature: 0.55,
    maxTokens: 260,
  }).catch(() => null)
  if (ai?.ok && ai.text?.trim()) {
    return {
      narrative: ai.text.trim(),
      source: 'ai',
    }
  }
  return fallback
}
