import { NextResponse } from 'next/server'

import { createManagedIntelligenceDeps } from '@/lib/decision-os/three-brain/phase2/realAdapters'
import { runIntelligenceMaintenance } from '@/lib/decision-os/three-brain/phase2/maintenanceRunner'
import {
  runLineupShadowSweep,
  shadowSweepEnabled,
  productionSweepDeps,
} from '@/lib/decision-os/lineup/shadowSweep'

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

  if (!maintenanceEnabled()) {
    // Authenticated but disabled → inert success for MAINTENANCE. Do NOT touch the DB, runner,
    // providers, tokens, or freshness. The sweep above is gated separately and reports its own state.
    return NextResponse.json({ ok: true, enabled: false, status: 'maintenance_disabled', sweep })
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
    return NextResponse.json({ ok: true, enabled: true, tickId, ...result, sweep })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message.slice(0, 200) : 'maintenance failed', sweep },
      { status: 500 },
    )
  }
}
