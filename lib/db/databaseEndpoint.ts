/**
 * Which database a connection string actually points at, as a short comparable id.
 *
 * 🛑 THIS EXISTS SO A WRITE-CAPABLE SCRIPT CAN REFUSE TO RUN AGAINST THE WRONG DATABASE, and
 * the guard has to be a POSITIVE ALLOWLIST — the operator names the endpoint they mean and a
 * mismatch fails closed. It must never be a "not production" substring test: this repo has
 * already shipped host-substring guards written INVERTED, and an inverted negative guard points
 * at production. See `nonprod-script-guards-were-inverted` and the `--endpoint=` flag on
 * `scripts/backfill-provider-position-codes.mjs`, which is the shape this generalises.
 *
 * ⚠ `-pooler` IS STRIPPED, AND THAT IS THE WHOLE REASON THIS IS NOT A ONE-LINER INLINE. Neon
 * serves the same endpoint at two hostnames — `ep-x-y-pooler.…` for the pooled connection and
 * `ep-x-y.…` for the direct one. `DATABASE_URL` and `DIRECT_URL` in this repo differ by exactly
 * that suffix. A guard that compared raw hosts would refuse a correct `--endpoint=` whenever the
 * caller happened to read the other variable, and the natural "fix" for that is to loosen the
 * comparison — which is how a positive allowlist quietly becomes a substring test.
 *
 * ⚠ THERE ARE THREE AD-HOC COPIES OF THIS DERIVATION IN THE REPO and this replaces only the one
 * in the caller it ships with. `scripts/backfill-provider-position-codes.mjs` and
 * `scripts/widen-ncaaf-identities.ts` still carry their own. Converging them means re-verifying
 * scripts that write to production, which is a deliberate change and not a drive-by — but it is
 * worth doing, because two implementations of one rule is the bug this repo keeps paying for.
 */

/** The sentinel `vitest.setup.db-guard.ts` pins an unnamed target to. Never a real database. */
export const NO_DATABASE_SENTINEL = '127.0.0.1'

/**
 * Reduce a Postgres connection string to the endpoint id used for comparison.
 *
 * Returns `null` when there is nothing to compare — an absent, empty or unparseable URL. A
 * caller must treat `null` as "refuse", never as "no restriction": an unset `DATABASE_URL` is
 * the case that reaches production in this repo, because `@prisma/client` populates it from
 * `.env` on import and `.env` points at prod.
 */
export function endpointFromDatabaseUrl(url: string | null | undefined): string | null {
  if (!url) return null

  const afterCredentials = url.split('@')[1]
  if (!afterCredentials) return null

  const host = afterCredentials.split('/')[0]?.split('?')[0]
  if (!host) return null

  // Strip a port before taking the first label, or `localhost:5432` yields `localhost:5432`.
  const withoutPort = host.split(':')[0]
  if (!withoutPort) return null

  /*
   * 🛑 AN IP LITERAL IS RETURNED WHOLE, AND A TEST CAUGHT THIS IN THE DANGEROUS DIRECTION.
   * Taking the first dot-separated label reduced `127.0.0.1` to `127` — which is not merely
   * ugly, it makes `127.0.0.1` and `127.0.0.2` compare EQUAL. A guard whose job is to
   * distinguish databases must never collapse two different hosts onto one id.
   */
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(withoutPort)) return withoutPort

  const firstLabel = withoutPort.split('.')[0]
  if (!firstLabel) return null

  return firstLabel.replace(/-pooler$/, '')
}

/**
 * Whether a write may proceed against `url`, given the endpoint the operator named.
 *
 * Both sides must be present and equal. Absent `expected` is a refusal, not a wildcard — the
 * flag being missing is exactly the case the guard exists for.
 */
export function endpointMatches(url: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected) return false
  const actual = endpointFromDatabaseUrl(url)
  if (!actual) return false
  return actual === expected.trim()
}
