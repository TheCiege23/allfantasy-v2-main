/**
 * Salary Cap AI service: call LLM with deterministic context only.
 * Returns explanation/strategy text. No cap or contract logic. PROMPT 341.
 */

import OpenAI from 'openai'
import { withOfficialTimeUserMessage } from '@/lib/time-engine/chimmyPromptPrefix'
import type { SalaryCapAIDeterministicContext } from './SalaryCapAIContext'
import type { SalaryCapAIContextType } from './SalaryCapAIContext'
import { buildPromptForType } from './SalaryCapAIPrompts'
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

export interface SalaryCapAIResult {
  explanation: string
  model?: string
}

/**
 * Generate AI explanation/strategy from deterministic context. No cap/contract computation.
 */
export async function generateSalaryCapAI(
  ctx: SalaryCapAIDeterministicContext,
  type: SalaryCapAIContextType,
  userId?: string | null
): Promise<SalaryCapAIResult> {
  const client = getOpenAIClient()
  if (!client) {
    return {
      explanation: 'AI salary cap strategy is unavailable because OpenAI is not configured. Use the deterministic cap health, contract, extension, tag, and ledger data shown above.',
      model: 'deterministic-fallback',
    }
  }

  const { system, user } = buildPromptForType(type, ctx)
  const userContent = userId ? await withOfficialTimeUserMessage(userId, user) : user
  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ],
    max_tokens: 600,
    temperature: 0.5,
  })
  const explanation = completion.choices[0]?.message?.content?.trim() ?? 'No explanation generated.'
  return {
    explanation,
    model: completion.model ?? undefined,
  }
}
