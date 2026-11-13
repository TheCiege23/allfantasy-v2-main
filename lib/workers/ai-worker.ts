import "server-only";
import { Worker, Job, type ConnectionOptions } from "bullmq";
import { getRedisConnection, isRedisConfigured } from "@/lib/queues/bullmq";
import { QUEUE_NAMES } from "@/lib/jobs/types";
import type { AiJobPayload } from "@/lib/jobs/types";
import { createTimer, logStructured } from "@/lib/logging/structured";
import { recordEngineTelemetrySample } from "@/lib/analytics/recordAnalyticsEvent";
import { ENGINE } from "@/lib/analytics/eventNames";

type AiJobResult = {
  ok: boolean;
  jobId: string | undefined;
  processedAt: string;
  type: string;
  error?: string;
  swapCount?: number;
};

let aiWorker: Worker<AiJobPayload, AiJobResult> | null = null;

function getConnection(): ConnectionOptions {
  const connection = getRedisConnection();
  if (!connection) {
    throw new Error(
      "Redis is not configured. AI worker requires REDIS_URL or REDIS_HOST/REDIS_PORT."
    );
  }
  return connection;
}

async function processAiJob(job: Job<AiJobPayload, AiJobResult>): Promise<AiJobResult> {
  const timer = createTimer();
  const data = job.data;
  const type = data?.type ?? "unknown";

  try {
    switch (type) {
      case "trade_analysis":
      case "waiver_analysis":
      case "draft_insight":
      case "digest":
        // Placeholder: heavy AI logic can be moved here from API routes.
        // For now we acknowledge the job and log; full implementation would
        // call the same services used by POST /api/ai/* or /api/legacy/ai/run.
        logStructured("info", "ai_worker", "job_processed", { jobType: type, jobId: job.id });
        return {
          ok: true,
          jobId: job.id,
          processedAt: new Date().toISOString(),
          type,
        };
      case "autocoach_pregame_scan":
      case "autocoach_status_check": {
        const leagueId = data.leagueId;
        if (!leagueId || typeof leagueId !== "string") {
          throw new Error("Missing leagueId");
        }
        const { runAutoCoachForLeague } = await import("@/lib/autocoach/AutoCoachEngine");
        const swaps = await runAutoCoachForLeague(leagueId);
        return {
          ok: true,
          jobId: job.id,
          processedAt: new Date().toISOString(),
          type,
          swapCount: swaps.length,
        };
      }
      default:
        return {
          ok: false,
          jobId: job.id,
          processedAt: new Date().toISOString(),
          type,
          error: `Unknown AI job type: ${type}`,
        };
    }
  } finally {
    const durationMs = Math.round(timer.elapsedMs());
    recordEngineTelemetrySample(ENGINE.JOB, {
      meta: { queue: QUEUE_NAMES.AI, jobType: type, jobId: job.id, durationMs },
    });
  }
}

export function startAiWorker(): Worker<AiJobPayload, AiJobResult> | null {
  if (!isRedisConfigured()) {
    logStructured("warn", "ai_worker", "redis_not_configured");
    return null;
  }

  if (aiWorker) {
    return aiWorker;
  }

  aiWorker = new Worker<AiJobPayload, AiJobResult>(QUEUE_NAMES.AI, processAiJob, {
    connection: getConnection(),
    concurrency: 2,
  });

  aiWorker.on("completed", (job) => {
    logStructured("info", "ai_worker", "job_completed", { jobId: job.id });
  });

  aiWorker.on("failed", (job, err) => {
    logStructured("error", "ai_worker", "job_failed", {
      jobId: job?.id,
      error: err?.message,
    });
  });

  aiWorker.on("error", (err) => {
    logStructured("error", "ai_worker", "worker_error", { error: err?.message });
  });

  return aiWorker;
}

export async function stopAiWorker(): Promise<void> {
  if (!aiWorker) return;
  await aiWorker.close();
  aiWorker = null;
}

