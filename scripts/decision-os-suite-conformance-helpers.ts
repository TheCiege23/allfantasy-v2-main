/**
 * Fantasy OS Suite — Phase D Increment 6.
 *
 * Pure, testable helpers for `decision-os-suite-conformance.ts`. Kept separate from the script
 * itself (which pulls in the Prisma singleton and must never be imported by a test) so the
 * explicit-only CLI contract and the production-host refusal logic have a real unit-test seam,
 * mirroring the existing `scripts/manager-intelligence/nonprodValidationGuard.ts` pattern.
 */
import { describeDbTarget, isProductionDbTarget } from './_db-target-identity'

/**
 * Credential-free description of a connection target, for log lines.
 *
 * This used to be `hostOf`, returning the raw host. It is now the shared `endpoint/database
 * (label)` form so logs name the database identity rather than a host string that cannot, on its
 * own, tell production apart from the dev shadow that shares its compute.
 */
export function describeTarget(url: string | null): string {
  return describeDbTarget(url)
}

/**
 * True only for a target positively identified as production.
 *
 * Previously this was `hostOf(url).includes('ep-spring-tooth')`. `ep-spring-tooth-adaoi9x1` is the
 * `claude-dashboard-local-dev` FORK; production is `ep-curly-block-ad0dlt9o`/`neondb`. The check
 * therefore flagged the safe database and waved production through. The marker constant is gone
 * on purpose — identity lives in `scripts/db-target-identity.cjs` and nowhere else, so there is no
 * per-file literal left to go stale.
 */
export function isProductionHost(url: string | null): boolean {
  return isProductionDbTarget(url)
}

/**
 * Explicit-only league id parsing — deliberately has NO auto-discovery fallback (unlike the sibling
 * `decision-os-world-conformance.ts`, which does fall back to discovery). This script must never
 * enumerate leagues on its own.
 */
export function parseExplicitLeagueIds(argv: readonly string[]): string[] {
  const flag = argv.find((a) => a.startsWith('--leagueIds='))
  if (!flag) return []
  return flag
    .slice('--leagueIds='.length)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

/** Optional — only needed to also conformance-check User OS (session-scoped to one manager). */
export function parseManagerId(argv: readonly string[]): string | null {
  const flag = argv.find((a) => a.startsWith('--managerId='))
  if (!flag) return null
  const value = flag.slice('--managerId='.length).trim()
  return value.length > 0 ? value : null
}

export interface ConformanceCheckResult {
  name: string
  ok: boolean
  detail: string
}

/** Deterministic formatter for the script's own `check()` reporter, extracted for testability. */
export function formatCheckLine(result: ConformanceCheckResult): string {
  const icon = result.ok ? '✅' : '❌'
  return result.detail ? `${icon} ${result.name}  — ${result.detail}` : `${icon} ${result.name}`
}
