/**
 * Devy Dynasty background worker. Processes jobs from the devy queue.
 */

import "server-only";
import { Worker, Job, type ConnectionOptions } from "bullmq";
import { getRedisConnection, isRedisConfigured } from "@/lib/queues/bullmq";
import { QUEUE_NAMES } from "@/lib/jobs/types";
import type { DevyJobPayload } from "@/lib/jobs/types";
import { processDevyJob, type DevyJobResult } from "@/lib/devy/jobs/DevyJobsHandler";

let devyWorker: Worker<DevyJobPayload, DevyJobResult> | null = null;

function getConnection(): ConnectionOptions {
  const connection = getRedisConnection();
  if (!connection) {
    throw new Error(
      "Redis is not configured. Devy worker requires REDIS_URL or REDIS_HOST/REDIS_PORT."
    );
  }
  return connection;
}

async function processJob(job: Job<DevyJobPayload, DevyJobResult>): Promise<DevyJobResult> {
  const result = await processDevyJob(job.data);
  return result;
}

export function startDevyWorker(): Worker<DevyJobPayload, DevyJobResult> | null {
  if (!isRedisConfigured()) {
    console.warn("[devy-worker] Redis not configured. Worker disabled.");
    return null;
  }

  if (devyWorker) {
    return devyWorker;
  }

  devyWorker = new Worker<DevyJobPayload, DevyJobResult>(QUEUE_NAMES.DEVY, processJob, {
    connection: getConnection(),
    concurrency: 2,
  });

  devyWorker.on("completed", (job) => {
    console.log("[devy-worker] completed", job.id, job.returnvalue?.type);
  });

  devyWorker.on("failed", (job, err) => {
    console.error("[devy-worker] failed", job?.id, err?.message);
  });

  devyWorker.on("error", (err) => {
    console.error("[devy-worker] error", err);
  });

  return devyWorker;
}

export async function stopDevyWorker(): Promise<void> {
  if (!devyWorker) return;
  await devyWorker.close();
  devyWorker = null;
}

