/**
 * AI Provider Fallback Router
 *
 * Tries providers in configured order. Falls back on billing, rate-limit,
 * 5xx, timeout, or network failure. Halts immediately on content-filter
 * refusals (other providers would also refuse) and on the AI spend kill switch
 * (it is global — every provider is off, so trying the next one only risks a
 * provider that forgot to check).
 *
 * Configure order via AI_PROVIDER_ORDER env var (comma-separated):
 *   AI_PROVIDER_ORDER=openai,anthropic,xai,deepseek
 *
 * Users never see which provider answered. Admin logs include provider attempts.
 */

import { assertAiSpendAllowed } from '@/lib/ai/aiSpendGuard'
import { normalizeProviderError } from '@/lib/ai/providerErrors'
import {
  resolveOpenAIModel,
  resolveAnthropicModel,
  resolveXaiModel,
  resolveDeepSeekModel,
  type ProviderProfile,
} from '@/lib/ai/providerProfiles'
import { openaiChatText, openaiChatTextStream } from '@/lib/openai-client'
import { xaiChatJson, parseFinishReason, parseTextFromXaiChatCompletion } from '@/lib/xai-client'
import { deepseekChat } from '@/lib/deepseek-client'
import { rateLimitManager } from '@/lib/workers/rate-limit-manager'
import { anthropicTokenUsage, recordLlmCall, type LlmTokenUsage } from '@/lib/telemetry/llm-usage'

export type ProviderName = 'openai' | 'anthropic' | 'xai' | 'deepseek'
export type { ProviderProfile }

export type RouterMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type RouterImage = {
  data: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
}

export type RouterResult =
  | {
      ok: true
      text: string
      model: string
      provider: ProviderName
      tokensUsed: number
      /** Split token counts, where the provider path exposes them (Anthropic). Used for spend metering. */
      usage?: LlmTokenUsage | null
      /**
       * True when the provider stopped because it hit `maxTokens` (Anthropic `stop_reason: max_tokens`,
       * OpenAI-shaped `finish_reason: length`). The text is a fragment, not a whole answer. Absent when
       * the provider path does not report a stop reason.
       */
      truncated?: boolean
    }
  | { ok: false; failure?: RouterFailure }

/**
 * Why every provider failed, with no prompt or answer text in it: one entry per attempt, plus
 * whether trying again shortly could plausibly succeed (rate limit, overload, 5xx, timeout, empty
 * reply) as opposed to a dead key, no credit, the spend kill switch or a content refusal.
 */
export type RouterFailure = {
  attempts: Array<{ provider: ProviderName; category: string; status: number | null }>
  retryable: boolean
}

/** Failure categories where the same request may succeed a moment later. */
const TRANSIENT_CATEGORIES = new Set(['rate_limit', 'overload', 'server_error', 'timeout', 'unknown', 'empty'])

/**
 * Who is spending, for `recordLlmCall`. Optional: a caller that passes nothing is recorded as
 * 'provider-router', which still counts the call. Naming the feature is what makes it visible.
 */
export type RouterMetering = {
  feature?: string
  userId?: string | null
  leagueId?: string | null
}

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

/**
 * Move `preferred` to the front of the chain, keeping every other provider in
 * its configured relative order behind it.
 *
 * A preference is IGNORED when that provider is not in the configured order.
 * `AI_PROVIDER_ORDER` stays the single allowlist: a provider removed for a dead
 * key or unpaid balance must stay removed, and a stale task mapping must not be
 * able to put it back into rotation.
 */
