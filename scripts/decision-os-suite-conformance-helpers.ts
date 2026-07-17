/**
 * Fantasy OS Suite — Phase D Increment 6.
 *
 * Pure, testable helpers for `decision-os-suite-conformance.ts`. Kept separate from the script
 * itself (which pulls in the Prisma singleton and must never be imported by a test) so the
 * explicit-only CLI contract and the production-host refusal logic have a real unit-test seam,
 * mirroring the existing `scripts/manager-intelligence/nonprodValidationGuard.ts` pattern.
 */

import { classifyDatabaseTarget, describeTarget } from './db-target-identity'

export { describeTarget }

/**
 * Classification is NOT defined here any more. It used to be
 * `hostOf(url).includes(PROD_HOST_MARKER)` with the marker copy-pasted into ~20 scripts, and on
 * 2026-07-14 that marker was set to the dev clone's endpoint — so every one of those guards
 * refused the clone and permitted real production. Both halves of that were bugs: the wrong
 * string, and a check that fails OPEN so a wrong string silently disables it.
 *
 * scripts/db-target-identity.cjs is now the single source of truth. It classifies on
 * (endpoint, database) rather than host — production and local dev share one Neon compute and
 * differ only by database name — and refuses anything not positively known to be safe.
 */

/**
 * True unless the target is a verified non-production database.
 *
 * Deliberately NOT named `isProductionHost`: it is also true for unrecognised and unparseable
 * targets, because "we don't know what this is" must gate destructive work exactly as firmly as
 * "we know this is production". Callers refuse on true.
 */
export function shouldRefuseTarget(url: string | null): boolean {
  return classifyDatabaseTarget(url).classification !== 'non-production'
}

/** Human-readable reason for a refusal, for the script's own error output. */
export function refusalReason(url: string | null): string {
  return classifyDatabaseTarget(url).reason
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
