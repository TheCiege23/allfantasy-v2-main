import Anthropic from '@anthropic-ai/sdk'
import { getChimmyOfficialTimePrefix } from '@/lib/time-engine/chimmyPromptPrefix'
import { assertAiSpendAllowed } from '@/lib/ai/aiSpendGuard'

export const DRAFT_AI_MODEL = 'claude-sonnet-4-20250514'
export const DRAFT_AI_MAX_TOKENS = 1000

export async function draftAiText(
  system: string,
  user: string,
  options?: { userId?: string | null },
): Promise<string> {
  let userContent = user
  if (options?.userId) {
    const prefix = await getChimmyOfficialTimePrefix(options.userId)
    if (prefix) userContent = `${prefix}\n\n${user}`
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  // PROVIDER BOUNDARY. Guard form matches this function's own contract: it
  // already throws when the key is absent, so a spend refusal behaves
  // identically to an unconfigured provider. Above the key check because when
  // both are missing the switch is the actionable one.
  assertAiSpendAllowed('draft-claude')

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }
  const anthropic = new Anthropic({ apiKey })
  const msg = await anthropic.messages.create({
    model: DRAFT_AI_MODEL,
    max_tokens: DRAFT_AI_MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: userContent }],
  })
  const block = msg.content[0]
  return block?.type === 'text' ? block.text : ''
}
