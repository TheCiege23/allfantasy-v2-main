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
}

export interface DeepSeekResult {
  content: string
  model?: string
  usage?: { promptTokens: number; completionTokens: number }
  error?: string
}

export async function deepseekChat(
  options: DeepSeekChatOptions
): Promise<DeepSeekResult> {
  const key = cacheKey('deepseek', options.prompt, options.systemPrompt, options.model)
  if (options.signal) return _deepseekChatUncached(options) // cancellable calls bypass the cache
  return cachedFetch(key, 1800, () => _deepseekChatUncached(options))
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

    const content = response.choices[0]?.message?.content ?? ''
    return {
      content,
      model: runtimeModel,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      },
    }
  } catch (e: any) {
    console.error('[DeepSeek] Chat error:', String(e?.message ?? e).slice(0, 240))
    return { content: '', model: model?.trim() || cfg.model || 'deepseek-chat', error: e?.message ?? 'DeepSeek unavailable' }
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
