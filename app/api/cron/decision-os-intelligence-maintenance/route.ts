import { NextResponse } from 'next/server'
import { resolveDraftRecommendationOutcomes } from '@/lib/ai/outcomes/resolveDraftRecommendationOutcomes'
import { recomputeAdviceLearning } from '@/lib/chimmy-outcomes/adviceLearning'

import { createManagedIntelligenceDeps } from '@/lib/decision-os/three-brain/phase2/realAdapters'
import { runIntelligenceMaintenance } from '@/lib/decision-os/three-brain/phase2/maintenanceRunner'
import {
  runLineupShadowSweep,
  shadowSweepEnabled,
  productionSweepDeps,
} from '@/lib/decision-os/lineup/shadowSweep'
import { awaitPendingParityWrites } from '@/lib/decision-os/core/parity/durableParityStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/decision-os-intelligence-maintenance
 *
 * The scheduled trigger for the Decision OS Phase 2 durable maintenance runner: it drains pending
 * intelligence-refresh jobs and reconciles expired/abandoned token reservations. This is a BACKGROUND cron —
 * NOT one of the four live Decision OS user routes and NOT wired to Chimmy. Reconciliation runs here with no
 * user request; refresh execution is inert until a live evidence rehydrator is injected (Phase 3), by design.
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

/**
 * Off-by-default activation gate. Maintenance runs ONLY when `DECISION_OS_MAINTENANCE_ENABLED` is EXACTLY "true";
 * missing/empty/"false"/"1"/"yes"/any other value stays disabled. Placed AFTER authentication (an unauthorized
 * request still 401s) and BEFORE any deps/runner/DB call, so an authenticated-but-disabled invocation is fully
 * inert — no Phase 2 table query, no job drain, no reservation reconcile, no provider call, no token/freshness
 * mutation, no DB write. Keeps the deployed cron safe before migrations exist, with provider creds configured,
 * and even after Phase 3 begins enqueueing jobs — until an operator intentionally flips this flag.
 */
function maintenanceEnabled(): boolean {
  return process.env.DECISION_OS_MAINTENANCE_ENABLED === 'true'
}

/**
 * Lineup shadow sweep — a SECOND, INDEPENDENT feature sharing this schedule.
 *
 * Deliberately evaluated BEFORE the `maintenanceEnabled()` early return, and behind its own flag,
 * so the two features cannot silently gate each other. `DECISION_OS_MAINTENANCE_ENABLED` is absent
 * from the committed `.env.production` but IS set in the Vercel dashboard — a live authenticated
 * call to the deployed route returns `enabled: true`. That is exactly why the placement matters:
 * whether maintenance runs is an operator setting that can change without a code change, and the
 * sweep must not inherit it in either direction.
 *
 * Folded into this route rather than given its own: the repo is at Vercel's route ceiling and
 * carries a standing rule against new API routes, and this needs a clock, not an endpoint.
 *
 * Never throws (the sweep swallows its own failures), so it cannot turn a scheduled job red over
 * telemetry work.
 */
async function sweepLineupShadow() {
  return runLineupShadowSweep(productionSweepDeps(), { enabled: shadowSweepEnabled() })
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const sweep = await sweepLineupShadow()

  /*
   * Fill in `followed` for draft recommendations whose manager has since picked.
   *
   * 🛑 DELIBERATELY ABOVE THE `maintenanceEnabled()` GATE, beside the sweep and for the same
   * reason. This has nothing to do with Decision OS maintenance, and hanging it off that flag
   * would mean a switch somebody turned off for an unrelated subsystem silently stops the only
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
   * What Chimmy learns from how its advice turned out (brief item 10). Above the maintenance gate
   * for the same reason as the resolver above. Rebuilds at most every six hours — most ticks are
   * one indexed read — inside its own time budget, and never turns this cron red.
   */
  const adviceLearning = await recomputeAdviceLearning().catch((error) => ({
    status: 'error' as const,
    error: error instanceof Error ? error.message.slice(0, 120) : 'learning failed',
  }))
  // Flush parity writes before responding. The emitters cannot await -- they sit inside decision
  // paths -- so writes are still in flight when the sweep returns, and on Vercel this instance can
  // be frozen the moment the response is sent, which kills them. A cron has no latency budget to
  // protect, so it is the right place to wait. Bounded internally, so a slow database cannot hold
  // the invocation open until a platform duration kill (which runs no user code at all).
  const parityWrites = await awaitPendingParityWrites()

  if (!maintenanceEnabled()) {
    // Authenticated but disabled → inert success for MAINTENANCE. Do NOT touch the DB, runner,
    // providers, tokens, or freshness. The sweep above is gated separately and reports its own state.
    return NextResponse.json({ ok: true, enabled: false, status: 'maintenance_disabled', sweep, parityWrites, draftOutcomes, adviceLearning })
  }
  try {
    // Minute-bucket tick id. Overlap is prevented by the ONE global maintenance lease (AutomationLock) inside
    // the runner, so ANY concurrent invocation — same tick or not — that loses the lease returns status:'skipped'.
    const tickId = new Date().toISOString().slice(0, 16)
    const result = await runIntelligenceMaintenance({
      tickId,
      deps: createManagedIntelligenceDeps(),
      config: { refreshBatch: 20, reconcileBatch: 200 },
    })
    return NextResponse.json({ ok: true, enabled: true, tickId, ...result, sweep, parityWrites, draftOutcomes, adviceLearning })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message.slice(0, 200) : 'maintenance failed', sweep, draftOutcomes, adviceLearning },
      { status: 500 },
    )
  }
}
