/**
 * PROMPT 152 — xAI (Grok) adapter: trend framing, narrative/social framing, engagement-style summaries.
 * Wraps xai-client; keys server-side only. Uses provider-config for availability. Role = grok for registry.
 */

import type { IProviderClient, ProviderChatOptions } from '../provider-interface'
import type { ProviderChatRequest, ProviderChatResult } from '../types'
import { xaiChatJson, parseTextFromXaiChatCompletion, parseUsage } from '@/lib/xai-client'
import { getXaiConfigFromEnv } from '@/lib/provider-config'
import { isXaiAvailable } from '@/lib/provider-config'
import {
  buildProviderFailure,
  buildProviderInvalidResponse,
  buildProviderSuccess,
  isMeaningfulText,
  tryParseJson,
} from '../provider-utils'

const ROLE = 'grok' as const

const DEFAULT_XAI_MODEL = 'grok-2-latest'

function getModelName(): string {
  const cfg = getXaiConfigFromEnv()
  return cfg?.model ?? DEFAULT_XAI_MODEL
}

export function createGrokProvider(): IProviderClient {
  return {
    role: ROLE,
    isAvailable(): boolean {
      return isXaiAvailable()
    },
    async healthCheck(): Promise<boolean> {
      return isXaiAvailable()
    },
    async chat(request: ProviderChatRequest, opts?: ProviderChatOptions): Promise<ProviderChatResult> {
      const requestedModel = request.model?.trim() || undefined
      const fallbackModel = requestedModel ?? getModelName()
      try {
        const result = await xaiChatJson({
          messages: request.messages,
          model: requestedModel,
          temperature: request.temperature ?? 0.4,
          maxTokens: request.maxTokens ?? 1000,
          responseFormat:
            request.responseFormat === 'json_object' ? { type: 'json_object' } : undefined,
          signal: opts?.signal,
        })
        if (!result.ok) {
          return buildProviderFailure({
            provider: ROLE,
            model: fallbackModel,
            statusCode: result.status,
            error: result.details,
          })
        }
        const text = parseTextFromXaiChatCompletion(result.json) ?? ''
        const usage = parseUsage(result.json)

        if (!isMeaningfulText(text)) {
          return buildProviderInvalidResponse({
            provider: ROLE,
            model: (result.json as { model?: string })?.model ?? fallbackModel,
          })
        }

        if (request.responseFormat === 'json_object') {
          const parsed = tryParseJson(text)
          if (parsed == null || typeof parsed !== 'object') {
            return buildProviderInvalidResponse({
              provider: ROLE,
              model: (result.json as { model?: string })?.model ?? fallbackModel,
              error: 'xAI returned malformed JSON response',
            })
          }
          return buildProviderSuccess({
            provider: ROLE,
            model: (result.json as { model?: string })?.model ?? fallbackModel,
            text,
            json: parsed,
            tokensPrompt: usage?.prompt_tokens,
            tokensCompletion: usage?.completion_tokens,
          })
        }

        return buildProviderSuccess({
          provider: ROLE,
          model: (result.json as { model?: string })?.model ?? fallbackModel,
          text,
          tokensPrompt: usage?.prompt_tokens,
          tokensCompletion: usage?.completion_tokens,
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

/** Alias for PROMPT 152 adapter naming (xAI = Grok). */
export const createXAIAdapter = createGrokProvider
