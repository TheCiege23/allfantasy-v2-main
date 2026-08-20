/**
 * AI Provider Fallback Router
 *
 * Tries providers in configured order. Falls back on billing, rate-limit,
 * 5xx, timeout, or network failure. Halts immediately on content-filter
 * refusals (other providers would also refuse).
 *
 * Configure order via AI_PROVIDER_ORDER env var (comma-separated):
 *   AI_PROVIDER_ORDER=openai,anthropic,xai,deepseek
 *
 * Users never see which provider answered. Admin logs include provider attempts.
 */

import { normalizeProviderError } from '@/lib/ai/providerErrors'
import {
  resolveOpenAIModel,
  resolveAnthropicModel,
  resolveXaiModel,
  resolveDeepSeekModel,
  type ProviderProfile,
} from '@/lib/ai/providerProfiles'
import { openaiChatText, openaiChatTextStream } from '@/lib/openai-client'
import { xaiChatJson, parseTextFromXaiChatCompletion } from '@/lib/xai-client'
import { deepseekChat } from '@/lib/deepseek-client'
import { rateLimitManager } from '@/lib/workers/rate-limit-manager'

export type ProviderName = 'openai' | 'anthropic' | 'xai' | 'deepseek'
export type { ProviderProfile }

export type RouterMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type RouterImage = {
  data: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
}

export type RouterResult =
  | { ok: true; text: string; model: string; provider: ProviderName; tokensUsed: number }
  | { ok: false }

type TextCallArgs = {
  messages: RouterMessage[]
  maxTokens?: number
  temperature?: number
  image?: RouterImage | null
  skipCache?: boolean
  preferredAnthropicModel?: string
  /** Cost-aware model profile. Defaults to 'standard'. */
  profile?: ProviderProfile
}

type StreamCallArgs = TextCallArgs & {
  onText: (delta: string, snapshot: string) => void
}

const DEFAULT_PROVIDER_ORDER: ProviderName[] = ['openai', 'anthropic', 'xai', 'deepseek']

// Per-provider call timeout (ms). Prevents a slow/unreachable provider from
// consuming the entire serverless function budget before fallbacks can run.
const PROVIDER_TIMEOUT_MS = 12_000

function withTimeout<T>(promise: Promise<T>, ms: number, provider: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () =>
          reject(
            Object.assign(new Error(`Provider ${provider} timed out after ${ms}ms`), {
              code: 'ETIMEDOUT',
            })
          ),
        ms
      )
    ),
  ])
}

export function getProviderOrder(): ProviderName[] {
  const env = process.env.AI_PROVIDER_ORDER?.trim()
  if (!env) return DEFAULT_PROVIDER_ORDER
  const seen = new Set<ProviderName>()
  const deduped = env
    .split(',')
    .map((s) => s.trim().toLowerCase() as ProviderName)
    .filter((p) => DEFAULT_PROVIDER_ORDER.includes(p) && !seen.has(p) && Boolean(seen.add(p)))
  return deduped.length > 0 ? deduped : DEFAULT_PROVIDER_ORDER
}

// ─── Anthropic adapter ────────────────────────────────────────────────────────
// Isolated from anthropic-pipeline.ts to prevent circular imports.

const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? ''

type AnthropicSdkModule = typeof import('@anthropic-ai/sdk')
type AnthropicClient = InstanceType<AnthropicSdkModule['default']>
let _routerAnthropicPromise: Promise<AnthropicClient | null> | null = null

async function getRouterAnthropicClient(): Promise<AnthropicClient | null> {
  if (!anthropicApiKey) return null
  if (!_routerAnthropicPromise) {
    _routerAnthropicPromise = import('@anthropic-ai/sdk')
      .then((mod) => new mod.default({ apiKey: anthropicApiKey }))
      .catch(() => null)
  }
  return _routerAnthropicPromise
}

function buildAnthropicContent(text: string, image?: RouterImage | null) {
  if (!image) return text
  return [
    { type: 'text' as const, text },
    {
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: image.mediaType, data: image.data },
    },
  ]
}

function extractSystemAndUser(messages: RouterMessage[]): { system: string; userContent: string } {
  const system = messages.find((m) => m.role === 'system')?.content ?? ''
  const userMsgs = messages.filter((m) => m.role !== 'system')
  const userContent = userMsgs[userMsgs.length - 1]?.content ?? ''
  return { system, userContent }
}

