/**
 * Blocker 2 — DURABLE refresh worker. Stale-while-revalidate enqueues one `AutomationJob`
 * (`decision_os.intelligence_refresh`, unique idempotency key); this module is the RUNNER that discovers those
 * jobs and executes them through the existing automation engine (lease / attempt / recovery + audit rows).
 *
 * The handler reconstructs the canonical request from the persisted run + its MINIMIZED request snapshot (no
 * secrets), then re-runs the SAME canonical inputs via `runIntelligenceRefresh` (non-billable, NON-recursive —
 * it never enqueues another refresh). Attempts are bounded by the job's `maxAttempts`; a crashed worker leaves
 * the run lease to expire and the job to be re-drained. STANDALONE — not wired to a cron/route (Phase 3 calls
 * `drainIntelligenceRefreshJobs` from a scheduler); `deps.runOrchestration` supplies the recomputation.
 *
 * Server-side only (imports the automation engine + prisma). Injectable client + deps for tests.
 */
import 'server-only'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { runAutomationJob } from '@/lib/automation/engine'
import type { AutomationResult } from '@/lib/automation/types'
import { buildEvidencePacket } from '../evidencePacket'
import { computeExpiry, resolveFreshnessPolicy } from './freshnessPolicy'
import { computeIntelligenceRequestIdentity } from './requestIdentity'
import { noLiveSourceRehydrator } from './evidenceRehydration'
import { runIntelligenceRefresh, type ManagedIntelligenceDeps } from './intelligenceService'
import type { IntelligenceRequestContext, IntelligenceRunRecord, IntelligenceTool } from './types'

type PrismaLike = typeof defaultPrisma

export const INTELLIGENCE_REFRESH_JOB_TYPE = 'decision_os.intelligence_refresh'

type SnapshotSignal = { id: string; kind: string; summary: string; severity?: 'info' | 'warning' | 'critical' | null }
type SnapshotFact = { id: string; label: string; value: string; source?: string | null }
type RequestSnapshot = {
  sport?: string
  season?: string | null
  signals?: SnapshotSignal[]
  facts?: SnapshotFact[]
  freshness?: { state: 'fresh' | 'aging' | 'stale' | 'unknown' }
  missingInformation?: string[]
}

/**
 * Rebuild a refresh context from a persisted run. buildEvidencePacket recomputes the SAME evidence fingerprint
 * from the same signals/facts/freshness → the SAME canonical identity, so the refresh updates the same run row
 * (resetting freshness) rather than forking a new one. Returns null when the snapshot is missing.
 */
export function reconstructRefreshContext(run: IntelligenceRunRecord): IntelligenceRequestContext | null {
  const snap = (run.requestSnapshot ?? null) as RequestSnapshot | null
  if (!snap) return null
  const packet = buildEvidencePacket({
    userId: run.userId,
    sport: run.sport ?? snap.sport ?? 'NFL',
    decisionType: run.decisionType,
    mode: run.leagueId ? 'league' : 'global',
    canonicalLeagueId: run.leagueId ?? undefined,
    signals: (snap.signals ?? []).map((s) => ({ id: s.id, kind: s.kind, summary: s.summary, severity: s.severity ?? undefined })),
    facts: (snap.facts ?? []).map((f) => ({ id: f.id, label: f.label, value: f.value, source: f.source ?? undefined })),
    freshness: snap.freshness ?? { state: 'unknown' },
    season: snap.season ?? undefined,
    missingInformation: snap.missingInformation ?? [],
  })
  return { tool: run.tool as IntelligenceTool, userId: run.userId, packet, connectedGroupId: run.connectedGroupId }
}

/**
 * Map a refresh outcome to the durable job result. A durable UNKNOWN provider outcome becomes a TERMINAL,
 * reconciliation-required FAILURE — never `completed` ("successfully refreshed"), never a churned retry (a
 * handler-returned `failed` is terminal — the drain only re-picks `pending`/stale-`running` jobs), and it mints
 * NO freshness. The run itself stays `unknown`, so `store.claim` refuses any automatic provider re-execution and
 * a later user request is served an honest failure (never concealed as a cache hit).
 */
function mapRefreshToJobResult(
  r: { refreshed: boolean; status: string },
  extraMeta: Record<string, unknown>,
): AutomationResult {
  if (r.status === 'unknown') {
    return {
      status: 'failed',
      message: 'refresh_provider_outcome_unknown_reconcile_required',
      metadata: { ...extraMeta, unknownOutcome: true, requiresReconciliation: true },
    }
  }
  return { status: r.refreshed ? 'completed' : 'failed', message: r.status, metadata: extraMeta }
}

/**
 * The job handler: REHYDRATE current evidence (never re-run the old snapshot), then refresh honestly.
 *  - evidence load fails            → retain the stale result, record failure (do NOT bump freshness)
 *  - live-sensitive + non-live evd  → refuse (never refresh live from an old/non-live snapshot)
 *  - material evidence change       → run under the NEW canonical identity (a new fresh run)
 *  - unchanged evidence + result    → extend TTL WITHOUT provider spend
 *  - unchanged evidence, no result  → re-run under the same identity
 */
