/**
 * The minimal provider surface the three-brain service needs (a superset of the registry's IProviderClient:
 * same `chat`/`isAvailable`, plus an optional AbortSignal so timeouts can CANCEL the request where the
 * underlying client supports it — Anthropic does). Injectable so tests exercise the real orchestrator with
 * mocked providers and no real paid calls.
 */
import type { ProviderChatRequest, ProviderChatResult } from '@/lib/ai-orchestration/types'

export type ThreeBrainChatOptions = { signal?: AbortSignal }

export interface ThreeBrainProviderClient {
  chat(request: ProviderChatRequest, opts?: ThreeBrainChatOptions): Promise<ProviderChatResult>
  isAvailable(): boolean
}

/** The three-brain roles, including Anthropic (which is NOT in the openai/deepseek/grok registry). */
export type ThreeBrainRole = 'openai' | 'deepseek' | 'grok' | 'anthropic'

export type ThreeBrainProviderGetter = (role: ThreeBrainRole) => ThreeBrainProviderClient
