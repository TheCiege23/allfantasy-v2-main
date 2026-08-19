/**
 * PROMPT 152 — DeepSeek adapter: structured analytical reasoning, deterministic interpretation, matrix/scoring review.
 * Wraps deepseek-client; keys server-side only. Uses provider-config for availability.
 */

import type { IProviderClient, ProviderChatOptions } from '../provider-interface'
import type { ProviderChatRequest, ProviderChatResult } from '../types'
import { deepseekChat } from '@/lib/deepseek-client'
import { isDeepSeekAvailable } from '@/lib/provider-config'
import {
  buildProviderFailure,
  buildProviderInvalidResponse,
  buildProviderSuccess,
  isMeaningfulText,
  tryParseJson,
} from '../provider-utils'

const ROLE = 'deepseek' as const
const DEFAULT_MODEL = 'deepseek-chat'

function toDeepSeekUserPrompt(messages: ProviderChatRequest['messages']): string {
  return (
    messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n') || messages[messages.length - 1]?.content || ''
  )
}

function normalizeJsonText(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
}

export function createDeepSeekProvider(): IProviderClient {
  return {
    role: ROLE,
    isAvailable(): boolean {
      return isDeepSeekAvailable()
    },
    async healthCheck(): Promise<boolean> {
      return isDeepSeekAvailable()
    },
    async chat(request: ProviderChatRequest, opts?: ProviderChatOptions): Promise<ProviderChatResult> {
      const requestedModel = request.model?.trim() || undefined
      const fallbackModel = requestedModel ?? DEFAULT_MODEL
      try {
        const systemBase =
          request.messages.find((m) => m.role === 'system')?.content ??
          'You are a quantitative fantasy sports analyst.'
        const system =
          request.responseFormat === 'json_object'
            ? `${systemBase}\nReturn strict JSON object only. No markdown, no preamble, no prose outside JSON.`
            : systemBase
        const user = toDeepSeekUserPrompt(request.messages)
        const result = await deepseekChat({
          prompt: user,
          systemPrompt: system,
          model: requestedModel,
          temperature: request.temperature ?? 0.2,
          maxTokens: request.maxTokens ?? 1000,
          signal: opts?.signal,
        })
        if (result.error) {
          return buildProviderFailure({
            provider: ROLE,
            model: result.model || fallbackModel,
            error: result.error,
            tokensPrompt: result.usage?.promptTokens,
            tokensCompletion: result.usage?.completionTokens,
          })
        }

        const rawText = result.content ?? ''
        if (!isMeaningfulText(rawText)) {
          return buildProviderInvalidResponse({
            provider: ROLE,
            model: result.model || fallbackModel,
          })
        }

        if (request.responseFormat === 'json_object') {
          const parsed = tryParseJson(normalizeJsonText(rawText))
          if (parsed == null || typeof parsed !== 'object') {
            return buildProviderInvalidResponse({
              provider: ROLE,
              model: result.model || fallbackModel,
              error: 'DeepSeek returned malformed JSON response',
            })
          }
          return buildProviderSuccess({
            provider: ROLE,
            model: result.model || fallbackModel,
            text: rawText,
            json: parsed,
            tokensPrompt: result.usage?.promptTokens,
            tokensCompletion: result.usage?.completionTokens,
          })
        }

        return buildProviderSuccess({
          provider: ROLE,
          model: result.model || fallbackModel,
          text: rawText,
          tokensPrompt: result.usage?.promptTokens,
          tokensCompletion: result.usage?.completionTokens,
        })
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e)
        return buildProviderFailure({
          provider: ROLE,
          model: fallbackModel,
          error: message,
        })
      }
    },
  }
}

/** Alias for PROMPT 152 adapter naming. */
export const createDeepSeekAdapter = createDeepSeekProvider
