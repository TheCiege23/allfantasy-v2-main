/**
 * PROMPT 152 — OpenAI adapter: final synthesis, Chimmy, action plans, polished output.
 * Wraps openai-client; keys server-side only. Uses provider-config for availability.
 */

import type { IProviderClient, ProviderChatOptions } from '../provider-interface'
import type { ProviderChatRequest, ProviderChatResult } from '../types'
import { openaiChatJson, openaiChatText, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { isOpenAIAvailable } from '@/lib/provider-config'
import {
  buildProviderFailure,
  buildProviderInvalidResponse,
  buildProviderSuccess,
  isMeaningfulText,
} from '../provider-utils'

const ROLE = 'openai' as const
const DEFAULT_MODEL = 'gpt-4o'

function extractTextFromOpenAIJson(data: unknown): string {
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : ''
}

export function createOpenAIProvider(): IProviderClient {
  return {
    role: ROLE,
    isAvailable(): boolean {
      return isOpenAIAvailable()
    },
    async healthCheck(): Promise<boolean> {
      return isOpenAIAvailable()
    },
    async chat(request: ProviderChatRequest, opts?: ProviderChatOptions): Promise<ProviderChatResult> {
      const requestedModel = request.model?.trim() || undefined
      const fallbackModel = requestedModel ?? DEFAULT_MODEL
      try {
        if (request.responseFormat === 'json_object') {
          const result = await openaiChatJson({
            messages: request.messages,
            model: requestedModel,
            temperature: request.temperature ?? 0.4,
            maxTokens: request.maxTokens ?? 1200,
            signal: opts?.signal,
          })
          if (!result.ok) {
            return buildProviderFailure({
              provider: ROLE,
              model: result.model || fallbackModel,
              statusCode: result.status,
              error: result.details,
            })
          }
          const parsed = parseJsonContentFromChatCompletion(result.json)
          if (parsed == null || typeof parsed !== 'object') {
            return buildProviderInvalidResponse({
              provider: ROLE,
              model: result.model || fallbackModel,
              error: 'OpenAI returned malformed JSON response',
            })
          }
          const text = extractTextFromOpenAIJson(result.json)
          return buildProviderSuccess({
            provider: ROLE,
            model: result.model || fallbackModel,
            text: isMeaningfulText(text) ? text : JSON.stringify(parsed),
            json: parsed,
          })
        }

        const result = await openaiChatText({
          messages: request.messages,
          model: requestedModel,
          temperature: request.temperature ?? 0.5,
          maxTokens: request.maxTokens ?? 1500,
          signal: opts?.signal,
        })
        if (!result.ok) {
          return buildProviderFailure({
            provider: ROLE,
            model: result.model || fallbackModel,
            statusCode: result.status,
            error: result.details,
          })
        }
        if (!isMeaningfulText(result.text)) {
          return buildProviderInvalidResponse({
            provider: ROLE,
            model: result.model || fallbackModel,
          })
        }
        return buildProviderSuccess({
          provider: ROLE,
          model: result.model || fallbackModel,
          text: result.text,
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
export const createOpenAIAdapter = createOpenAIProvider
