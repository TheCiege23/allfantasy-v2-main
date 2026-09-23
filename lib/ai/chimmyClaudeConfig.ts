/**
 * CHIMMY'S CLAUDE SETTINGS — ONE PLACE, TWO CALLERS.
 *
 * Claude is Chimmy's main model (user decision 2026-09-23). It answers in two places:
 *   - the tool loop, which runs first (`lib/chimmy/tools/chimmyToolLoop.ts`), and
 *   - the push/PECR path when the loop returns nothing (`lib/ai-orchestration/providers/anthropic-provider.ts`).
 * Both read their model and request options from here, so the two can never disagree about which
 * Claude Chimmy is.
 *
 * ⚠ NOT `resolveAnthropicModel` in `lib/ai/providerProfiles.ts`. That profile table serves every
 * other Anthropic caller in the app (its default is Sonnet); Chimmy's model is a separate product
 * decision with its own override.
 */

/**
 * Claude Opus 5 unless `CHIMMY_CLAUDE_MODEL` names another. Changing it is a cost decision for the
 * owner: `claude-sonnet-5` is roughly 40% of the per-token price.
 */
export const CHIMMY_CLAUDE_DEFAULT_MODEL = 'claude-opus-5'

export function resolveChimmyClaudeModel(override?: string | null): string {
  return override?.trim() || process.env.CHIMMY_CLAUDE_MODEL?.trim() || CHIMMY_CLAUDE_DEFAULT_MODEL
}

/**
 * Thinking is on (adaptive — the Opus 5 default), and these are chat turns, so `medium` effort:
 * enough reasoning for a start/sit or trade call without the latency of `high`.
 */
export const CHIMMY_CLAUDE_EFFORT = 'medium' as const

/** Room for adaptive thinking plus the answer. Thinking counts against it, so do not lowball it. */
export const CHIMMY_CLAUDE_MAX_TOKENS = 8000

/**
 * Server-side refusal fallback: on a policy decline the API re-runs the same request on a fallback
 * model inside the same call. Sent with `fallbacks: "default"`; every caller retries once WITHOUT it
 * on a 400, so this add-on can never take Chimmy down.
 */
export const CHIMMY_CLAUDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
}
