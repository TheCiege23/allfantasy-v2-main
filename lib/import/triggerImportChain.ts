/**
 * Chains multi-season Sleeper import across serverless invocations (Vercel).
 * Each request processes one season; the next step is triggered via authenticated fetch.
 */
/** Prefer VERCEL_URL so preview deployments chain to themselves, not production NEXTAUTH_URL. */
export function getImportWorkerBaseUrl(): string {
  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return vercel.startsWith("http") ? vercel.replace(/\/$/, "") : `https://${vercel}`
  const fromEnv = process.env.NEXTAUTH_URL?.trim().replace(/\/$/, "")
  if (fromEnv) return fromEnv
  return ""
}

export function getImportWorkerSecret(): string {
  return (
    process.env.IMPORT_WORKER_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.LEAGUE_CRON_SECRET?.trim() ||
    ""
  )
}

export function canChainImportSteps(): boolean {
  return Boolean(getImportWorkerBaseUrl() && getImportWorkerSecret())
}

/** Fire-and-forget next season step (or first step with seasonIndex 0). */
export function scheduleImportSeasonStep(args: {
  jobId: string
  userId: string
  sleeperUserId: string
  seasons: number[]
  seasonIndex: number
  retryAttempt?: number
}): void {
  const base = getImportWorkerBaseUrl()
  const secret = getImportWorkerSecret()
  if (!base || !secret) {
    console.error(
      "[import] scheduleImportSeasonStep: set NEXTAUTH_URL (or VERCEL_URL) and IMPORT_WORKER_SECRET (or CRON_SECRET / LEAGUE_CRON_SECRET)",
    )
    return
  }
  const url = `${base}/api/leagues/import/internal-step`
  void fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(args),
  }).catch((e: unknown) => console.error("[import] chain fetch failed:", e))
}
