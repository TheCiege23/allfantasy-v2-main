import type { NextRequest } from 'next/server'

function cleanSecret(value?: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function requireCronAuth(req: NextRequest, preferredSecretEnv?: string): boolean {
  const authHeader = req.headers.get('authorization') ?? ''
  const provided = cleanSecret(
    req.headers.get('x-cron-secret') ??
      req.headers.get('x-admin-secret') ??
      (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '')
  )

  // CRON_SECRET is the one production contract: it's what Vercel's own cron dispatcher sends,
  // and the only secret every deployment is guaranteed to have configured. LEAGUE_CRON_SECRET is
  // a legacy/placeholder-prone alias kept only for callers that explicitly opt into it via
  // `preferredSecretEnv` — it must never win by default (see #289/#304: it shadowed CRON_SECRET
  // and 401'd every cron that didn't pass an explicit override).
  const cronSecret =
    cleanSecret(preferredSecretEnv ? process.env[preferredSecretEnv] : undefined) ??
    cleanSecret(process.env.CRON_SECRET) ??
    cleanSecret(process.env.LEAGUE_CRON_SECRET)
  const adminSecret =
    cleanSecret(process.env.BRACKET_ADMIN_SECRET) ?? cleanSecret(process.env.ADMIN_PASSWORD)
  const importWorkerSecret = cleanSecret(process.env.IMPORT_WORKER_SECRET)

  return Boolean(
    provided &&
      ((cronSecret && provided === cronSecret) ||
        (importWorkerSecret && provided === importWorkerSecret) ||
        (adminSecret && provided === adminSecret))
  )
}
