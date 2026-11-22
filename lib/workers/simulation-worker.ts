import "server-only";
import { Worker, Job, type ConnectionOptions } from "bullmq";
import type { PECRResult } from "@/lib/ai/pecr";
import { runPECR } from "@/lib/ai/pecr";
import { getRedisConnection, isRedisConfigured } from "@/lib/queues/bullmq";
import { QUEUE_NAMES } from "@/lib/jobs/types";
import type { SimulationJobPayload } from "@/lib/jobs/types";

type SimulationJobData = SimulationJobPayload & Record<string, unknown>;
type SimulationJobResult = {
  ok: true;
  jobId: string | undefined;
  processedAt: string;
  input: SimulationJobData;
};

type SimulationWorkerResult = PECRResult<SimulationJobResult>;

let simulationWorker: Worker<SimulationJobData, SimulationWorkerResult> | null = null;

function getWorkerConnection(): ConnectionOptions {
  const connection = getRedisConnection();

  if (!connection) {
    throw new Error(
      "Redis is not configured. Simulation worker cannot start without REDIS_URL or REDIS_HOST/REDIS_PORT."
    );
  }

  return connection;
}

async function processSimulationJob(
  job: Job<SimulationJobData>
): Promise<SimulationWorkerResult> {
  console.log("[simulation-worker] processing job", job.id);

  return runPECR(job.data, {
    feature: "simulation",
    maxIterations: 3,
    plan: async (data) => ({
      intent: String(data.type ?? data.draftType ?? "unknown"),
      steps: ["validate input", "run simulation", "verify output"],
      context: {
        jobId: job.id,
        data,
      },
      refineHints: [],
    }),
    execute: async (_plan, data) => {
      return {
        ok: true,
        jobId: job.id,
        processedAt: new Date().toISOString(),
        input: data ?? {},
      };
    },
    check: (output) => {
      const failures: string[] = [];
      if (!output.ok) failures.push("ok is not true");

      for (const [key, value] of Object.entries(output)) {
        if (typeof value === "number" && !Number.isFinite(value)) {
          failures.push(`Field ${key} is not a finite number: ${String(value)}`);
        }
      }

      return {
        passed: failures.length === 0,
        failures,
      };
    },
  });
}

export function startSimulationWorker(): Worker<
  SimulationJobData,
  SimulationWorkerResult
> | null {
  if (!isRedisConfigured()) {
    console.warn("[simulation-worker] Redis is not configured. Worker disabled.");
    return null;
  }

  if (simulationWorker) {
    return simulationWorker;
  }

  simulationWorker = new Worker<SimulationJobData, SimulationWorkerResult>(
    QUEUE_NAMES.SIMULATIONS,
    processSimulationJob,
    {
      connection: getWorkerConnection(),
      concurrency: 5,
    }
  );

  simulationWorker.on("completed", (job, result) => {
    console.log("[simulation-worker] completed", job.id, "iterations", result.iterations);
  });

  simulationWorker.on("failed", (job, error) => {
    console.error("[simulation-worker] failed", job?.id, error);
  });

  simulationWorker.on("error", (error) => {
    console.error("[simulation-worker] worker error", error);
  });

  return simulationWorker;
}

export async function stopSimulationWorker(): Promise<void> {
  if (!simulationWorker) {
    return;
  }

  await simulationWorker.close();
  simulationWorker = null;
}

