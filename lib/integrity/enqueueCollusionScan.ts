import "server-only"

import type { IntegrityJobPayload } from "@/lib/jobs/types"
import { runIntegrityJob } from "@/lib/integrity/runIntegrityJob"

type CollusionScanRef = NonNullable<IntegrityJobPayload["tradeRef"]>

/**
 * Run the post-trade collusion scan of a settled trade. The scan reviews the REAL trade —
 * `AfLeagueTrade` or `RedraftTradeProposal` — and flags are keyed on that trade's id.
 *
 * The name is kept for its callers; it no longer queues. The BullMQ integrity queue it used to
 * feed has no worker in production, so nothing ever scanned (lib/integrity/runIntegrityJob.ts).
 * Callers already invoke this after the trade commits and do not await the result. The scan
 * refuses to re-flag a trade that has an open flag, so a repeat call does not stack cards.
 * PRIVACY: only trade ids and roster ids — no chat payloads.
 */
export async function enqueueCollusionScan(
  leagueId: string,
  tradeRef: CollusionScanRef,
  tradingRosterIds: string[]
): Promise<void> {
  const outcome = await runIntegrityJob({
    type: "collusion_scan_trade",
    leagueId,
    tradeTransactionId: tradeRef.kind === "af" ? tradeRef.tradeId : tradeRef.proposalId,
    tradeRef,
    tradingRosterIds,
  })
  if (!outcome.ok) console.error("[integrity] collusion scan failed", { leagueId, error: outcome.error })
}
