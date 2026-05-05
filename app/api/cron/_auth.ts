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

  const cronSecret =
    cleanSecret(preferredSecretEnv ? process.env[preferredSecretEnv] : undefined) ??
    cleanSecret(process.env.LEAGUE_CRON_SECRET) ??
    cleanSecret(process.env.CRON_SECRET)
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
