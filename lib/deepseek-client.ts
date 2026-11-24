import OpenAI from 'openai'
import { getDeepSeekConfigFromEnv } from '@/lib/provider-config'
import { assertAiSpendAllowed } from '@/lib/ai/aiSpendGuard'
import { cachedFetch, cacheKey } from '@/lib/api-cache'

let deepseekClient: OpenAI | null = null

function getDeepSeekClient(): OpenAI | null {
  const cfg = getDeepSeekConfigFromEnv()
  if (!cfg) return null
  // Checked after config resolution but before the client exists: no config already means no spend,
  // and this is the last point before a real client is handed out.
  assertAiSpendAllowed('deepseek-client')
  if (!deepseekClient) {
    deepseekClient = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl,
    })
  }
  return deepseekClient
}

export interface DeepSeekChatOptions {
  prompt: string
  systemPrompt?: string
  model?: string
  temperature?: number
  maxTokens?: number
  /** Cancels the underlying HTTP request (OpenAI-compatible SDK). A signalled call bypasses the cache. */
  signal?: AbortSignal
  /** Bypass the 30-minute response cache, as `skipCache` already does for the OpenAI and xAI clients. */
  skipCache?: boolean
}

export interface DeepSeekResult {
  content: string
  model?: string
  usage?: { promptTokens: number; completionTokens: number }
  error?: string
  /** The provider's stop reason; `length` means the reply hit maxTokens and is cut off. */
  finishReason?: string | null
  /** HTTP status of a failed call, when the provider sent one (429, 500…). */
  status?: number
  /**
   * Length of the model's reasoning (`reasoning_content`), 0 when it sent none. A reasoning model can
   * spend the whole maxTokens thinking and return an EMPTY answer with HTTP 200 — this says whether
   * that is what happened, which nothing recorded before (2026-11-23).
   */
  reasoningChars?: number
}

export async function deepseekChat(
  options: DeepSeekChatOptions
): Promise<DeepSeekResult> {
  const key = cacheKey('deepseek', options.prompt, options.systemPrompt, options.model)
  if (options.signal || options.skipCache) return _deepseekChatUncached(options) // cancellable calls bypass the cache
  /*
   * 🛑 ONLY A WHOLE ANSWER IS CACHED. The default `shouldCache` stored every result for 30 minutes —
   * including `{ content: '', error }` from a timeout or a 5xx, and a reply cut off at maxTokens. One
   * transient failure then failed every identical request for half an hour, and a retry could not
   * help because it was served the stored failure. (Found 2026-11-15 chasing "Chimmy is unavailable".)
   */
  return cachedFetch(key, 1800, () => _deepseekChatUncached(options), (r) => !r.error && Boolean(r.content?.trim()) && r.finishReason !== 'length')
}

async function _deepseekChatUncached(
  options: DeepSeekChatOptions
): Promise<DeepSeekResult> {
  const {
    prompt,
    systemPrompt = 'You are a quantitative fantasy sports analyst.',
    model,
    temperature = 0.2,
    maxTokens = 1000,
  } = options

  const cfg = getDeepSeekConfigFromEnv()
  if (!cfg) {
    return {
      content: '',
      error: 'DeepSeek unavailable (missing DEEPSEEK_API_KEY)',
    }
  }

  const client = getDeepSeekClient()
  if (!client) {
    return {
      content: '',
      error: 'DeepSeek client unavailable',
    }
  }

  try {
    const runtimeModel = model?.trim() || cfg.model || 'deepseek-chat'
    const response = await client.chat.completions.create(
      {
        model: runtimeModel,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      },
      { signal: options.signal },
    )

    const message = response.choices[0]?.message
    const content = message?.content ?? ''
    // Not in the OpenAI SDK's types: DeepSeek's own field for a reasoning model's thinking.
    const reasoning = (message as { reasoning_content?: unknown } | undefined)?.reasoning_content
    return {
      content,
      finishReason: response.choices[0]?.finish_reason ?? null,
      reasoningChars: typeof reasoning === 'string' ? reasoning.length : 0,
      model: runtimeModel,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      },
    }
  } catch (e: any) {
    console.error('[DeepSeek] Chat error:', String(e?.message ?? e).slice(0, 240))
    return {
      content: '',
      model: model?.trim() || cfg.model || 'deepseek-chat',
      error: e?.message ?? 'DeepSeek unavailable',
      ...(typeof e?.status === 'number' ? { status: e.status } : {}),
    }
  }
}

export async function deepseekQuantAnalysis(
  prompt: string
): Promise<{ json: Record<string, any> | null; raw: string; error?: string }> {
  const result = await deepseekChat({
    prompt,
    systemPrompt: `You are a quantitative fantasy sports engine. 
Always respond in valid JSON only. No markdown. No explanation outside JSON.`,
    temperature: 0.1,
    maxTokens: 1200,
  })

  if (result.error || !result.content) {
    return { json: null, raw: '', error: result.error }
  }

  try {
    const cleaned = result.content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()

    const json = JSON.parse(cleaned)
    return { json, raw: result.content }
  } catch {
    console.warn('[DeepSeek] Failed to parse JSON from response:', result.content.slice(0, 200))
    return { json: null, raw: result.content, error: 'Invalid JSON in response' }
  }
}
