/**
 * Anthropic (Claude) adapter for the shared provider registry — Chimmy's main model on the push/PECR
 * path (user decision 2026-09-23). The tool loop runs Claude first; this is what answers when the
 * loop returns nothing, so the fallback is Claude too, not the OpenAI/DeepSeek/Grok accounts that
 * were down in production on 2026-09-20.
 *
 * Settings come from `lib/ai/chimmyClaudeConfig.ts`, shared with the tool loop.
 *
 * ⚠ `maxTokens` FROM THE REQUEST IS A FLOOR-LESS 1000, AND THAT IS WRONG FOR CLAUDE.
 * `runProviderCallWithTimeout` sends every provider `maxTokens: 1000`. With adaptive thinking on,
 * thinking counts against `max_tokens`, so 1000 truncates the answer before it starts. This adapter
 * uses `CHIMMY_CLAUDE_MAX_TOKENS` unless a caller asks for MORE.
 *
 * ⚠ THE ORCHESTRATOR'S TIMEOUT DOES NOT CANCEL. It resolves a `timeout` result and walks away, and the
 * request keeps running and billing. So the SDK gets its own `timeout` from `request.timeoutMs`,
 * which actually aborts the call.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { IProviderClient, ProviderChatOptions } from '../provider-interface'
import type { ProviderChatRequest, ProviderChatResult } from '../types'
import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'
import {
  CHIMMY_CLAUDE_EFFORT,
  CHIMMY_CLAUDE_FALLBACK_BETA,
  CHIMMY_CLAUDE_MAX_TOKENS,
  hasAnthropicKey,
  resolveChimmyClaudeModel,
} from '@/lib/ai/chimmyClaudeConfig'
import {
  buildProviderFailure,
  buildProviderInvalidResponse,
  buildProviderSuccess,
  isMeaningfulText,
} from '../provider-utils'

const ROLE = 'anthropic' as const

/** System messages become Claude's `system`; everything else is the one user turn, in order. */
export function toClaudeRequest(messages: ProviderChatRequest['messages']): {
  system: string
  user: string
} {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const user = messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n\n')
  return { system, user }
}

export function createAnthropicProvider(): IProviderClient {
  return {
    role: ROLE,
    isAvailable(): boolean {
      return hasAnthropicKey()
    },
    async healthCheck(): Promise<boolean> {
      return hasAnthropicKey()
    },
    async chat(request: ProviderChatRequest, opts?: ProviderChatOptions): Promise<ProviderChatResult> {
      const model = resolveChimmyClaudeModel(request.model)
      // A provider boundary in its own right, as for the tool loop — not only the caller's gate.
      if (!isAiSpendEnabled()) {
        return buildProviderFailure({ provider: ROLE, model, error: 'AI spend is disabled' })
      }
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
      if (!apiKey) return buildProviderFailure({ provider: ROLE, model, error: 'ANTHROPIC_API_KEY is not set' })

      const { system, user } = toClaudeRequest(request.messages)
      if (!user.trim()) return buildProviderInvalidResponse({ provider: ROLE, model, error: 'Empty user message' })

      const client = new Anthropic({ apiKey, maxRetries: 0 })
      const create = (withFallbacks: boolean) =>
        client.messages.create(
          {
            model,
            max_tokens: Math.max(CHIMMY_CLAUDE_MAX_TOKENS, request.maxTokens ?? 0),
            ...(system.trim() ? { system } : {}),
            thinking: { type: 'adaptive' },
            output_config: { effort: CHIMMY_CLAUDE_EFFORT },
            messages: [{ role: 'user', content: user }],
            // Not in this SDK version's types; the SDK sends the body as given.
            ...(withFallbacks ? { fallbacks: 'default' } : {}),
          } as Anthropic.MessageCreateParamsNonStreaming,
          {
            ...(request.timeoutMs ? { timeout: request.timeoutMs } : {}),
            ...(opts?.signal ? { signal: opts.signal } : {}),
            ...(withFallbacks ? { headers: { 'anthropic-beta': CHIMMY_CLAUDE_FALLBACK_BETA } } : {}),
          },
        )

      try {
        let response: Anthropic.Message
        try {
          response = await create(true)
        } catch (err) {
          // See CHIMMY_CLAUDE_FALLBACK_BETA: the add-on must never be the reason Claude fails.
          if (err instanceof Anthropic.BadRequestError) response = await create(false)
          else throw err
        }

        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim()
        const tokens = {
          tokensPrompt: response.usage?.input_tokens,
          tokensCompletion: response.usage?.output_tokens,
        }

        // A refusal or a truncated answer is not an answer; let the next provider try.
        if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
          return buildProviderFailure({
            provider: ROLE,
            model: response.model || model,
            error: `Claude stopped with ${response.stop_reason}`,
            ...tokens,
          })
        }
        if (!isMeaningfulText(text)) {
          return buildProviderInvalidResponse({ provider: ROLE, model: response.model || model })
        }
        return buildProviderSuccess({ provider: ROLE, model: response.model || model, text, ...tokens })
      } catch (e: unknown) {
        const err = e as { status?: number; message?: string } | null
        return buildProviderFailure({
          provider: ROLE,
          model,
          statusCode: err?.status,
          error: err?.message ?? String(e),
          timedOut: e instanceof Anthropic.APIConnectionTimeoutError,
        })
      }
    },
  }
}
