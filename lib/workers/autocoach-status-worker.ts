import "server-only";

import { Worker, Job, type ConnectionOptions } from "bullmq";

import { aggregatePlayerStatuses } from "@/lib/autocoach/PlayerStatusAggregator";
import { runAutoCoachForLeague } from "@/lib/autocoach/AutoCoachEngine";
import { findLeagueIdsWithPlayerAsStarter } from "@/lib/autocoach/findLeaguesWithStarterPlayer";
import type { AutoCoachStatusJobPayload } from "@/lib/jobs/types";
import { QUEUE_NAMES } from "@/lib/jobs/types";
import { prisma } from "@/lib/prisma";
import { getRedisConnection, isRedisConfigured } from "@/lib/queues/bullmq";

const SUPPORTED_SPORTS = ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB", "SOCCER"] as const;

type AutoCoachStatusJobResult = {
  ok: boolean;
  sport?: string;
  statusUpdates?: number;
  gameDate?: string;
  error?: string;
};

function getConnection(): ConnectionOptions {
  const connection = getRedisConnection();
  if (!connection) {
    throw new Error("Redis is not configured. autocoach-status worker requires REDIS_URL or REDIS_HOST/REDIS_PORT.");
  }
  return connection;
}

async function scanSportAndTriggerAutoCoach(sport: string, gameDate: string): Promise<number> {
  const aggregated = await aggregatePlayerStatuses(sport, gameDate);
  let processed = 0;

  for (const row of aggregated) {
    const leagueIds = await findLeagueIdsWithPlayerAsStarter(sport, row.externalId);
    const unique = [...new Set(leagueIds)];
    for (const leagueId of unique) {
      await runAutoCoachForLeague(leagueId);
    }
    await prisma.playerStatusEvent.update({
      where: { id: row.eventId },
      data: {
        autoCoachTriggered: true,
        autoCoachTriggeredAt: new Date(),
      },
    });
    processed += 1;
  }

  return processed;
}

let statusWorker: Worker<AutoCoachStatusJobPayload, AutoCoachStatusJobResult> | null = null;

async function processStatusJob(job: Job<AutoCoachStatusJobPayload, AutoCoachStatusJobResult>): Promise<AutoCoachStatusJobResult> {
  const today = new Date().toISOString().slice(0, 10);
  const gameDate = job.data.gameDate ?? today;

  if (job.data.type === "status_scan_player") {
    return { ok: false, error: "status_scan_player not implemented" };
  }

  if (job.data.type === "status_scan_all_sports") {
    const results = await Promise.allSettled(SUPPORTED_SPORTS.map((sport) => scanSportAndTriggerAutoCoach(sport, gameDate)));
    const totalUpdates = results
      .filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled")
      .reduce((sum, r) => sum + r.value, 0);
    return { ok: true, sport: "ALL", statusUpdates: totalUpdates, gameDate };
  }

  if (job.data.type === "status_scan_sport" && job.data.sport) {
    const count = await scanSportAndTriggerAutoCoach(job.data.sport, gameDate);
    return { ok: true, sport: job.data.sport, statusUpdates: count, gameDate };
  }

  return { ok: false, error: "Unknown job type" };
}

export function startAutoCoachStatusWorker(): Worker<AutoCoachStatusJobPayload, AutoCoachStatusJobResult> | null {
  if (!isRedisConfigured()) {
    console.warn("[autocoach-status-worker] Redis not configured. Worker disabled.");
    return null;
  }

  if (statusWorker) {
    return statusWorker;
  }

  statusWorker = new Worker<AutoCoachStatusJobPayload, AutoCoachStatusJobResult>(
    QUEUE_NAMES.AUTOCOACH_STATUS,
    processStatusJob,
    {
      connection: getConnection(),
      concurrency: 3,
    }
  );

  statusWorker.on("completed", (job) => {
    const v = job.returnvalue as AutoCoachStatusJobResult | undefined;
    console.log(
      `[autocoach-status] completed ${job.id} — ${v?.statusUpdates ?? 0} updates (${v?.sport ?? "?"})`
    );
  });

  statusWorker.on("failed", (job, err) => {
    console.error(`[autocoach-status] failed ${job?.id}`, err?.message);
  });

  statusWorker.on("error", (err) => {
    console.error("[autocoach-status] error", err);
  });

  return statusWorker;
}

export async function stopAutoCoachStatusWorker(): Promise<void> {
  if (!statusWorker) return;
  await statusWorker.close();
  statusWorker = null;
}
