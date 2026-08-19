/**
 * Fantasy OS Suite — Phase D Increment 6.
 *
 * Pure, testable helpers for `decision-os-suite-conformance.ts`. Kept separate from the script
 * itself (which pulls in the Prisma singleton and must never be imported by a test) so the
 * explicit-only CLI contract and the production-host refusal logic have a real unit-test seam,
 * mirroring the existing `scripts/manager-intelligence/nonprodValidationGuard.ts` pattern.
 */

/** Matches the existing `scripts/decision-os-*-nonprod.ts` convention exactly — never touch this host. */
export const PROD_HOST_MARKER = 'ep-spring-tooth'

export function hostOf(url: string | null): string {
  if (!url) return '?'
  try {
    return new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).host
  } catch {
    return '?'
  }
}

export function isProductionHost(url: string | null): boolean {
  return hostOf(url).includes(PROD_HOST_MARKER)
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
