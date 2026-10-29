/**
 * [NEW] Big Brother AI service: generate narrative from deterministic context only.
 * PROMPT 4. No outcome logic — host, challenge theme, recap, game theory, social strategy, finale.
 */

import { getOpenAIClient, getOpenAIConfig } from '@/lib/openai-client'
import { withOfficialTimeUserMessage } from '@/lib/time-engine/chimmyPromptPrefix'
import type { BigBrotherAIContext } from './BigBrotherAIContext'
import type { BigBrotherAIPromptType } from './BigBrotherAIPrompts'
import { buildBigBrotherAIPrompt } from './BigBrotherAIPrompts'
import { getRosterDisplayNamesForLeague } from './getRosterDisplayNames'

export interface BigBrotherAIResult {
  narrative: string
  model?: string
}

/**
 * Generate AI narrative from deterministic context. No outcome decisions.
 */
export async function generateBigBrotherAI(
  ctx: BigBrotherAIContext,
  type: BigBrotherAIPromptType,
  userId?: string | null
): Promise<BigBrotherAIResult> {
  const rosterIds = [
    ctx.hohRosterId,
    ctx.nominee1RosterId,
    ctx.nominee2RosterId,
    ctx.vetoWinnerRosterId,
    ctx.vetoSavedRosterId,
    ctx.replacementNomineeRosterId,
    ctx.evictedRosterId,
    ...ctx.finalNomineeRosterIds,
    ...ctx.juryRosterIds,
    ...ctx.eliminatedRosterIds,
  ].filter(Boolean) as string[]
  const rosterDisplayNames = await getRosterDisplayNamesForLeague(ctx.leagueId, rosterIds.length ? rosterIds : undefined)

  const { system, user } = buildBigBrotherAIPrompt(ctx, type, rosterDisplayNames)
  const userContent = userId ? await withOfficialTimeUserMessage(userId, user) : user
  const config = getOpenAIConfig()
  const client = getOpenAIClient()

  const completion = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    max_completion_tokens: 700,
    temperature: 0.6,
  })

  const narrative = completion.choices[0]?.message?.content?.trim()
  if (!narrative) throw new Error('No narrative generated')
  return {
    narrative,
    model: completion.model ?? undefined,
  }
}
