import { NextResponse } from 'next/server'
import { resolveDraftRecommendationOutcomes } from '@/lib/ai/outcomes/resolveDraftRecommendationOutcomes'
import { recomputeAdviceLearning } from '@/lib/chimmy-outcomes/adviceLearning'

import { awaitPendingParityWrites } from '@/lib/decision-os/core/parity/durableParityStore'
import { recordSyncJobRun, type SyncJobOutcome } from '@/lib/production-health/syncJobRunTelemetry'

/*
 * 🛑 THE FRESHNESS PROBE FOR THIS ROUTE READ A TABLE WHOSE WRITER WAS RETIRED ON 2026-09-29.
 *
 * It probed `decision_parity_record.recordedAt`. On 2026-09-04 that table held 9,420 rows, 9,340
 * of them `manager.lineup.set`, written by the lineup shadow sweep this route drove every ten
 * minutes (see the note above GET). The sweep was deleted on 2026-09-29, and the worker picked up
 * that change that evening. The route kept firing every ten minutes and returning 200, while the
 * probe reported it STALE hourly from 21:53Z, because the only remaining writers are user-driven
 * decision paths that have no schedule.
 *
 * So each authorized tick records this heartbeat and the probe reads it. A caught failure in the
 * outcome resolver or the advice rebuild records PARTIAL.
 *
 * ⚠ THE THREE-BRAIN MAINTENANCE STEP WAS RETIRED 2026-11-19 (re-score build item 9). It drained intelligence
 * refreshes and token reservations behind `DECISION_OS_MAINTENANCE_ENABLED`, but nothing ever produced a
 * three-brain run (`runManagedIntelligence` had no caller), so there was nothing to refresh or reconcile, and
 * every reader of a saved analysis was removed in the same change. The library under
 * `lib/decision-os/three-brain/` stays, unused. `DECISION_OS_MAINTENANCE_ENABLED` no longer does anything here.
 */
const HEARTBEAT_JOB = 'cron-decision-os-intelligence-maintenance'

async function recordTick(outcome: SyncJobOutcome, startedAt: number): Promise<void> {
  await recordSyncJobRun({ jobName: HEARTBEAT_JOB, trigger: 'cron' }, outcome, Date.now() - startedAt)
}

function tickWarnings(draftOutcomes: unknown, adviceLearning: unknown): string[] {
  const warnings: string[] = []
  if (draftOutcomes && typeof draftOutcomes === 'object' && 'error' in draftOutcomes) {
    warnings.push(`draftOutcomes: ${String((draftOutcomes as { error: unknown }).error)}`)
  }
  if (adviceLearning && typeof adviceLearning === 'object' && (adviceLearning as { status?: unknown }).status === 'error') {
    warnings.push(`adviceLearning: ${String((adviceLearning as { error?: unknown }).error ?? 'error')}`)
  }
  if (adviceLearning && typeof adviceLearning === 'object' && (adviceLearning as { ledger?: unknown }).ledger === 'error') {
    warnings.push('adviceLearning: AllFantasy call ledger failed to grade')
  }
  return warnings
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/decision-os-intelligence-maintenance
 *
 * A BACKGROUND cron, every ten minutes: recovers expired Chimmy requests, resolves draft recommendation
 * outcomes, rebuilds the advice-learning snapshot and flushes parity writes. The name is historical — it was the
 * trigger for the three-brain maintenance runner, retired 2026-11-19 (see the note above).
 */
function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get('authorization')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null
  if (bearer && bearer === secret) return true
  if (process.env.NODE_ENV !== 'production') {
    const q = new URL(request.url).searchParams.get('secret')
    if (q && q === secret) return true
  }
  return false
}

/*
 * 🛑 NO LINEUP WORK RUNS HERE ANY MORE. Until 2026-09-29 this route also drove the Decision OS
 * lineup SHADOW SWEEP (`lib/decision-os/lineup/shadowSweep.ts`, flag
 * `DECISION_OS_SHADOW_SWEEP_ENABLED`) every ten minutes, to feed a flip gate for a second lineup
 * engine. Owner decision that day: /core My Team (`lib/core-app/myTeam.ts`) is the ONE start/sit
 * answer, so the duplicate engine was retired rather than flipped — the sweep, its two unused
 * routes (`/api/today/lineup-actions`, `/api/dashboard/today-actions`) and their shadow plumbing
 * were deleted. `DECISION_OS_SHADOW_SWEEP_ENABLED` is now read by nothing.
 *
 * Do not re-add a lineup phase here without re-opening that decision.
 */
export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const startedAt = Date.now()

  const chimmyRecovered = await (await import('@/lib/chimmy/requestReceipts')).reconcileExpiredRequests(20)
    .catch(() => null)

  /*
   * Fill in `followed` for draft recommendations whose manager has since picked.
   *
   * 🛑 THIS SAT DELIBERATELY ABOVE THE (since retired) `maintenanceEnabled()` GATE. It has nothing to do with Decision OS
   * maintenance, and hanging it off that flag would have meant a switch somebody turned off for an unrelated subsystem silently stops the only
   * thing that ever resolves an outcome — the exact shape of a scheduled writer that exists,
   * looks wired, and never runs.
   *
   * ⚠ AND IT IS THE SCHEDULED CALLER THAT MATTERS, NOT THE FUNCTION. `resolveRecommendationOutcome`
   * has been in the tree with zero callers, which is why every follow-rate in getAIMetrics reads a
   * column nothing writes. A resolver with no clock behind it is the same bug in a new place.
   *
   * Bounded to one batch and caught here: this cron runs every ten minutes alongside real work,
   * and outcome telemetry must never be the reason it goes red.
   */
  const draftOutcomes = await resolveDraftRecommendationOutcomes({ limit: 100 }).catch((error) => ({
    error: error instanceof Error ? error.message.slice(0, 120) : 'resolve failed',
  }))
  /*
   * What Chimmy learns from how its advice turned out (brief item 10). Unconditional, for the same reason as the
   * resolver above. Rebuilds at most every six hours — most ticks are
   * one indexed read — inside its own time budget, and never turns this cron red.
   */
  const adviceLearning = await recomputeAdviceLearning().catch((error) => ({
    status: 'error' as const,
    error: error instanceof Error ? error.message.slice(0, 120) : 'learning failed',
  }))
  /*
   * AF projection factors (`lib/af-projections/factors`): one sport per tick, the stalest, at most once a day each —
   * no cron slot of its own. Caught here, like everything above: learning must never turn this cron red.
   */
  const projectionFactors = await Promise.all([import('@/lib/af-projections/factors/factorLearning'), import('@/lib/prisma')])
    .then(([{ runFactorLearningTick }, { prisma }]) => runFactorLearningTick(prisma as never))
    .catch((error) => ({ status: 'error' as const, error: error instanceof Error ? error.message.slice(0, 120) : 'factor learning failed' }))
  // Flush parity writes before responding. The emitters cannot await -- they sit inside decision
  // paths -- so writes can still be in flight when this handler reaches here, and on Vercel this instance can
  // be frozen the moment the response is sent, which kills them. A cron has no latency budget to
  // protect, so it is the right place to wait. Bounded internally, so a slow database cannot hold
  // the invocation open until a platform duration kill (which runs no user code at all).
  const parityWrites = await awaitPendingParityWrites()
  const warnings = tickWarnings(draftOutcomes, adviceLearning)

  await recordTick({ warnings, metadata: { maintenance: 'retired' } }, startedAt)
  return NextResponse.json({ ok: true, parityWrites, draftOutcomes, adviceLearning, projectionFactors, chimmyRecovered })
}
