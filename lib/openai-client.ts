import OpenAI from 'openai'
import { getOpenAIConfigFromEnv } from '@/lib/provider-config'
import { cachedFetch, cacheKey } from '@/lib/api-cache'

export type OpenAIConfig = {
  apiKey: string
  baseUrl: string
  model: string
}

export function getOpenAIConfig(): OpenAIConfig {
  const config = getOpenAIConfigFromEnv()
  if (!config) throw new Error('OpenAI provider is not configured. Set OPENAI_API_KEY.')
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
  }
}

let _client: OpenAI | null = null

export function getOpenAIClient(): OpenAI {
  if (!_client) {
    const { apiKey, baseUrl } = getOpenAIConfig()
    _client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
    })
  }
  return _client
}

export async function openaiChatJson(args: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  temperature?: number
  maxTokens?: number
  skipCache?: boolean
  /** Cancels the underlying HTTP request. A signalled call bypasses the cache (a cache hit has no request to
   *  cancel; a cancellable request must reach the network). */
  signal?: AbortSignal
}): Promise<
  | { ok: true; json: any; model: string; baseUrl: string }
  | { ok: false; status: number; details: string; model: string; baseUrl: string }
> {
  const key = cacheKey('openai-json', args.messages, args.model, args.temperature)
  if (args.skipCache || args.signal) return _openaiChatJsonUncached(args)
  return cachedFetch(key, 1800, () => _openaiChatJsonUncached(args))
}

async function _openaiChatJsonUncached(args: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}): Promise<
  | { ok: true; json: any; model: string; baseUrl: string }
  | { ok: false; status: number; details: string; model: string; baseUrl: string }
> {
  let model = 'unavailable'
  let baseUrl = ''
  try {
    const cfg = getOpenAIConfig()
    model = args.model?.trim() || cfg.model
    baseUrl = cfg.baseUrl
  } catch {
    return {
      ok: false,
      status: 503,
      details: 'OpenAI provider unavailable. Set OPENAI_API_KEY.',
      model,
      baseUrl,
    }
  }

  const client = getOpenAIClient()

  try {
    const response = await client.chat.completions.create(
      {
        model,
        temperature: args.temperature ?? 0.7,
        max_completion_tokens: args.maxTokens ?? 1500,
        messages: args.messages,
        response_format: { type: 'json_object' },
      },
      { signal: args.signal },
    )

    return { ok: true, json: response, model, baseUrl }
  } catch (e: any) {
    const status = e?.status ?? e?.statusCode ?? 0
    const details = String(e?.message || e || '').slice(0, 800)
    return { ok: false, status, details, model, baseUrl }
  }
}

export async function openaiChatText(args: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  temperature?: number
  maxTokens?: number
  skipCache?: boolean
  signal?: AbortSignal
}): Promise<
  | { ok: true; text: string; model: string; baseUrl: string }
  | { ok: false; status: number; details: string; model: string; baseUrl: string }
> {
  const key = cacheKey('openai-text', args.messages, args.model, args.temperature)
  if (args.skipCache || args.signal) return _openaiChatTextUncached(args)
  return cachedFetch(key, 1800, () => _openaiChatTextUncached(args))
}

async function _openaiChatTextUncached(args: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}): Promise<
  | { ok: true; text: string; model: string; baseUrl: string }
  | { ok: false; status: number; details: string; model: string; baseUrl: string }
> {
  let model = 'unavailable'
  let baseUrl = ''
  try {
    const cfg = getOpenAIConfig()
    model = args.model?.trim() || cfg.model
    baseUrl = cfg.baseUrl
  } catch {
    return {
      ok: false,
      status: 503,
      details: 'OpenAI provider unavailable. Set OPENAI_API_KEY.',
      model,
      baseUrl,
    }
  }

  const client = getOpenAIClient()

  try {
    const response = await client.chat.completions.create(
      {
        model,
        temperature: args.temperature ?? 0.7,
        max_completion_tokens: args.maxTokens ?? 1500,
        messages: args.messages,
      },
      { signal: args.signal },
    )

    const content = response.choices?.[0]?.message?.content
    if (typeof content === 'string') {
      return { ok: true, text: content, model, baseUrl }
    }
    return { ok: false, status: 200, details: 'No content in response', model, baseUrl }
  } catch (e: any) {
    const status = e?.status ?? e?.statusCode ?? 0
    const details = String(e?.message || e || '').slice(0, 800)
    return { ok: false, status, details, model, baseUrl }
  }
}

export async function openaiChatTextStream(args: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  temperature?: number
  maxTokens?: number
}): Promise<
  | { ok: true; stream: AsyncIterable<string>; model: string; baseUrl: string }
  | { ok: false; status: number; details: string; model: string; baseUrl: string }
> {
  let model = 'unavailable'
  let baseUrl = ''
  try {
    const cfg = getOpenAIConfig()
    model = args.model?.trim() || cfg.model
    baseUrl = cfg.baseUrl
  } catch {
    return {
      ok: false,
      status: 503,
      details: 'OpenAI provider unavailable. Set OPENAI_API_KEY.',
      model,
      baseUrl,
    }
  }

  const client = getOpenAIClient()

  try {
    const streamResponse = (await client.chat.completions.create({
      model,
      temperature: args.temperature ?? 0.7,
      max_completion_tokens: args.maxTokens ?? 1500,
      messages: args.messages,
      stream: true,
    })) as any

    async function* iterateTextChunks() {
      for await (const chunk of streamResponse) {
        const delta = chunk?.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) {
          yield delta
        }
      }
    }

    return { ok: true, stream: iterateTextChunks(), model, baseUrl }
  } catch (e: any) {
    const status = e?.status ?? e?.statusCode ?? 0
    const details = String(e?.message || e || '').slice(0, 800)
    return { ok: false, status, details, model, baseUrl }
  }
}

export function parseJsonContentFromChatCompletion(data: any) {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return null
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}
