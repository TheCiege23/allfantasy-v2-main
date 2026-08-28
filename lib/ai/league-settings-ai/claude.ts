import Anthropic from '@anthropic-ai/sdk'
import { getChimmyOfficialTimePrefix } from '@/lib/time-engine/chimmyPromptPrefix'
import { assertAiSpendAllowed } from '@/lib/ai/aiSpendGuard'
import { parseJsonFromClaudeText } from './json-parse'

export const LEAGUE_AI_MODEL = 'claude-sonnet-4-20250514'
export const LEAGUE_AI_MAX_TOKENS = 1000

export async function callClaudeJson(args: {
  system: string
  user: string
  userId?: string | null
}): Promise<unknown> {
  /*
   * PROVIDER BOUNDARY, and the first statement on purpose. Everything below
   * costs something before the provider is ever reached —
   * getChimmyOfficialTimePrefix goes to the database — and none of it is worth
   * paying for when the call cannot be made.
   *
   * Throwing rather than the non-throwing isAiSpendEnabled matches this
   * function's existing contract: it already throws when ANTHROPIC_API_KEY is
   * absent, and it returns `unknown` with no null in the signature, so callers
   * have no degraded path to fall back to. The guard sits ABOVE that key check
   * so a refusal reports the switch rather than a missing key, which is the
   * more actionable of the two when both are true.
   *
   * Reached from 18 route files — the widest surface on the unguarded ratchet
   * when it was picked off.
   */
  assertAiSpendAllowed('league-settings-ai.claude')

  let userContent = args.user
  if (args.userId) {
    const prefix = await getChimmyOfficialTimePrefix(args.userId)
    if (prefix) userContent = `${prefix}\n\n${args.user}`
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }

  const anthropic = new Anthropic({ apiKey })
  const msg = await anthropic.messages.create({
    model: LEAGUE_AI_MODEL,
    max_tokens: LEAGUE_AI_MAX_TOKENS,
    system: args.system,
    messages: [{ role: 'user', content: userContent }],
  })

  const block = msg.content[0]
  const text = block?.type === 'text' ? block.text : ''
  if (!text) {
    throw new Error('Empty response from model')
  }
  return parseJsonFromClaudeText(text)
}
