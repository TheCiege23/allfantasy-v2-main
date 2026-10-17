import "server-only"

import { Queue } from "bullmq"
import { getRedisConnection, isRedisConfigured } from "@/lib/queues/bullmq"
import { QUEUE_NAMES } from "@/lib/jobs/types"
import type { IntegrityJobPayload } from "@/lib/jobs/types"

type CollusionScanRef = NonNullable<IntegrityJobPayload["tradeRef"]>

/**
 * Queue a post-trade collusion scan of a settled trade (delayed so the trade row is fully committed).
 * The scan reviews the REAL trade — `AfLeagueTrade` or `RedraftTradeProposal` — and flags are keyed
 * on that trade's id.
 * PRIVACY: job only carries trade ids and roster ids — no chat payloads.
 */
export async function enqueueCollusionScan(
  leagueId: string,
  tradeRef: CollusionScanRef,
  tradingRosterIds: string[]
): Promise<void> {
  if (!isRedisConfigured()) return
  const connection = getRedisConnection()
  if (!connection) return

  const queue = new Queue<IntegrityJobPayload>(QUEUE_NAMES.INTEGRITY, { connection })
  await queue.add(
    "collusion_scan_trade",
    {
      type: "collusion_scan_trade",
      leagueId,
      tradeTransactionId: tradeRef.kind === "af" ? tradeRef.tradeId : tradeRef.proposalId,
      tradeRef,
      tradingRosterIds,
    },
    {
      delay: 5000,
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
    }
  )
}
