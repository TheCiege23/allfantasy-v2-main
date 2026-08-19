/**
 * Decision OS core — shadow-mode gating (domain-agnostic).
 *
 * A slice runs its Decision OS path in shadow only when its feature flag is `true`. Each slice binds
 * its own env var (e.g. DECISION_OS_LINEUP_SHADOW); this reader is generic.
 */
import { matchesDecisionShadowScope, type DecisionShadowScope } from './scope'

export function shouldRunShadow(
  flagEnvVar: string,
  env: NodeJS.ProcessEnv = process.env,
  scope?: DecisionShadowScope,
): boolean {
  return String(env[flagEnvVar] ?? '').trim().toLowerCase() === 'true' && matchesDecisionShadowScope(scope, env)
}
