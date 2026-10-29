import "server-only"

// PRIVACY BOUNDARY: This worker never reads chat data.

import { Worker, Job, type ConnectionOptions } from "bullmq"
import { getRedisConnection, isRedisConfigured } from "@/lib/queues/bullmq"
import { QUEUE_NAMES } from "@/lib/jobs/types"
import type { IntegrityJobPayload } from "@/lib/jobs/types"
import { runIntegrityJob } from "@/lib/integrity/runIntegrityJob"

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
  const outcome = await runIntegrityJob(job.data)
  if (outcome.skipped) console.log(`[integrity-worker] League ${job.data.leagueId} not entitled — skip`)
  return { ...outcome, jobId: job.id }
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
