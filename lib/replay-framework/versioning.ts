/**
 * Decision OS Replay Framework — version resolution, per
 * docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md §2.2 and §4 ("Version replay
 * results"). A backtest result is keyed by (modelVersion, engineVersionHash,
 * deterministicConfigVersion) so re-running a backtest after a future
 * engine/config change produces a new row rather than overwriting history —
 * this is what makes cross-version offline evaluation possible.
 */

/**
 * Stable, human-readable identifier for the scoring *approach*. Changes only
 * when the shape of the deterministic trade-scoring algorithm itself changes
 * (not for every commit) — distinct from `engineVersionHash`, which changes
 * on every commit to the engine's implementation.
 */
export const TRADE_MODEL_VERSION = 'trade-engine-deterministic-v1'

/** Same convention as `TRADE_MODEL_VERSION`, for the Phase 13 Lineup Replay scenario. */
export const LINEUP_MODEL_VERSION = 'lineup-optimizer-deterministic-v1'

/**
 * Reuses the exact same env-var precedence already established by
 * app/api/af-debug/sha/route.ts for identifying which commit is running —
 * not a new convention.
 */
export function resolveEngineVersionHash(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.BUILD_SHA ||
    env.RAILWAY_GIT_COMMIT_SHA ||
    env.VERCEL_GIT_COMMIT_SHA ||
    env.NEXT_PUBLIC_BUILD_SHA ||
    'dev'
  )
}

/**
 * Identifies the specific tunable configuration used to produce a given
 * backtest — distinct from `engineVersionHash`, since a tunable config value
 * (e.g. trade's `calibratedB0`) can change without any code change at all
 * (via `promoteShadowB0()`).
 *
 * Generalized in Phase 13 (per the Phase 11 ADR §8.1's own recommendation
 * to defer this exact generalization until a real second consumer existed):
 * trade's original call site passed a bare `calibratedB0` number — preserved
 * exactly, byte-identical output (`b0:${value.toFixed(4)}`), so no existing
 * caller or test needed to change. A generic `Record<string, string|number>`
 * descriptor form was added alongside it for decision types with a
 * different-shaped (or absent) tunable config — Lineup Replay has no tunable
 * config at all today, so its call site passes `{}`, which stably resolves
 * to the literal `'none'` rather than an empty, ambiguous string.
 */
export function computeDeterministicConfigVersion(config: Record<string, string | number> | number): string {
  if (typeof config === 'number') {
    return `b0:${config.toFixed(4)}`
  }
  const entries = Object.entries(config)
  if (entries.length === 0) return 'none'
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${typeof value === 'number' ? value.toFixed(4) : value}`)
    .join(',')
}
