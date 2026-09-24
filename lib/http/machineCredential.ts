/**
 * Does this request prove it is a MACHINE — a cron, a worker, an admin script?
 *
 * The geo gate exists to stop a PERSON in a prohibited state. A cron has no
 * person behind it, and GitHub Actions fires ours from Azure, whose West US 2
 * region is in Washington — the one full-block state. A census on 2026-09-24
 * found 65 API routes outside GEO_EXEMPT_PREFIXES that accept a machine
 * credential, 10 of them on the schedule, so exempting paths would rot the
 * first time someone added a cron. The geo gate exempts the CREDENTIAL instead.
 *
 * ⚠ THIS MIRRORS WHAT THE ROUTES ACCEPT, AND MUST STAY IN STEP WITH THEM:
 *   - app/api/cron/_auth.ts `requireCronAuth`: x-cron-secret | x-admin-secret |
 *     Bearer, against CRON_SECRET, LEAGUE_CRON_SECRET, a preferred env
 *     (WORLD_CUP_CRON_SECRET), IMPORT_WORKER_SECRET, BRACKET_ADMIN_SECRET,
 *     ADMIN_PASSWORD
 *   - lib/adminAuth.ts `requireAdminOrBearer`: Bearer ADMIN_PASSWORD, and
 *     x-admin-secret | x-cron-secret against BRACKET_ADMIN_SECRET / ADMIN_PASSWORD
 * Accepting MORE than the routes do would let a secret the routes reject skip
 * geo; accepting LESS reintroduces the outage. Passing this check grants no
 * access to anything — the route still runs its own check. It only decides
 * whether geo applies.
 *
 * Edge-runtime safe: no Node APIs, no I/O.
 */

const SECRET_ENVS = [
  "CRON_SECRET",
  "LEAGUE_CRON_SECRET",
  "WORLD_CUP_CRON_SECRET",
  "IMPORT_WORKER_SECRET",
  "BRACKET_ADMIN_SECRET",
  "ADMIN_PASSWORD",
] as const

type Env = Partial<Record<(typeof SECRET_ENVS)[number], string>>

/** Constant-time for equal lengths; the length itself is not secret for a long random value. */
export function constantTimeEqual(expected: string, actual: string): boolean {
  if (!expected || !actual || expected.length !== actual.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i)
  return diff === 0
}

function presented(headers: { get(name: string): string | null }): string[] {
  const out: string[] = []
  for (const name of ["x-cron-secret", "x-admin-secret"]) {
    const v = headers.get(name)?.trim()
    if (v) out.push(v)
  }
  const auth = headers.get("authorization") ?? ""
  if (auth.startsWith("Bearer ")) {
    const v = auth.slice(7).trim()
    if (v) out.push(v)
  }
  return out
}

export function hasMachineCredential(
  headers: { get(name: string): string | null },
  env: Env = process.env as Env,
): boolean {
  const offered = presented(headers)
  if (offered.length === 0) return false
  const secrets = SECRET_ENVS.map((k) => env[k]?.trim()).filter((v): v is string => Boolean(v))
  return offered.some((o) => secrets.some((s) => constantTimeEqual(s, o)))
}