async function callAnthropicText(args: TextCallArgs): Promise<RouterResult> {
  if (!anthropicApiKey) {
    throw Object.assign(new Error('Anthropic API key not configured.'), { status: 503 })
  }
  const canCall = await rateLimitManager.canCall('anthropic', '/v1/messages').catch(() => true)
  if (!canCall) {
    throw Object.assign(new Error('Anthropic safety rate limit reached.'), { status: 429 })
  }
  const client = await getRouterAnthropicClient()
  if (!client) {
    throw Object.assign(new Error('Anthropic client unavailable.'), { status: 503 })
  }

  const { system, userContent } = extractSystemAndUser(args.messages)
  const model =
    args.preferredAnthropicModel?.trim() ||
    resolveAnthropicModel(args.profile ?? 'standard')

  const startedAt = Date.now()
  try {
    const response = await client.messages.create({
      model,
      max_tokens: args.maxTokens ?? 1500,
      system,
      messages: [{ role: 'user', content: buildAnthropicContent(userContent, args.image) }],
    })
    await rateLimitManager
      .recordCall('anthropic', '/v1/messages', 200, Date.now() - startedAt)
      .catch(() => {})
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    return {
      ok: true,
      text,
      model: response.model || model,
      provider: 'anthropic',
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    }
  } catch (error: unknown) {
    const status = (error as Record<string, unknown>)?.status as number | undefined
    await rateLimitManager
      .recordCall('anthropic', '/v1/messages', status ?? 500, Date.now() - startedAt, {
        error: error instanceof Error ? error.message : String(error),
      })
      .catch(() => {})
    throw error
  }
}

async function callAnthropicStream(args: StreamCallArgs): Promise<RouterResult> {
  if (!anthropicApiKey) {
    throw Object.assign(new Error('Anthropic API key not configured.'), { status: 503 })
  }
  const canCall = await rateLimitManager.canCall('anthropic', '/v1/messages').catch(() => true)
  if (!canCall) {
    throw Object.assign(new Error('Anthropic safety rate limit reached.'), { status: 429 })
  }
  const client = await getRouterAnthropicClient()
  if (!client) {
    throw Object.assign(new Error('Anthropic client unavailable.'), { status: 503 })
  }

  const { system, userContent } = extractSystemAndUser(args.messages)
  const model =
    args.preferredAnthropicModel?.trim() ||
    resolveAnthropicModel(args.profile ?? 'standard')

  const startedAt = Date.now()
  try {
    const stream = client.messages.stream({
      model,
      max_tokens: args.maxTokens ?? 1500,
      system,
      messages: [{ role: 'user', content: buildAnthropicContent(userContent, args.image) }],
    })

    let latestSnapshot = ''
    stream.on('text', (delta, snapshot) => {
      latestSnapshot = snapshot
      args.onText(delta, snapshot)
    })

    const [finalText, finalMessage] = await Promise.all([
      stream.finalText(),
      stream.finalMessage(),
    ])
    await rateLimitManager
      .recordCall('anthropic', '/v1/messages', 200, Date.now() - startedAt)
      .catch(() => {})

    return {
      ok: true,
      text: finalText?.trim() || latestSnapshot.trim(),
      model: finalMessage.model || model,
      provider: 'anthropic',
      tokensUsed:
        Math.max(0, finalMessage.usage.input_tokens ?? 0) +
        Math.max(0, finalMessage.usage.output_tokens ?? 0),
    }
  } catch (error: unknown) {
    const status = (error as Record<string, unknown>)?.status as number | undefined
    await rateLimitManager
      .recordCall('anthropic', '/v1/messages', status ?? 500, Date.now() - startedAt, {
        error: error instanceof Error ? error.message : String(error),
      })
      .catch(() => {})
    throw error
  }
}

// ─── OpenAI adapter ───────────────────────────────────────────────────────────

async function callOpenAIText(args: TextCallArgs): Promise<RouterResult> {
  const model = resolveOpenAIModel(args.profile ?? 'standard')
  const result = await openaiChatText({
    messages: args.messages,
    model,
    maxTokens: args.maxTokens,
    temperature: args.temperature,
    skipCache: args.skipCache ?? false,
  })
  if (!result.ok) {
    throw Object.assign(new Error(result.details || 'OpenAI call failed'), { status: result.status })
  }
  return { ok: true, text: result.text, model: result.model, provider: 'openai', tokensUsed: 0 }
}

async function callOpenAIStream(args: StreamCallArgs): Promise<RouterResult> {
  const model = resolveOpenAIModel(args.profile ?? 'standard')
  const result = await openaiChatTextStream({
    messages: args.messages,
    model,
    maxTokens: args.maxTokens,
    temperature: args.temperature,
  })
  if (!result.ok) {
    throw Object.assign(new Error(result.details || 'OpenAI stream failed'), { status: result.status })
  }
  let snapshot = ''
  for await (const delta of result.stream) {
    snapshot += delta
    args.onText(delta, snapshot)
  }
  return { ok: true, text: snapshot, model: result.model, provider: 'openai', tokensUsed: 0 }
}

