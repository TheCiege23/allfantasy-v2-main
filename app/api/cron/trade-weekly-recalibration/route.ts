/**
 * GET/POST /api/cron/trade-weekly-recalibration
 *
 * Vercel Cron schedule: weekly (see vercel.json). Disabled by default —
 * calls runScheduledWeeklyRecalibration(), which no-ops unless
 * TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED=true. See
 * docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md and
 * docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md §7 Step 0.
 */
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { runScheduledWeeklyRecalibration } from "@/lib/trade-engine/auto-recalibration"

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 120

async function handle() {
  const startedAt = Date.now()
  try {
    const outcome = await runScheduledWeeklyRecalibration()
    return NextResponse.json({
      ok: true,
      ran: outcome.ran,
      reason: outcome.reason,
      durationMs: Date.now() - startedAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/trade-weekly-recalibration] failed:", message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle()
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle()
}