export function applyPreferredProvider(
  order: ProviderName[],
  preferred: ProviderName | null | undefined,
): ProviderName[] {
  if (!preferred || !order.includes(preferred)) return order
  return [preferred, ...order.filter((p) => p !== preferred)]
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
//
// 🛑 THIS ADAPTER IS A PROVIDER BOUNDARY, SO IT CARRIES THE SPEND GUARD ITSELF. The router's other
// three providers delegate to clients that check `aiSpendGuard` (`lib/openai-client`,
// `lib/xai-client`, `lib/deepseek-client`); this one builds its own Anthropic SDK client below, so
// until 2026-09-27 nothing checked the kill switch on this path. With spend OFF, a call that reached
// Anthropic — directly (`trade_eval` routes here) or by falling back after the guarded OpenAI client
// refused with a 503 — still spent. The guard runs first in both call functions: before the rate
// limiter, before the client is built, before any request leaves.

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
  // Throws, like the missing-key branch below: the router maps it to a non-fallback halt.
  assertAiSpendAllowed('provider-router:anthropic')
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
      usage: anthropicTokenUsage(response.usage),
      truncated: response.stop_reason === 'max_tokens',
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
  assertAiSpendAllowed('provider-router:anthropic-stream')
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
      usage: anthropicTokenUsage(finalMessage.usage),
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
  return { ok: true, text: result.text, model: result.model, provider: 'openai', tokensUsed: 0, truncated: result.finishReason === 'length' }
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
  const model = resolveXaiModel(args.profile ?? 'standard')
  const result = await xaiChatJson({
    messages: args.messages,
    model,
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
  const echoedModel = (result.json as { model?: string })?.model ?? model
  return { ok: true, text, model: echoedModel, provider: 'xai', tokensUsed: 0, truncated: parseFinishReason(result.json) === 'length' }
}

// ─── DeepSeek adapter ─────────────────────────────────────────────────────────

/** What lib/deepseek-client.ts asks for when the caller names no maxTokens. */
const DEEPSEEK_DEFAULT_MAX_TOKENS = 1000
/** The cut-off retry's ceiling: room for reasoning plus an answer, without an unbounded bill. */
const DEEPSEEK_RETRY_MAX_TOKENS = 8000

async function callDeepSeekText(args: TextCallArgs): Promise<RouterResult> {
  const { system, userContent } = extractSystemAndUser(args.messages)
  const model = resolveDeepSeekModel(args.profile ?? 'standard')
  const ask = (maxTokens: number | undefined, skipCache: boolean) =>
    deepseekChat({
      prompt: userContent,
      systemPrompt: system,
      model,
      maxTokens,
      temperature: args.temperature,
      // Was never passed, so DeepSeek cached for 30 min even when the caller asked it not to.
      skipCache,
    })
  let result = await ask(args.maxTokens, args.skipCache ?? false)
  /*
   * ⚠ AN EMPTY ANSWER CUT OFF AT THE LENGTH LIMIT (2026-11-23). From 2026-11-17 the router's DeepSeek
   * calls answered HTTP 200 with NO text, 101 times, while the same model answered Chimmy's tool loop,
   * which asks for far more tokens. A reasoning model can spend the whole budget thinking (900–1,400
   * here) and hit `length` before writing a word. That is not a failure of the provider, so one retry
   * with room to answer — never from the cache, which would hand back the same empty reply.
   */
  if (!result.error && !result.content?.trim() && result.finishReason === 'length') {
    const requested = args.maxTokens ?? DEEPSEEK_DEFAULT_MAX_TOKENS
    console.warn('[provider-router] deepseek answer cut off before any text; retrying with more room', {
      model,
      maxTokens: requested,
      reasoningChars: result.reasoningChars ?? null,
      completionTokens: result.usage?.completionTokens ?? null,
    })
    result = await ask(Math.min(Math.max(requested * 4, 4000), DEEPSEEK_RETRY_MAX_TOKENS), true)
  }
  if (result.error || !result.content?.trim()) {
    if (!result.error) {
      // Why it was empty, which no log said before: cut off, or a real empty answer.
      console.warn('[provider-router] deepseek returned no text', {
        model,
        finishReason: result.finishReason ?? null,
        reasoningChars: result.reasoningChars ?? null,
        completionTokens: result.usage?.completionTokens ?? null,
      })
    }
    /*
     * The REAL status where DeepSeek sent one. A blanket 503 classified every DeepSeek failure —
     * a 429, a timeout, a 500 — as "unavailable", the same bucket as a missing key, so a caller
     * could not tell "try again in a second" from "this provider is not configured". With no
     * status the message decides (a timeout reads as a timeout; a missing key as unavailable).
     */
    const status = result.status ?? (result.error ? undefined : 200)
    throw Object.assign(
      new Error(result.error ?? `DeepSeek returned no content (finish_reason=${result.finishReason ?? 'none'})`),
      status != null ? { status } : {},
    )
  }
  return {
    ok: true,
    text: result.content,
    model: result.model ?? model,
    provider: 'deepseek',
    tokensUsed: 0,
    truncated: result.finishReason === 'length',
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

/**
 * One metering row per provider ATTEMPT, not per answer. A failed attempt before a fallback is still
 * a request the provider saw, and the fallback chain is exactly what moved spend onto Anthropic when
 * OpenAI's billing lapsed. The one exception is the spend kill switch: nothing left the process, so
 * there is nothing to meter, and recording every blocked call would bury the real ones.
 */
function meterAttempt(
  args: RouterMetering & { maxTokens?: number },
  provider: ProviderName,
  result: RouterResult | null,
  startedAt: number,
  failureCategory: string | null,
): void {
  if (failureCategory === 'spend_disabled') return
  const ok = Boolean(result?.ok)
  recordLlmCall({
    feature: args.feature?.trim() || 'provider-router',
    provider,
    model: result && result.ok ? result.model : `unknown:${failureCategory ?? 'failed'}`,
    userId: args.userId ?? null,
    leagueId: args.leagueId ?? null,
    usage: result && result.ok ? result.usage ?? null : null,
    maxTokens: args.maxTokens ?? null,
    ok,
    durationMs: Date.now() - startedAt,
  })
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
  /**
   * Provider to try FIRST for this call, from task routing. Ignored unless it
   * is already in AI_PROVIDER_ORDER; the rest of the chain is preserved as
   * fallback, so a preferred provider being down degrades rather than fails.
   */
  preferredProvider?: ProviderName | null
  /**
   * Per-provider timeout for THIS call, in ms (clamped 5–120 s). Default: the router's 12 s, which
   * suits chat. A long structured transcription (a whole Yahoo draft-results page) needs more, and
   * a timeout that always fires is not a fallback — it just fails every provider in turn.
   */
  timeoutMs?: number
} & RouterMetering): Promise<RouterResult> {
  // NOTE: the spend guard is NOT in this loop. It lives at each provider boundary — the clients this
  // router delegates to (`lib/openai-client`, `lib/xai-client`, `lib/deepseek-client`) and the inline
  // Anthropic adapter above, the point where a request actually leaves. A refusal from any of them is
  // classified `spend_disabled` and ends the loop: the switch is global, so no later provider may spend.
  const order = applyPreferredProvider(getProviderOrder(), args.preferredProvider)
  const attempts: RouterFailure['attempts'] = []
  let halted = false

  for (const provider of order) {
    const startedAt = Date.now()
    try {
      const timeoutMs =
        args.timeoutMs != null ? Math.min(120_000, Math.max(5_000, args.timeoutMs)) : PROVIDER_TIMEOUT_MS
      const result = await withTimeout(TEXT_CALLS[provider](args), timeoutMs, provider)
      meterAttempt(args, provider, result, startedAt, null)
      /*
       * ⚠ AN EMPTY REPLY IS NOT AN ANSWER. OpenAI and Anthropic could return `ok: true` with '' — a
       * reasoning model that spends its whole `maxTokens` thinking does exactly that — and the
       * caller then showed a blank bubble. xAI and DeepSeek already threw on empty; now all four
       * fall through to the next provider the same way.
       */
      if (result.ok && !result.text.trim()) {
        console.error('[provider-router] text provider returned no text:', { provider, truncated: Boolean(result.truncated) })
        attempts.push({ provider, category: 'empty', status: 200 })
        continue
      }
      return result
    } catch (error: unknown) {
      const norm = normalizeProviderError(error)
      meterAttempt(args, provider, null, startedAt, norm.category)
      console.error('[provider-router] text provider failed:', {
        provider,
        category: norm.category,
        status: norm.status,
      })
      attempts.push({ provider, category: norm.category, status: norm.status })
      if (!norm.fallbackEligible) {
        halted = true
        break
      }
    }
  }

  console.error('[provider-router] all text providers exhausted:', attempts.map((a) => `${a.provider}:${a.category}`).join(', '))
  return {
    ok: false,
    failure: { attempts, retryable: !halted && attempts.some((a) => TRANSIENT_CATEGORIES.has(a.category)) },
  }
}

export async function routeStreamCall(args: {
  messages: RouterMessage[]
  maxTokens?: number
  temperature?: number
  image?: RouterImage | null
  preferredAnthropicModel?: string
  profile?: ProviderProfile
  /** See routeTextCall — provider tried first, ignored unless in AI_PROVIDER_ORDER. */
  preferredProvider?: ProviderName | null
  onText: (delta: string, snapshot: string) => void
} & RouterMetering): Promise<RouterResult> {
  const order = applyPreferredProvider(getProviderOrder(), args.preferredProvider)
  const attempts: string[] = []

  for (const provider of order) {
    const startedAt = Date.now()
    try {
      const result = await withTimeout(STREAM_CALLS[provider](args), PROVIDER_TIMEOUT_MS, provider)
      meterAttempt(args, provider, result, startedAt, null)
      return result
    } catch (error: unknown) {
      const norm = normalizeProviderError(error)
      meterAttempt(args, provider, null, startedAt, norm.category)
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