// ─── xAI adapter ─────────────────────────────────────────────────────────────

async function callXaiText(args: TextCallArgs): Promise<RouterResult> {
  const result = await xaiChatJson({
    messages: args.messages,
    maxTokens: args.maxTokens,
    temperature: args.temperature,
    skipCache: args.skipCache ?? true,
  })
  if (!result.ok) {
    throw Object.assign(new Error(result.details || 'xAI call failed'), { status: result.status })
  }
  const text = parseTextFromXaiChatCompletion(result.json)
  if (!text) {
    throw Object.assign(new Error('xAI returned no content'), { status: 200 })
  }
  const model = (result.json as { model?: string })?.model ?? 'grok-2-latest'
  return { ok: true, text, model, provider: 'xai', tokensUsed: 0 }
}

// ─── DeepSeek adapter ─────────────────────────────────────────────────────────

async function callDeepSeekText(args: TextCallArgs): Promise<RouterResult> {
  const { system, userContent } = extractSystemAndUser(args.messages)
  const result = await deepseekChat({
    prompt: userContent,
    systemPrompt: system,
    maxTokens: args.maxTokens,
    temperature: args.temperature,
  })
  if (result.error || !result.content) {
    throw Object.assign(new Error(result.error ?? 'DeepSeek returned no content'), { status: 503 })
  }
  return {
    ok: true,
    text: result.content,
    model: result.model ?? 'deepseek-chat',
    provider: 'deepseek',
    tokensUsed: 0,
  }
}

// ─── Provider dispatch tables ─────────────────────────────────────────────────

type TextCall = (args: TextCallArgs) => Promise<RouterResult>
type StreamCall = (args: StreamCallArgs) => Promise<RouterResult>

const TEXT_CALLS: Record<ProviderName, TextCall> = {
  openai: callOpenAIText,
  anthropic: callAnthropicText,
  xai: callXaiText,
  deepseek: callDeepSeekText,
}

const STREAM_CALLS: Record<ProviderName, StreamCall> = {
  openai: callOpenAIStream,
  anthropic: callAnthropicStream,
  // Non-streaming providers simulate by calling onText once with the full result
  xai: async (args) => {
    const result = await callXaiText(args)
    if (result.ok) args.onText(result.text, result.text)
    return result
  },
  deepseek: async (args) => {
    const result = await callDeepSeekText(args)
    if (result.ok) args.onText(result.text, result.text)
    return result
  },
}

// ─── Public router functions ──────────────────────────────────────────────────

export async function routeTextCall(args: {
  messages: RouterMessage[]
  maxTokens?: number
  temperature?: number
  image?: RouterImage | null
  skipCache?: boolean
  preferredAnthropicModel?: string
  profile?: ProviderProfile
}): Promise<RouterResult> {
  // NOTE: the spend guard is NOT here. It lives in the provider clients this router delegates to
  // (`lib/openai-client`, `lib/xai-client`, `lib/deepseek-client`) — the point where a request
  // actually leaves. Guarding the router instead would refuse callers that inject or mock a client
  // and would therefore never have spent anything.
  const order = getProviderOrder()
  const attempts: string[] = []

  for (const provider of order) {
    try {
      return await withTimeout(TEXT_CALLS[provider](args), PROVIDER_TIMEOUT_MS, provider)
    } catch (error: unknown) {
      const norm = normalizeProviderError(error)
      console.error('[provider-router] text provider failed:', {
        provider,
        category: norm.category,
        status: norm.status,
      })
      attempts.push(`${provider}:${norm.category}`)
      if (!norm.fallbackEligible) break
    }
  }

  console.error('[provider-router] all text providers exhausted:', attempts.join(', '))
  return { ok: false }
}

export async function routeStreamCall(args: {
  messages: RouterMessage[]
  maxTokens?: number
  temperature?: number
  image?: RouterImage | null
  preferredAnthropicModel?: string
  profile?: ProviderProfile
  onText: (delta: string, snapshot: string) => void
}): Promise<RouterResult> {
  const order = getProviderOrder()
  const attempts: string[] = []

  for (const provider of order) {
    try {
      return await withTimeout(STREAM_CALLS[provider](args), PROVIDER_TIMEOUT_MS, provider)
    } catch (error: unknown) {
      const norm = normalizeProviderError(error)
      console.error('[provider-router] stream provider failed:', {
        provider,
        category: norm.category,
        status: norm.status,
      })
      attempts.push(`${provider}:${norm.category}`)
      if (!norm.fallbackEligible) break
    }
  }

  console.error('[provider-router] all streaming providers exhausted:', attempts.join(', '))
  return { ok: false }
}
