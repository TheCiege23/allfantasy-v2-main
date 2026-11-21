import 'server-only'

import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'
import { resolveAnthropicModel } from '@/lib/ai/providerProfiles'

/**
 * The second model for `decisionAnswerCheck.ts`: the cheap Anthropic profile (Haiku by default,
 * `ANTHROPIC_MODEL_CHEAP` to change it), a short reply, no retries, a hard timeout. Null on anything that is not a
 * reply — no key, AI spend off, a timeout, an error — so the check fails open.
 */
export async function callDecisionCheckModel(prompt: { system: string; user: string }, timeoutMs: number): Promise<string | null> {
  // PROVIDER BOUNDARY: a spend refusal behaves exactly like an unconfigured provider.
  if (!isAiSpendEnabled()) return null
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) return null
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs })
    const response = await client.messages.create({
      model: resolveAnthropicModel('cheap'),
      max_tokens: 600,
      temperature: 0,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    })
    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim()
    return text || null
  } catch {
    return null
  }
}
