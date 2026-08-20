import { getXaiConfigFromEnv } from '@/lib/provider-config'
import { assertAiSpendAllowed } from '@/lib/ai/aiSpendGuard'
import { cachedFetch, cacheKey } from '@/lib/api-cache'
type ChatMessage = { role: "system" | "user" | "assistant"; content: string }

export type XaiToolXSearch = {
  type: "x_search"
  from_date?: string
  to_date?: string
  allowed_x_handles?: string[]
  excluded_x_handles?: string[]
  enable_image_understanding?: boolean
}

export type XaiToolWebSearch = {
  type: "web_search"
  allowed_domains?: string[]
  excluded_domains?: string[]
  enable_image_understanding?: boolean
  user_location_country?: string
  user_location_city?: string
  user_location_region?: string
  user_location_timezone?: string
}

export type XaiTool = XaiToolXSearch | XaiToolWebSearch

// --- Chat Completions API types (legacy, no search tools) ---

export type XaiUsageDetails = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: {
    text_tokens?: number
    audio_tokens?: number
    image_tokens?: number
    cached_tokens?: number
  }
  completion_tokens_details?: {
    reasoning_tokens?: number
    audio_tokens?: number
    accepted_prediction_tokens?: number
    rejected_prediction_tokens?: number
  }
  num_sources_used?: number
}

export type XaiChoiceMessage = {
  role: "assistant"
  content: string | null
  refusal?: string | null
  reasoning_content?: string | null
}

export type XaiChoice = {
  index: number
  message: XaiChoiceMessage
  finish_reason?: "stop" | "length" | "tool_calls" | "content_filter" | string
}

export type XaiChatCompletionResponse = {
  id?: string
  object?: string
  created?: number
  model?: string
  system_fingerprint?: string | null
  choices?: XaiChoice[]
  usage?: XaiUsageDetails
}

export type XaiChatJsonResult =
  | { ok: true; status: number; json: XaiChatCompletionResponse; _responsesRaw?: XaiResponsesResponse; _annotations?: XaiResponsesAnnotation[]; _sourcesUsed?: number; _serverToolsUsed?: number }
  | { ok: false; status: number; details: string }

function getXaiRuntimeConfig():
  | { ok: true; apiKey: string; baseUrl: string; model: string }
  | { ok: false; details: string } {
  const cfg = getXaiConfigFromEnv()
  if (!cfg) {
    return { ok: false, details: "xAI provider unavailable. Set XAI_API_KEY." }
  }
  return {
    ok: true,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
  }
}

export async function xaiChatJson(opts: {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: XaiTool[]
  topP?: number
  n?: number
  stop?: string | string[]
  presencePenalty?: number
  frequencyPenalty?: number
  responseFormat?: { type: "text" | "json_object" }
  seed?: number
  skipCache?: boolean
  /** Cancels the underlying fetch. A signalled call bypasses the cache. */
  signal?: AbortSignal
}) : Promise<XaiChatJsonResult> {
  // Before the cache lookup as well as the call: a cache MISS goes straight to the provider, so
  // guarding only the uncached path would still spend on the first request after a restart.
  assertAiSpendAllowed('xai-client.xaiChatJson')
  if (opts.skipCache || opts.signal) return _xaiChatJsonUncached(opts)
  const key = cacheKey('xai-chat', opts.messages, opts.model, opts.temperature)
  return cachedFetch(key, 1800, () => _xaiChatJsonUncached(opts))
}

