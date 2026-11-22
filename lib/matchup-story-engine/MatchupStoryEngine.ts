import { openaiChatText } from '@/lib/openai-client'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { MatchupStoryEngineInput, MatchupStoryEngineResult } from './types'

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function cleanTeamName(name: string, fallback: string): string {
  const next = String(name ?? '').trim()
  return next || fallback
}

function formatInputContext(input: Required<Pick<MatchupStoryEngineInput, 'teamAName' | 'teamBName'>> & {
  sport: string
  projectedScoreA: number
  projectedScoreB: number
  winProbabilityA: number
  winProbabilityB: number
  upsetChance: number
  volatilityTag: string
}): string {
  const favorite = input.winProbabilityA >= input.winProbabilityB ? input.teamAName : input.teamBName
  const underdog = favorite === input.teamAName ? input.teamBName : input.teamAName
  return [
    `Sport: ${input.sport}`,
    `Matchup: ${input.teamAName} vs ${input.teamBName}`,
    `Projected score: ${input.projectedScoreA.toFixed(1)} - ${input.projectedScoreB.toFixed(1)}`,
    `Win probabilities: ${input.teamAName} ${(input.winProbabilityA * 100).toFixed(1)}%, ${input.teamBName} ${(input.winProbabilityB * 100).toFixed(1)}%`,
    `Favorite: ${favorite}`,
    `Underdog: ${underdog}`,
    `Upset chance: ${input.upsetChance.toFixed(1)}%`,
    `Volatility: ${input.volatilityTag}`,
  ].join('\n')
}

/**
 * PROMPT 242 — Matchup Story Engine
 * AI-only narrative layer for fun matchup storytelling.
 */
export async function generateMatchupStory(
  input: MatchupStoryEngineInput
): Promise<MatchupStoryEngineResult> {
  const sport = normalizeToSupportedSport(input.sport)
  const teamAName = cleanTeamName(input.teamAName, 'Team A')
  const teamBName = cleanTeamName(input.teamBName, 'Team B')
  const projectedScoreA = Number.isFinite(input.projectedScoreA) ? Number(input.projectedScoreA) : 0
  const projectedScoreB = Number.isFinite(input.projectedScoreB) ? Number(input.projectedScoreB) : 0
  const winProbabilityA = clampProbability(Number(input.winProbabilityA))
  const winProbabilityB = clampProbability(Number(input.winProbabilityB))
  const upsetChance = Number.isFinite(Number(input.upsetChance)) ? Number(input.upsetChance) : 0
  const volatilityTag = String(input.volatilityTag ?? 'medium')

  const ai = await openaiChatText({
    temperature: 0.75,
    maxTokens: 160,
    messages: [
      {
        role: 'system',
        content:
          'You write one fun fantasy matchup narrative sentence. Keep it concise (18-35 words), conversational, and grounded in the provided data. No bullet points or emojis.',
      },
      {
        role: 'user',
        content: [
          formatInputContext({
            sport,
            teamAName,
            teamBName,
            projectedScoreA,
            projectedScoreB,
            winProbabilityA,
            winProbabilityB,
            upsetChance,
            volatilityTag,
          }),
          '',
          'Output requirement: exactly one sentence, plain text.',
        ].join('\n'),
      },
    ],
  })

  if (!ai.ok) {
    return {
      ok: false,
      sport,
      status: ai.status || 503,
      error: ai.details || 'Chimmy provider unavailable',
    }
  }

  const narrative = ai.text.replace(/\s+/g, ' ').trim()
  if (!narrative) {
    return {
      ok: false,
      sport,
      status: 502,
      error: 'Chimmy narrative response was empty',
    }
  }

  return {
    ok: true,
    sport,
    narrative,
    source: 'ai',
    model: ai.model,
  }
}
