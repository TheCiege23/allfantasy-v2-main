import "server-only"

// PRIVACY BOUNDARY: integrity jobs never read chat data.

import type { IntegrityJobPayload } from "@/lib/jobs/types"
import { checkLeagueCommissionerEntitlement } from "@/lib/integrity/leagueEntitlement"
import { fullLeagueCollusionScan, scanTradeForCollusion } from "@/lib/integrity/CollusionDetectionEngine"
import { scanWeekForTanking } from "@/lib/integrity/TankingDetectionEngine"

export type IntegrityJobOutcome = { ok: boolean; skipped?: boolean; error?: string }

/**
 * One integrity scan, run in-process.
 *
 * ⚠ THERE IS NO BULLMQ WORKER IN PRODUCTION (checked 2026-10-26). Both Railway web services run
 * `npm run start:railway` (Next only) and nothing runs `scripts/start-worker.ts`, so every scan that
 * was `queue.add`ed into the integrity queue sat in Redis forever: no collusion or tanking flag was
 * ever created and no suspicious-trade alert was ever sent. The scan now runs where it is requested;
 * `lib/workers/integrity-worker.ts` calls this same function, so a worker deployed later behaves the same.
 */
export async function runIntegrityJob(data: IntegrityJobPayload): Promise<IntegrityJobOutcome> {
  const { type, leagueId } = data
  const entitled = await checkLeagueCommissionerEntitlement(leagueId)
  if (!entitled) return { ok: true, skipped: true }

  try {
    switch (type) {
      case "collusion_scan_trade": {
        const tid = data.tradeTransactionId
        if (!tid) throw new Error("Missing tradeTransactionId")
        await scanTradeForCollusion(leagueId, tid, data.tradeRef)
        return { ok: true }
      }
      case "collusion_scan_league":
        await fullLeagueCollusionScan(leagueId)
        return { ok: true }
      case "tanking_scan_week":
        await scanWeekForTanking(leagueId, data.weekNumber ?? 1, data.seasonId)
        return { ok: true }
      case "tanking_scan_league":
        await scanWeekForTanking(leagueId, data.weekNumber ?? 1)
        return { ok: true }
      default:
        throw new Error(`Unknown integrity job type: ${type}`)
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
