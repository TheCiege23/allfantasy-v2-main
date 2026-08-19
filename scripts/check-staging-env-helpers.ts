/**
 * Pure helpers for `check-staging-env.ts`'s CLI, extracted so the
 * production-host-resolution precedence has a clean unit-test seam —
 * mirrors `decision-os-suite-conformance-helpers.ts`'s own pattern.
 */

export function hostOf(url: string | undefined): string {
  if (!url) return ''
  let v = url.trim()
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1)
  try {
    return new URL(v.replace(/^postgres(ql)?:\/\//, 'http://')).host
  } catch {
    return ''
  }
}

/**
 * Resolve the known-production DB host from `.env` and `.env.local`.
 * `.env` is preferred: in this repo's convention it holds the shared/production
 * DATABASE_URL, while `.env.local` is a personal override typically pointed at a
 * non-prod dev branch. Preferring `.env.local` would risk missing a real prod
 * DATABASE_URL in `.env` as "the known production host."
 */
export function resolveProdDbHost(baseDatabaseUrl: string | undefined, localDatabaseUrl: string | undefined): string {
  return hostOf(baseDatabaseUrl || localDatabaseUrl)
}
