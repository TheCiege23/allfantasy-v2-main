/**
 * Commissioner Narrative Adapter — Phase 10.
 *
 * The ONLY module in this shared service allowed to touch AI, and only for
 * tone/phrasing — never facts. Reuses lib/ai-explanation-layer's
 * explainDeterministicOutput() directly (the established deterministic→AI
 * boundary pattern already used by Draft OS in Phase 8) rather than adding a
 * 5th bespoke narrative-adapter implementation (the audit found ~4 already:
 * AIHallOfFameNarrativeAdapter, AIDramaNarrativeAdapter, StoryFactGuard/
 * OneBrainNarrativeComposer, MatchupStoryEngine).
 *
 * The deterministic fallback text (always used when AI is unavailable, and
 * always the ground truth for `strictNumericGrounding`) is built directly
 * from CommissionerBrief's own already-selected facts — this module never
 * invents a score, record, trade, injury, standing, quote, or accusation.
 *
 * Character limits are honest estimates for common surfaces, not verified
 * against each provider's real API limit in this pass — documented as such.
 */

import { explainDeterministicOutput } from '@/lib/ai-explanation-layer'
import type { CommissionerBrief, CommissionerNarrativeOutput, NarrativeFormat, NarrativeTone } from './types'

const CHARACTER_LIMITS: Record<NarrativeFormat, number | null> = {
  concise_chat: 280,
  full_brief: null,
  discord: 2000,
  sleeper: 500,
  espn_yahoo_copy: 1000,
}

function buildDeterministicText(brief: CommissionerBrief, format: NarrativeFormat): string {
  const overview = brief.sections.find((s) => s.key === 'league_overview')
  const actions = brief.sections.find((s) => s.key === 'commissioner_actions')

  if (format === 'concise_chat') {
    return overview?.facts[0] ?? `League ${brief.leagueId} brief for week ${brief.week}.`
  }

  if (format === 'sleeper') {
    return [overview?.facts.join(' ') ?? '', actions?.facts[0] ?? ''].filter(Boolean).join(' ')
  }

  const lines = brief.sections.flatMap((s) => [`${s.title}:`, ...s.facts.map((f) => `- ${f}`)])
  return lines.join('\n')
}

function truncate(text: string, limit: number | null): string {
  if (limit == null || text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1))}…`
}

export interface BuildCommissionerNarrativeInput {
  brief: CommissionerBrief
  format: NarrativeFormat
  tone: NarrativeTone
  useAi?: boolean
}

export async function buildCommissionerNarrative(input: BuildCommissionerNarrativeInput): Promise<CommissionerNarrativeOutput> {
  const limit = CHARACTER_LIMITS[input.format]
  const deterministicText = truncate(buildDeterministicText(input.brief, input.format), limit)

  if (!input.useAi) {
    return { format: input.format, tone: input.tone, text: deterministicText, aiGenerated: false, characterCount: deterministicText.length, characterLimit: limit }
  }

  // An AI failure (thrown error, not just an honest 'deterministic' fallback result) must never
  // break the brief itself — the deterministic text is always a valid, complete narrative on its own.
  let result: { source: 'ai' | 'deterministic'; text: string | null }
  try {
    result = await explainDeterministicOutput({
      feature: 'commissioner_brief_narrative',
      deterministicSummary: deterministicText,
      deterministicEvidence: input.brief.sections.flatMap((s) => s.evidence),
      instruction:
        input.tone === 'playful'
          ? 'Rewrite in a fun, playful fantasy-football-commissioner voice. Do not add any fact, name, number, or claim not already present.'
          : 'Rewrite in a neutral, professional tone suitable for a league announcement. Do not add any fact, name, number, or claim not already present.',
      maxChars: limit ?? 2000,
      deterministicFallbackText: deterministicText,
      strictNumericGrounding: true,
    })
  } catch {
    result = { source: 'deterministic', text: deterministicText }
  }

  const text = truncate(result.text ?? deterministicText, limit)
  return {
    format: input.format,
    tone: input.tone,
    text,
    aiGenerated: result.source === 'ai',
    characterCount: text.length,
    characterLimit: limit,
  }
}