async function _xaiChatJsonUncached(opts: {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: XaiTool[]
  topP?: number
  n?: number
  stop?: string | string[]
  presencePenalty?: number
  frequencyPenalty?: number
  responseFormat?: { type: "text" | "json_object" }
  seed?: number
  signal?: AbortSignal
}) : Promise<XaiChatJsonResult> {
  const runtime = getXaiRuntimeConfig()
  if (!runtime.ok) {
    return { ok: false, status: 503, details: runtime.details }
  }

  const hasSearchTools = opts.tools && opts.tools.length > 0
  if (hasSearchTools) {
    return xaiResponsesJsonInternal(opts, runtime.apiKey, runtime.baseUrl, runtime.model)
  }

  const body: Record<string, unknown> = {
    model: opts.model ?? runtime.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 700,
  }

  if (opts.topP !== undefined) body.top_p = opts.topP
  if (opts.n !== undefined) body.n = opts.n
  if (opts.stop !== undefined) body.stop = opts.stop
  if (opts.presencePenalty !== undefined) body.presence_penalty = opts.presencePenalty
  if (opts.frequencyPenalty !== undefined) body.frequency_penalty = opts.frequencyPenalty
  if (opts.responseFormat !== undefined) body.response_format = opts.responseFormat
  if (opts.seed !== undefined) body.seed = opts.seed

  const res = await fetch(`${runtime.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  const text = await res.text().catch(() => "")
  if (!res.ok) return { ok: false, status: res.status, details: text.slice(0, 3000) }

  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, status: 500, details: `Failed to parse xAI JSON. Raw: ${text.slice(0, 3000)}` }
  }

  return { ok: true, status: res.status, json }
}

// --- Responses API types (current, supports search tools) ---

export type XaiResponsesAnnotation = {
  type?: string
  url?: string
  title?: string
  start_index?: number
  end_index?: number
}

export type XaiResponsesContentItem = {
  type?: string
  text?: string
  logprobs?: any[]
  annotations?: XaiResponsesAnnotation[]
}

export type XaiResponsesOutputItem = {
  content?: XaiResponsesContentItem[]
  id?: string
  role?: string
  type?: string
  status?: string
  summary?: Array<{ text?: string; type?: string }>
}

export type XaiResponsesUsage = {
  input_tokens?: number
  input_tokens_details?: {
    cached_tokens?: number
    text_tokens?: number
    audio_tokens?: number
    image_tokens?: number
  }
  output_tokens?: number
  output_tokens_details?: {
    reasoning_tokens?: number
    audio_tokens?: number
  }
  total_tokens?: number
  num_sources_used?: number
  num_server_side_tools_used?: number
  cost_in_usd_ticks?: number
}

export type XaiResponsesResponse = {
  id?: string
  object?: string
  created_at?: number
  completed_at?: number
  model?: string
  status?: "completed" | "in_progress" | "incomplete" | string
  output?: XaiResponsesOutputItem[]
  usage?: XaiResponsesUsage
  reasoning?: { effort?: string; summary?: string } | null
  tools?: any[]
  tool_choice?: string | object
  parallel_tool_calls?: boolean
  previous_response_id?: string | null
  store?: boolean
  error?: { message?: string; type?: string; code?: string } | null
  incomplete_details?: any
}

export type XaiResponsesJsonResult =
  | { ok: true; status: number; json: XaiResponsesResponse }
  | { ok: false; status: number; details: string }

async function xaiResponsesJsonInternal(opts: {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: XaiTool[]
  topP?: number
  n?: number
  stop?: string | string[]
  responseFormat?: { type: "text" | "json_object" }
  seed?: number
}, apiKey: string, baseUrl: string, defaultModel: string): Promise<XaiChatJsonResult> {
  const input = opts.messages.map(m => ({
    role: m.role,
    content: m.content,
  }))

  const body: Record<string, unknown> = {
    model: opts.model ?? defaultModel,
    input,
  }

  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools
  }
  if (opts.temperature !== undefined) body.temperature = opts.temperature ?? 0.4
  if (opts.maxTokens !== undefined) body.max_output_tokens = opts.maxTokens ?? 700
  if (opts.topP !== undefined) body.top_p = opts.topP
  if (opts.stop !== undefined) body.stop = opts.stop
  if (opts.seed !== undefined) body.seed = opts.seed
  if (opts.responseFormat !== undefined) {
    body.text = { format: opts.responseFormat }
  }

  const res = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const text = await res.text().catch(() => "")
  if (!res.ok) return { ok: false, status: res.status, details: text.slice(0, 3000) }

  let responsesJson: XaiResponsesResponse
  try {
    responsesJson = JSON.parse(text)
  } catch {
    return { ok: false, status: 500, details: `Failed to parse xAI Responses JSON. Raw: ${text.slice(0, 3000)}` }
  }

  const outputText = parseTextFromXaiResponse(responsesJson)
  const chatJson: XaiChatCompletionResponse = {
    id: responsesJson.id,
    object: "chat.completion",
    created: responsesJson.created_at,
    model: responsesJson.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: outputText,
      },
      finish_reason: responsesJson.status === "completed" ? "stop" : (responsesJson.status ?? "stop"),
    }],
    usage: responsesJson.usage ? {
      prompt_tokens: responsesJson.usage.input_tokens,
      completion_tokens: responsesJson.usage.output_tokens,
      total_tokens: responsesJson.usage.total_tokens,
      prompt_tokens_details: responsesJson.usage.input_tokens_details ? {
        text_tokens: responsesJson.usage.input_tokens_details.text_tokens,
        audio_tokens: responsesJson.usage.input_tokens_details.audio_tokens,
        image_tokens: responsesJson.usage.input_tokens_details.image_tokens,
        cached_tokens: responsesJson.usage.input_tokens_details.cached_tokens,
      } : undefined,
      completion_tokens_details: responsesJson.usage.output_tokens_details ? {
        reasoning_tokens: responsesJson.usage.output_tokens_details.reasoning_tokens,
        audio_tokens: responsesJson.usage.output_tokens_details.audio_tokens,
      } : undefined,
      num_sources_used: responsesJson.usage.num_sources_used,
    } : undefined,
  }

  return {
    ok: true as const,
    status: res.status,
    json: chatJson,
    _responsesRaw: responsesJson,
    _annotations: extractAnnotations(responsesJson),
    _sourcesUsed: responsesJson.usage?.num_sources_used ?? 0,
    _serverToolsUsed: responsesJson.usage?.num_server_side_tools_used ?? 0,
  }
}

export async function xaiResponsesJson(opts: {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: XaiTool[]
  topP?: number
  stop?: string | string[]
  responseFormat?: { type: "text" | "json_object" }
  seed?: number
  store?: boolean
  reasoning?: { effort?: "low" | "medium" | "high"; summary?: "auto" | "concise" | "detailed" }
  skipCache?: boolean
}): Promise<XaiResponsesJsonResult> {
  if (opts.skipCache) return _xaiResponsesJsonUncached(opts)
  const key = cacheKey('xai-responses', opts.messages, opts.model, opts.temperature)
  return cachedFetch(key, 1800, () => _xaiResponsesJsonUncached(opts))
}

async function _xaiResponsesJsonUncached(opts: {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: XaiTool[]
  topP?: number
  stop?: string | string[]
  responseFormat?: { type: "text" | "json_object" }
  seed?: number
  store?: boolean
  reasoning?: { effort?: "low" | "medium" | "high"; summary?: "auto" | "concise" | "detailed" }
}): Promise<XaiResponsesJsonResult> {
  const runtime = getXaiRuntimeConfig()
  if (!runtime.ok) {
    return { ok: false, status: 503, details: runtime.details }
  }

  const input = opts.messages.map(m => ({
    role: m.role,
    content: m.content,
  }))

  const body: Record<string, unknown> = {
    model: opts.model ?? runtime.model,
    input,
  }

  if (opts.tools && opts.tools.length > 0) body.tools = opts.tools
  if (opts.temperature !== undefined) body.temperature = opts.temperature
  if (opts.maxTokens !== undefined) body.max_output_tokens = opts.maxTokens
  if (opts.topP !== undefined) body.top_p = opts.topP
  if (opts.stop !== undefined) body.stop = opts.stop
  if (opts.responseFormat !== undefined) body.text = { format: opts.responseFormat }
  if (opts.store !== undefined) body.store = opts.store
  if (opts.reasoning !== undefined) body.reasoning = opts.reasoning

  const res = await fetch(`${runtime.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const text = await res.text().catch(() => "")
  if (!res.ok) return { ok: false, status: res.status, details: text.slice(0, 3000) }

  let json: XaiResponsesResponse
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, status: 500, details: `Failed to parse xAI Responses JSON. Raw: ${text.slice(0, 3000)}` }
  }

  return { ok: true, status: res.status, json }
}

