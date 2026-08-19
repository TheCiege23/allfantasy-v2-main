/**
 * Fantasy OS Phase 5C — provider + sync observability (Part 10), pure summarizer.
 *
 * Derives operator-facing telemetry from run/snapshot rows. Customer surfaces get ONLY a safe status
 * (Current/Delayed/Partial/Unavailable); operators may see the detailed reason. Never exposes secrets,
 * headers, connection strings, or unredacted payloads.
 */
export type CustomerSafeStatus = 'Current' | 'Delayed' | 'Partial' | 'Unavailable'

export type SyncRunRow = {
  status: string
  startedAt: string | null
  finishedAt: string | null
  requestAttempts: number
  logicalRequests: number
  retries: number
  cacheHits: number
  permanentFailures: number
  advancedFreshness: boolean
}

export type ObservabilitySummary = {
  customerStatus: CustomerSafeStatus
  totals: { runs: number; completed: number; partial: number; failed: number }
  requests: { attempts: number; logical: number; retries: number; cacheHits: number; failures: number; failureRatePct: number }
  lastCompletedAt: string | null
  lastRunDurationMs: number | null
  latestCertifiedSnapshotAt: string | null
  freshnessLagMinutes: number | null
}

export function summarizeObservability(input: {
  runs: SyncRunRow[]
  latestCertifiedSnapshotAt: string | null
  now: Date
  staleMinutes?: number
}): ObservabilitySummary {
  const runs = input.runs
  const completed = runs.filter((r) => r.status === 'completed')
  const partial = runs.filter((r) => r.status === 'partial')
  const failed = runs.filter((r) => r.status === 'failed')
  const attempts = sum(runs, (r) => r.requestAttempts)
  const logical = sum(runs, (r) => r.logicalRequests)
  const retries = sum(runs, (r) => r.retries)
  const failures = sum(runs, (r) => r.permanentFailures)
  const lastCompleted = [...completed].sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0] ?? null
  const lastRunDurationMs = lastCompleted?.startedAt && lastCompleted?.finishedAt ? new Date(lastCompleted.finishedAt).getTime() - new Date(lastCompleted.startedAt).getTime() : null

  const staleMin = input.staleMinutes ?? 60
  const lagMin = input.latestCertifiedSnapshotAt ? (input.now.getTime() - new Date(input.latestCertifiedSnapshotAt).getTime()) / 60000 : null
  let customerStatus: CustomerSafeStatus
  if (lagMin == null) customerStatus = 'Unavailable'
  else if (partial.length > completed.length && completed.length === 0) customerStatus = 'Partial'
  else customerStatus = lagMin <= staleMin ? 'Current' : 'Delayed'

  return {
    customerStatus,
    totals: { runs: runs.length, completed: completed.length, partial: partial.length, failed: failed.length },
    requests: { attempts, logical, retries, cacheHits: sum(runs, (r) => r.cacheHits), failures, failureRatePct: logical > 0 ? Math.round((failures / logical) * 1000) / 10 : 0 },
    lastCompletedAt: lastCompleted?.finishedAt ?? null,
    lastRunDurationMs,
    latestCertifiedSnapshotAt: input.latestCertifiedSnapshotAt,
    freshnessLagMinutes: lagMin == null ? null : Math.round(lagMin),
  }
}

function sum<T>(arr: T[], f: (t: T) => number): number {
  return arr.reduce((a, t) => a + (f(t) || 0), 0)
}
