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
