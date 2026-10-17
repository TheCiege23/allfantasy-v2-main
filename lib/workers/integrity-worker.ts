import "server-only"

// PRIVACY BOUNDARY: This worker never reads chat data.

import { Worker, Job, type ConnectionOptions } from "bullmq"
import { getRedisConnection, isRedisConfigured } from "@/lib/queues/bullmq"
import { QUEUE_NAMES } from "@/lib/jobs/types"
import type { IntegrityJobPayload } from "@/lib/jobs/types"
import { checkLeagueCommissionerEntitlement } from "@/lib/integrity/leagueEntitlement"
import { fullLeagueCollusionScan, scanTradeForCollusion } from "@/lib/integrity/CollusionDetectionEngine"
import { scanWeekForTanking } from "@/lib/integrity/TankingDetectionEngine"

export type IntegrityJobResult = {
  ok: boolean
  skipped?: boolean
  jobId?: string
  error?: string
}

let integrityWorker: Worker<IntegrityJobPayload, IntegrityJobResult> | null = null

function getConnection(): ConnectionOptions {
  const connection = getRedisConnection()
  if (!connection) {
    throw new Error("Redis is not configured. Integrity worker requires REDIS_URL or REDIS_HOST/REDIS_PORT.")
  }
  return connection
}

async function processIntegrityJob(job: Job<IntegrityJobPayload, IntegrityJobResult>): Promise<IntegrityJobResult> {
  const { type, leagueId } = job.data
  const entitled = await checkLeagueCommissionerEntitlement(leagueId)
  if (!entitled) {
    console.log(`[integrity-worker] League ${leagueId} not entitled — skip`)
    return { ok: true, skipped: true }
  }

  try {
    switch (type) {
      case "collusion_scan_trade": {
        const tid = job.data.tradeTransactionId
        if (!tid) throw new Error("Missing tradeTransactionId")
        await scanTradeForCollusion(leagueId, tid, job.data.tradeRef)
        return { ok: true, jobId: job.id }
      }
      case "collusion_scan_league": {
        await fullLeagueCollusionScan(leagueId)
        return { ok: true, jobId: job.id }
      }
      case "tanking_scan_week": {
        const w = job.data.weekNumber ?? 1
        await scanWeekForTanking(leagueId, w, job.data.seasonId)
        return { ok: true, jobId: job.id }
      }
      case "tanking_scan_league": {
        const w = job.data.weekNumber ?? 1
        await scanWeekForTanking(leagueId, w)
        return { ok: true, jobId: job.id }
      }
      default:
        throw new Error(`Unknown integrity job type: ${type}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, jobId: job.id, error: msg }
  }
}

export function startIntegrityWorker(): Worker<IntegrityJobPayload, IntegrityJobResult> | null {
  if (!isRedisConfigured()) {
    console.warn("[integrity-worker] Redis not configured. Worker disabled.")
    return null
  }
  if (integrityWorker) return integrityWorker

  integrityWorker = new Worker<IntegrityJobPayload, IntegrityJobResult>(
    QUEUE_NAMES.INTEGRITY,
    processIntegrityJob,
    {
      connection: getConnection(),
      concurrency: 2,
    }
  )

  integrityWorker.on("completed", (j) => console.log("[integrity-worker] completed", j.id))
  integrityWorker.on("failed", (j, err) => console.error("[integrity-worker] failed", j?.id, err?.message))
  integrityWorker.on("error", (err) => console.error("[integrity-worker] error", err))

  return integrityWorker
}

export async function stopIntegrityWorker(): Promise<void> {
  if (!integrityWorker) return
  await integrityWorker.close()
  integrityWorker = null
}

export function getIntegrityWorker(): Worker<IntegrityJobPayload, IntegrityJobResult> | null {
  return integrityWorker
}
