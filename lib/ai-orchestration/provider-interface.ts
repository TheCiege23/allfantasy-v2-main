/**
 * Provider abstraction — single interface for OpenAI, DeepSeek, Grok.
 * All keys and secrets are server-side; no provider credentials exposed to frontend.
 */

import type { AIModelRole } from '@/lib/unified-ai/types'
import type { ProviderChatRequest, ProviderChatResult } from './types'

export type { ProviderChatRequest, ProviderChatResult }

/** Per-call options. `signal` is threaded into the underlying SDK/HTTP request so a caller (e.g. the Decision OS
 *  durable refresh runner) can genuinely CANCEL an in-flight provider request on lease-loss / deadline. Optional
 *  everywhere → existing (non-refresh) callers are unchanged. */
export type ProviderChatOptions = { signal?: AbortSignal }

/** Implemented by each provider (OpenAI, DeepSeek, Grok). */
export interface IProviderClient {
  readonly role: AIModelRole
  /** Send chat request; returns result with status ok | failed | timeout | invalid_response. `opts.signal`
   *  cancels the underlying network request where supported (OpenAI/DeepSeek SDK, xAI fetch). */
  chat(request: ProviderChatRequest, opts?: ProviderChatOptions): Promise<ProviderChatResult>
  /** Whether this provider is configured (has API key / base URL). */
  isAvailable(): boolean
  /** Optional health check (e.g. minimal request or config check). */
  healthCheck?(): Promise<boolean>
}

/** Alias name used by orchestration architecture docs. */
export type AIProviderInterface = IProviderClient

/** Default timeout when not specified (ms). */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 25_000

/** Default max retries per provider call. */
export const DEFAULT_MAX_RETRIES = 1