export async function runIntelligenceRefreshJob(
  input: { userId: string | null; metadata: unknown },
  deps: ManagedIntelligenceDeps,
  opts?: { signal?: AbortSignal },
): Promise<AutomationResult> {
  const meta = (input.metadata ?? {}) as { identityKey?: string }
  const identityKey = meta.identityKey
  if (!identityKey || !input.userId) return { status: 'failed', message: 'missing identityKey/userId' }
  if (opts?.signal?.aborted) return { status: 'failed', message: 'refresh_aborted_lease_lost' } // fenced before starting

  const run = await deps.store.findByIdentity({ identityKey, userId: input.userId }) // tenant-scoped load
  if (!run) return { status: 'failed', message: 'run not found' }

  const policy = resolveFreshnessPolicy(run.decisionType)
  const clock = deps.clock ?? (() => new Date())

  // 1) Resolve CURRENT evidence. The default rehydrator refuses (no live source) → stale is NOT bumped.
  const rehydrated = await (deps.evidenceRehydrator ?? noLiveSourceRehydrator).rehydrate({ run })
  if (!rehydrated.ok) {
    return { status: 'failed', message: `refresh_evidence_unavailable:${rehydrated.reason}` }
  }
  // 2) Live-sensitive results must never be refreshed from non-live evidence.
  if (policy.liveSensitive && !rehydrated.isLiveEvidence) {
    return { status: 'failed', message: 'refresh_live_requires_live_evidence' }
  }

  const freshCtx = rehydrated.ctx
  const freshIdentity = computeIntelligenceRequestIdentity(freshCtx)

  // 3) Material evidence change → a NEW canonical request (do NOT overwrite the old run's freshness).
  if (freshIdentity.identityKey !== run.identityKey) {
    const r = await runIntelligenceRefresh(freshCtx, deps, { signal: opts?.signal })
    return mapRefreshToJobResult(r, { materialChange: true, newIdentityKey: freshIdentity.identityKey })
  }

  // 4) Unchanged evidence with a usable result → extend TTL, no provider spend.
  if (run.status === 'succeeded' && run.resultJson) {
    const extended = await deps.store.extendFreshness({
      identityKey: run.identityKey,
      userId: run.userId,
      expiresAt: computeExpiry(policy, clock()),
      now: clock(),
    })
    return { status: 'completed', message: 'reused_current_evidence', metadata: { materialChange: false, reusedWithoutProvider: extended } }
  }

  // 5) Unchanged evidence, no usable result → re-run under the same identity.
  const r = await runIntelligenceRefresh(freshCtx, deps, { signal: opts?.signal })
  return mapRefreshToJobResult(r, { materialChange: false })
}

/**
 * Discover + execute pending (and stale-running, i.e. abandoned) refresh jobs through the automation engine.
 * Idempotent: the run's single-flight claim ensures at most one orchestration per key even if a job runs twice.
 */
export async function drainIntelligenceRefreshJobs(
  deps: ManagedIntelligenceDeps,
  opts?: { db?: PrismaLike; limit?: number; now?: Date; staleRunningMs?: number; fence?: () => Promise<boolean>; signal?: AbortSignal },
): Promise<{ processed: number; completed: number; failed: number; fenced: number }> {
  const db = opts?.db ?? defaultPrisma
  const now = opts?.now ?? new Date()
  const staleBefore = new Date(now.getTime() - (opts?.staleRunningMs ?? 5 * 60_000))
  const jobs = await db.automationJob.findMany({
    where: {
      jobType: INTELLIGENCE_REFRESH_JOB_TYPE,
      OR: [{ status: 'pending' }, { status: 'running', startedAt: { lt: staleBefore } }], // recover abandoned
    },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(100, opts?.limit ?? 20)),
  })

  let completed = 0
  let failed = 0
  let processed = 0
  let fenced = 0
  for (const job of jobs) {
    // Fence BEFORE executing a job: a stale owner that lost the lease (fence false, or the abort signal fired
    // mid-sweep from the heartbeat/deadline) must not start or persist further refresh effects.
    if (opts?.signal?.aborted || (opts?.fence && !(await opts.fence()))) { fenced += 1; break }
    processed += 1
    const res = await runAutomationJob(
      {
        idempotencyKey: job.idempotencyKey,
        jobType: INTELLIGENCE_REFRESH_JOB_TYPE,
        userId: job.userId ?? undefined,
        leagueId: job.leagueId ?? undefined,
        metadata: (job.metadata ?? undefined) as Record<string, unknown> | undefined,
      },
      () => runIntelligenceRefreshJob({ userId: job.userId, metadata: job.metadata }, deps, { signal: opts?.signal }),
      { prisma: db, maxAttempts: job.maxAttempts },
    )
    if (res.status === 'completed') completed += 1
    else if (res.status === 'failed') failed += 1
  }
  return { processed, completed, failed, fenced }
}
