/**
 * The rollout table callers should actually read: `DEFAULT_ROLLOUTS` with any env overrides applied.
 *
 * `rollout.ts` stays PURE (no env reads), so the env lookup lives here. Each overridable flag maps to
 * one variable, parsed by `parseRolloutEnv` — so a widening or an incident pull-back is one variable
 * rather than a commit. Accepted values: `off`, `on`, a percentage (`25`), or `25|user_a,user_b`.
 *
 * ⚠ AN UNPARSEABLE VALUE KEEPS THE CODE DEFAULT, NOT OFF — `parseRolloutEnv`'s own rule, for the reason
 * written there. And on Railway, writing a variable IS a deploy (CLAUDE.md), so this is a faster lever
 * than a commit, not a free one.
 */

import { DEFAULT_ROLLOUTS, parseRolloutEnv, type RolloutRule } from './rollout'

/** Flag → the env variable that overrides it. A flag absent here is code-default only. */
export const ROLLOUT_ENV_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  'sports-os.screen-summaries': 'SPORTS_OS_SCREEN_SUMMARIES_ROLLOUT',
  'sports-os.reaction-invalidation': 'SPORTS_OS_REACTION_INVALIDATION_ROLLOUT',
  'sports-os.ingest-reactions': 'SPORTS_OS_INGEST_REACTIONS_ROLLOUT',
})

export function resolveRollouts(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<Record<string, RolloutRule>> {
  const out: Record<string, RolloutRule> = { ...DEFAULT_ROLLOUTS }
  for (const [flag, variable] of Object.entries(ROLLOUT_ENV_OVERRIDES)) {
    const fallback = DEFAULT_ROLLOUTS[flag]
    if (fallback) out[flag] = parseRolloutEnv(env[variable], fallback)
  }
  return Object.freeze(out)
}
