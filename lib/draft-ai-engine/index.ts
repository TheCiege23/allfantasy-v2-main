/**
 * Draft AI assist — deterministic recommendation with optional AI explanation.
 */

import { computeDraftRecommendation, type RecommendationResult } from '@/lib/draft-helper/RecommendationEngine'
import { explainDeterministicOutput } from '@/lib/ai-explanation-layer'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

type DraftInputPlayer = {
  name: string
  position: string
  team: string | null
  adp: number | null
  byeWeek: number | null
}

export interface DraftAIAssistInput {
  available: DraftInputPlayer[]
  teamRoster: Array<{ position: string; team?: string | null; byeWeek?: number | null }>
  rosterSlots: string[]
  round: number
  pick: number
  totalTeams: number
  sport: string
  isDynasty: boolean
  isSF: boolean
  mode: 'bpa' | 'needs'
  /** Same starter-eligible set as draft pool / autopick (omit bench-only union). */
  draftEligiblePositions?: ReadonlySet<string>
  aiAdpByKey?: Record<string, number>
  byeByKey?: Record<string, number>
  /**
   * The room's one pick, already decided on the server (`sharedDraftPickForUser`, lib/shared-services/draft/
   * pickDecision.ts). When given it is used as-is and the explanation is written about it, so this route cannot
   * name a different player from the draft card. Absent, the engine runs on `available` as before.
   */
  precomputed?: RecommendationResult | null
}

export interface DraftAIAssistOptions {
  explanation?: boolean
  sport?: string
  idp?: boolean
  recommendationContext?: string
  leagueId?: string
}

export interface DraftAIAssistResult {
  recommendation: RecommendationResult
  explanation?: string | null
  aiExplanationUsed: boolean
}

async function buildOptionalAIExplanation(input: {
  recommendation: RecommendationResult
  options: DraftAIAssistOptions
  context: { sport: string; round: number; pick: number; totalTeams: number }
}): Promise<string | null> {
  if (!input.recommendation.recommendation) return null

  const top = input.recommendation.recommendation
  const alternatives = input.recommendation.alternatives
    .slice(0, 2)
    .map((item) => `${item.player.name} (${item.player.position})`)
    .join(', ')

  const explanation = await explainDeterministicOutput({
    feature: 'draft_recommendation',
    sport: input.context.sport,
    deterministicSummary: input.recommendation.explanation,
    deterministicEvidence: [
      `On clock: Round ${input.context.round}, Pick ${input.context.pick}, ${input.context.totalTeams}-team league`,
      `Top recommendation: ${top.player.name} (${top.player.position}${top.player.team ? `, ${top.player.team}` : ''})`,
      `Reason: ${top.reason}`,
      `Confidence: ${top.confidence}%`,
      `Alternatives: ${alternatives || 'None'}`,
      `Warnings: ${
        [
          input.recommendation.reachWarning,
          input.recommendation.valueWarning,
          input.recommendation.scarcityInsight,
          input.recommendation.formatInsight,
          input.recommendation.byeNote,
        ]
          .filter(Boolean)
          .join(' | ') || 'None'
      }`,
      input.options.idp ? 'League context: IDP enabled.' : '',
      input.options.recommendationContext ? `Recommendation context: ${input.options.recommendationContext}` : '',
    ],
    instruction: 'Write exactly 2 concise sentences: (1) why this pick now, (2) fallback if sniped.',
    temperature: 0.3,
    maxTokens: 170,
    maxChars: 520,
    deterministicFallbackText: null,
  })

  if (explanation.source !== 'ai' || !explanation.text) return null
  return explanation.text
}

/**
 * Deterministic first: best available + roster needs.
 * AI is optional and only used for narrative explanation.
 */
export async function runDraftAIAssist(
  input: DraftAIAssistInput,
  options: DraftAIAssistOptions
): Promise<DraftAIAssistResult> {
  const sport = normalizeToSupportedSport(options.sport ?? input.sport)
  const deterministic = input.precomputed ?? computeDraftRecommendation({
    available: input.available,
    teamRoster: input.teamRoster,
    rosterSlots: input.rosterSlots,
    round: input.round,
    pick: input.pick,
    totalTeams: input.totalTeams,
    sport,
    isDynasty: input.isDynasty,
    isSF: input.isSF,
    mode: input.mode,
    draftEligiblePositions: input.draftEligiblePositions,
    aiAdpByKey: input.aiAdpByKey,
    byeByKey: input.byeByKey,
  })

  if (!options.explanation) {
    return {
      recommendation: deterministic,
      explanation: null,
      aiExplanationUsed: false,
    }
  }

  const aiExplanation = await buildOptionalAIExplanation({
    recommendation: deterministic,
    options,
    context: {
      sport,
      round: input.round,
      pick: input.pick,
      totalTeams: input.totalTeams,
    },
  })

  return {
    recommendation: deterministic,
    explanation: aiExplanation,
    aiExplanationUsed: Boolean(aiExplanation),
  }
}