// --- Shared parsers ---

export function parseTextFromXaiChatCompletion(json: XaiChatCompletionResponse | any): string | null {
  const content = json?.choices?.[0]?.message?.content
  return typeof content === "string" ? content : null
}

export function parseTextFromXaiResponse(json: XaiResponsesResponse | any): string | null {
  if (!json?.output || !Array.isArray(json.output)) return null
  for (const item of json.output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === "output_text" && typeof c.text === "string") {
          return c.text
        }
      }
    }
  }
  return null
}

export function extractAnnotations(json: XaiResponsesResponse | any): XaiResponsesAnnotation[] {
  const annotations: XaiResponsesAnnotation[] = []
  if (!json?.output || !Array.isArray(json.output)) return annotations
  for (const item of json.output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (Array.isArray(c.annotations)) {
          annotations.push(...c.annotations)
        }
      }
    }
  }
  return annotations
}

export function extractReasoningSummary(json: XaiResponsesResponse | any): string | null {
  if (!json?.output || !Array.isArray(json.output)) return null
  for (const item of json.output) {
    if (item.type === "reasoning" && Array.isArray(item.summary)) {
      return item.summary.map((s: any) => s.text || "").filter(Boolean).join("\n")
    }
  }
  return null
}

export function parseReasoningFromXaiChatCompletion(json: XaiChatCompletionResponse | any): string | null {
  const reasoning = json?.choices?.[0]?.message?.reasoning_content
  return typeof reasoning === "string" ? reasoning : null
}

export function parseFinishReason(json: XaiChatCompletionResponse | any): string | null {
  const reason = json?.choices?.[0]?.finish_reason
  return typeof reason === "string" ? reason : null
}

export function parseUsage(json: XaiChatCompletionResponse | any): XaiUsageDetails | null {
  return json?.usage ?? null
}

export function parseSystemFingerprint(json: XaiChatCompletionResponse | any): string | null {
  return json?.system_fingerprint ?? null
}

export function parseRefusal(json: XaiChatCompletionResponse | any): string | null {
  const refusal = json?.choices?.[0]?.message?.refusal
  return typeof refusal === "string" ? refusal : null
}

