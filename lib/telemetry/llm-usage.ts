import { logUsageEvent } from '@/lib/telemetry/usage'

/**
 * Per-call metering for paid LLM endpoints.
 *
 * `withApiUsage` records endpoint/status/duration/bytes but knows nothing about model spend, so an
 * abusive-but-authenticated caller looks identical to a cheap one in the usage rollups. This records
 * the model actually invoked and, where the provider returns it, the real token counts — attributed
 * to the calling user so spend can be traced per account.
 *
 * `openaiChatText` does not surface the provider's `usage` block (it resolves to `{ok, text, model,
 * baseUrl}`), so callers on that path pass `maxTokens` as the ceiling and leave token counts null.
 * Direct `chat.completions.create` callers pass the real `usage`. Never throws — metering must not
 * be able to fail a request that already succeeded.
 */
/**
 * Tokens one model call used, provider-neutral. Every field is optional: a path that cannot see the
 * provider's usage block records the call with nulls rather than skipping it. A call with unknown
 * tokens is still a call, and still a count.
 */
export type LlmTokenUsage = {
  inputTokens?: number | null
  outputTokens?: number | null
  /** Anthropic prompt-cache reads: billed at a fraction of input. */
  cacheReadTokens?: number | null
  /** Anthropic prompt-cache writes: billed ABOVE input. */
  cacheWriteTokens?: number | null
}

/** Anthropic's `usage` block, in the shape `recordLlmCall` takes. */
export function anthropicTokenUsage(
  usage:
    | {
        input_tokens?: number | null
        output_tokens?: number | null
        cache_read_input_tokens?: number | null
        cache_creation_input_tokens?: number | null
      }
    | null
    | undefined,
): LlmTokenUsage | null {
  if (!usage) return null
  return {
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    cacheReadTokens: usage.cache_read_input_tokens ?? null,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? null,
  }
}

/**
 * One model call, attributed to the FEATURE that made it. This is how the owner can see where AI
 * credit goes.
 *
 * ⚠ BEFORE THIS, SPEND BY FEATURE WAS INVISIBLE. On 2026-09-28 every provider ran out of credit at
 * once, and nothing in the app could say what had spent it. Chimmy's tool loop (Opus, up to 4
 * turns), the provider router (draft intel and most features) and the Opus "explain" adapter
 * recorded no tokens at all. The rate limiter's `api_call_log` keeps a count with no feature and no
 * tokens, and it held ONE Anthropic call for the whole week.
 *
 * Rows land in `ApiUsageEvent` with `tool = feature`, `endpoint = llm/<provider>/<model>` and
 * `meta.kind = 'llm_call'`, so the existing hourly/daily rollups group them by feature and model
 * with no new table.
 *
 * FIRE-AND-FORGET: it returns immediately and never throws. A metering write must not add latency
 * to an answer, or fail one.
 */
export function recordLlmCall(args: {
  /** What spent it, e.g. 'chimmy_tool_loop', 'draft_lookahead'. The grouping key for spend reports. */
  feature: string
  provider: string
  model: string
  userId?: string | null
  leagueId?: string | null
  usage?: LlmTokenUsage | null
  /** Configured ceiling, useful where exact counts are missing. */
  maxTokens?: number | null
  ok: boolean
  durationMs?: number | null
}): void {
  const u = args.usage ?? null
  const input = u?.inputTokens ?? null
  const output = u?.outputTokens ?? null
  void logUsageEvent({
    scope: 'api',
    tool: args.feature,
    endpoint: `llm/${args.provider}/${args.model}`.slice(0, 190),
    method: 'POST',
    ok: args.ok,
    durationMs: args.durationMs ?? undefined,
    userId: args.userId ?? undefined,
    leagueId: args.leagueId ?? undefined,
    meta: {
      kind: 'llm_call',
      provider: args.provider,
      model: args.model,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: u?.cacheReadTokens ?? null,
      cacheWriteTokens: u?.cacheWriteTokens ?? null,
      // Same keys `recordLlmUsage` writes, so one query reads both kinds of row.
      promptTokens: input,
      completionTokens: output,
      totalTokens: input != null && output != null ? input + output : null,
      maxTokens: args.maxTokens ?? null,
      tokensExact: input != null && output != null,
    },
  }).catch(() => {
    // Metering is best-effort; a telemetry failure must never surface to the caller.
  })
}

export async function recordLlmUsage(args: {
  endpoint: string
  tool: string
  userId: string
  model: string
  /** Provider-reported usage, when the call path exposes it. */
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null
  /** Configured ceiling for this call, recorded when exact counts are unavailable. */
  maxTokens?: number | null
  ok: boolean
}): Promise<void> {
  try {
    await logUsageEvent({
      scope: 'api',
      tool: args.tool,
      endpoint: args.endpoint,
      method: 'POST',
      ok: args.ok,
      userId: args.userId,
      meta: {
        kind: 'llm_call',
        model: args.model,
        promptTokens: args.usage?.prompt_tokens ?? null,
        completionTokens: args.usage?.completion_tokens ?? null,
        totalTokens: args.usage?.total_tokens ?? null,
        maxTokens: args.maxTokens ?? null,
        tokensExact: args.usage?.total_tokens != null,
      },
    })
  } catch {
    // Metering is best-effort; a telemetry failure must never surface to the caller.
  }
}
