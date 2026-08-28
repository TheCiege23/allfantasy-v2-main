/**
 * Survivor AI service: call LLM with deterministic context only.
 * Returns narrative/explanation only. No elimination, vote, idol, immunity, or exile-return logic.
 * PROMPT 348.
 */

import OpenAI from 'openai'
import { withOfficialTimeUserMessage } from '@/lib/time-engine/chimmyPromptPrefix'
import type { SurvivorAIDeterministicContext } from './SurvivorAIContext'
import type { SurvivorAIType } from './SurvivorAIContext'
import { buildSurvivorAIPrompt } from './SurvivorAIPrompts'
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'

let openai: OpenAI | null = null

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY
  // PROVIDER BOUNDARY. Guard form matches this function's own contract: it
  // already returns null when the key is absent, so a spend refusal behaves
  // identically to an unconfigured provider. Above the key check because when
  // both are missing the switch is the actionable one.
  if (!isAiSpendEnabled()) return null

  if (!apiKey) return null
  if (!openai) {
    openai = new OpenAI({
      apiKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    })
  }
  return openai
}

export interface SurvivorAIResult {
  narrative: string
  model?: string
}

export interface SurvivorAiCacheContextSummary {
  leagueId: string
  sport: string
  currentWeek: number
  merged: boolean
  config: {
    mode: string
    tribeCount: number
    tribeSize: number
    mergeTrigger: string
    mergeWeek: number
    mergePlayerCount: number | null
  }
  tribes: Array<{ id: string; name: string; memberCount: number }>
  council: {
    id: string
    week: number
    phase: string
    attendingTribeId: string | null
    closed: boolean
    eliminatedRosterId: string | null
  } | null
  challenges: Array<{ id: string; week: number; challengeType: string; submissionCount: number }>
  juryCount: number
  exileLeagueId: string | null
  exileTokenLeaders: Array<{ rosterId: string; tokens: number }>
  votedOutCount: number
  myRosterId: string | null
  myIdolPowers: string[]
  myEffects: string[]
  myExileStatus: {
    exileRosterId: string
    tokens: number
    eliminated: boolean
    eligibleToReturn: boolean
    reason: string | null
  } | null
  finale: {
    open: boolean
    closed: boolean
    finalists: string[]
    winnerRosterId: string | null
  } | null
}

export function buildSurvivorAiCacheContextSummary(
  ctx: SurvivorAIDeterministicContext
): SurvivorAiCacheContextSummary {
  return {
    leagueId: ctx.leagueId,
    sport: ctx.sport,
    currentWeek: ctx.currentWeek,
    merged: ctx.merged,
    config: {
      mode: ctx.config.mode,
      tribeCount: ctx.config.tribeCount,
      tribeSize: ctx.config.tribeSize,
      mergeTrigger: ctx.config.mergeTrigger,
      mergeWeek: ctx.config.mergeWeek,
      mergePlayerCount: ctx.config.mergePlayerCount,
    },
    tribes: ctx.tribes
      .map((tribe) => ({ id: tribe.id, name: tribe.name, memberCount: tribe.members.length }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    council: ctx.council
      ? {
          id: ctx.council.id,
          week: ctx.council.week,
          phase: ctx.council.phase,
          attendingTribeId: ctx.council.attendingTribeId,
          closed: Boolean(ctx.council.closedAt),
          eliminatedRosterId: ctx.council.eliminatedRosterId,
        }
      : null,
    challenges: ctx.challenges
      .map((challenge) => ({
        id: challenge.id,
        week: challenge.week,
        challengeType: challenge.challengeType,
        submissionCount: challenge.submissionCount,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    juryCount: ctx.jury.length,
    exileLeagueId: ctx.exileLeagueId,
    exileTokenLeaders: [...ctx.exileTokens]
      .sort((a, b) => b.tokens - a.tokens || a.rosterId.localeCompare(b.rosterId))
      .slice(0, 5)
      .map((row) => ({ rosterId: row.rosterId, tokens: row.tokens })),
    votedOutCount: ctx.votedOutHistory.length,
    myRosterId: ctx.myRosterId,
    myIdolPowers: ctx.myIdols.map((idol) => idol.powerType).sort(),
    myEffects: ctx.myActiveEffects
      .map((effect) => `${effect.rewardType}:${effect.appliedMode}:w${effect.week}`)
      .sort(),
    myExileStatus: ctx.myExileStatus,
    finale: ctx.finale
      ? {
          open: ctx.finale.open,
          closed: ctx.finale.closed,
          finalists: [...ctx.finale.finalists].sort(),
          winnerRosterId: ctx.finale.winnerRosterId,
        }
      : null,
  }
}

/**
 * Generate AI narrative/explanation from deterministic context. No outcome logic.
 */
export async function generateSurvivorAI(
  ctx: SurvivorAIDeterministicContext,
  type: SurvivorAIType,
  userId?: string | null
): Promise<SurvivorAIResult> {
  const client = getOpenAIClient()
  if (!client) {
    return {
      narrative:
        'AI survivor strategy is unavailable because OpenAI is not configured. Use the deterministic tribe, council, challenge, idol, exile, and jury data shown above.',
      model: 'deterministic-fallback',
    }
  }

  const { system, user } = buildSurvivorAIPrompt(ctx, type)
  const userContent = userId ? await withOfficialTimeUserMessage(userId, user) : user
  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    max_tokens: 600,
    temperature: 0.6,
  })
  const narrative = completion.choices[0]?.message?.content?.trim() ?? 'No narrative generated.'
  return {
    narrative,
    model: completion.model ?? undefined,
  }
}
