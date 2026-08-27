/**
 * Task-aware provider selection.
 *
 * `AI_PROVIDER_ORDER` (see providerRouter) is a FAILOVER chain: whichever
 * provider is listed first answers essentially everything, and the rest only
 * see traffic when it errors. That is the right shape for resilience and the
 * wrong shape for cost, because it cannot express "cheap provider for bulk
 * work, expensive provider for the handful of things a user actually reads".
 *
 * This module adds the missing axis. It maps a FeatureKey to the provider best
 * suited to it; providerRouter then moves that provider to the FRONT of the
 * existing chain for that one call. Failover is unchanged — every other
 * provider stays behind it in the same relative order, so a preferred provider
 * being down degrades to the normal chain instead of failing the request.
 *
 * Deliberate constraint: a preference is only honoured if that provider is
 * already present in `AI_PROVIDER_ORDER`. The env chain remains the single
 * allowlist, so a stale mapping here can never resurrect a provider that was
 * removed for having a dead key or an unpaid balance.
 *
 * Cost shape this encodes (verified live 2026-08-27):
 *   deepseek  — bulk/derived text. Roughly an order of magnitude cheaper than
 *               the others, and these outputs are mostly restatements of math
 *               already computed in `computeInsights`, so model prose quality
 *               barely moves the result.
 *   xai       — anything whose value decays in hours. Grok has first-party X
 *               access, which is what makes late-breaking injury and waiver
 *               chatter worth paying for.
 *   anthropic — text a user reads as AllFantasy's voice. Tone is the product
 *               here, so this is where premium spend earns its keep.
 */

import type { FeatureKey } from '@/lib/ai/engine/types'
import type { ProviderName } from '@/lib/ai/providerRouter'

export type TaskRoute = {
  provider: ProviderName
  /** Why this task routes here. Surfaced in admin logs, never to end users. */
  rationale: string
}

const BULK = 'Derived from precomputed insights; cheapest capable provider.'
const REALTIME = 'Value decays quickly; needs live X/web grounding.'
const VOICE = 'User-facing prose in the AllFantasy voice; tone is the product.'

/**
 * Only FeatureKeys with a deliberate opinion appear here. `FeatureKey` is
 * intentionally open (`string & {}`), so an unmapped or newly added feature
 * resolves to `null` and uses the plain chain — new features fail toward the
 * existing behaviour rather than toward a silent cost surprise.
 */
const TASK_ROUTES: Partial<Record<FeatureKey, TaskRoute>> = {
  // ── Bulk / derived → DeepSeek ──────────────────────────────────────────────
  power_rankings:         { provider: 'deepseek',  rationale: BULK },
  at_risk:                { provider: 'deepseek',  rationale: BULK },
  pool_swing:             { provider: 'deepseek',  rationale: BULK },
  champion_risk:          { provider: 'deepseek',  rationale: BULK },
  rooting_guide:          { provider: 'deepseek',  rationale: BULK },
  bracket_recommendation: { provider: 'deepseek',  rationale: BULK },

  // ── Time-sensitive → Grok ─────────────────────────────────────────────────
  injury_report:          { provider: 'xai',       rationale: REALTIME },
  waiver_wire:            { provider: 'xai',       rationale: REALTIME },

  // ── User-facing voice → Claude ────────────────────────────────────────────
  pool_chat:              { provider: 'anthropic', rationale: VOICE },
  private_ai:             { provider: 'anthropic', rationale: VOICE },
  trade_eval:             { provider: 'anthropic', rationale: VOICE },
  lineup_advice:          { provider: 'anthropic', rationale: VOICE },
  draft_advice:           { provider: 'anthropic', rationale: VOICE },
  matchup_preview:        { provider: 'anthropic', rationale: VOICE },
  commissioner_insights:  { provider: 'anthropic', rationale: VOICE },
  recap:                  { provider: 'anthropic', rationale: VOICE },
  trash_talk:             { provider: 'anthropic', rationale: VOICE },
  social_invite:          { provider: 'anthropic', rationale: VOICE },
  hype:                   { provider: 'anthropic', rationale: VOICE },
  tomorrow_hype:          { provider: 'anthropic', rationale: VOICE },
}

const VALID_PROVIDERS: readonly ProviderName[] = ['openai', 'anthropic', 'xai', 'deepseek']

function isProviderName(value: string): value is ProviderName {
  return (VALID_PROVIDERS as readonly string[]).includes(value)
}

/** Task routing is on unless explicitly disabled, so it can be killed without a deploy. */
export function isTaskRoutingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_TASK_ROUTING_ENABLED?.trim() !== 'false'
}

/**
 * Per-feature overrides without a code change, for tuning against a real bill.
 *
 *   AI_TASK_PROVIDER_OVERRIDES="pool_chat:deepseek,recap:xai"
 *
 * Malformed pairs are skipped rather than throwing — a typo in an env var
 * should cost you the override, not the request.
 */
export function parseTaskProviderOverrides(
  env: NodeJS.ProcessEnv = process.env,
): Partial<Record<string, ProviderName>> {
  const raw = env.AI_TASK_PROVIDER_OVERRIDES?.trim()
  if (!raw) return {}
  const out: Partial<Record<string, ProviderName>> = {}
  for (const pair of raw.split(',')) {
    const [feature, provider] = pair.split(':').map((s) => s?.trim().toLowerCase())
    if (!feature || !provider || !isProviderName(provider)) continue
    out[feature] = provider
  }
  return out
}

/**
 * Preferred provider for a feature, or `null` to use the unmodified chain.
 *
 * Returning `null` is a normal outcome, not an error: unmapped features, and
 * routing being disabled, both mean "no opinion".
 */
export function resolveProviderForFeature(
  feature: FeatureKey | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): TaskRoute | null {
  if (!feature || !isTaskRoutingEnabled(env)) return null

  const key = String(feature).trim().toLowerCase()
  const override = parseTaskProviderOverrides(env)[key]
  if (override) {
    return { provider: override, rationale: 'AI_TASK_PROVIDER_OVERRIDES env override.' }
  }

  return TASK_ROUTES[key as FeatureKey] ?? null
}

/** Read-only view of the built-in map, for admin/diagnostic surfaces. */
export function getTaskRouteTable(): Readonly<Partial<Record<FeatureKey, TaskRoute>>> {
  return TASK_ROUTES
}
