import "server-only";
import { Job, Worker, type ConnectionOptions } from "bullmq";
import { getRedisConnection, isRedisConfigured } from "@/lib/queues/bullmq";
import { prisma } from "@/lib/prisma";
import { toPrismaJsonInput } from "@/lib/prisma-json";

export type PowerRankingsJobData = {
  jobType: "refresh-rankings" | "psychology" | "dynasty-roadmap";
  leagueId: string;
  rosterId?: number;
  managerName?: string;
  baseUrl?: string;
};

type PowerRankingsJobResult = {
  ok: true;
  jobType: PowerRankingsJobData["jobType"];
  leagueId: string;
  processedAt: string;
  rankings?: unknown;
  psychology?: unknown;
  roadmap?: unknown;
};

type RankingsTeamApi = {
  rosterId: number;
  username: string | null;
  displayName: string | null;
  composite: number;
  phase: string;
  totalRosterValue: number;
  portfolioProjection?: {
    year1: number;
    year3: number;
    year5: number;
  };
  positionValues?: Record<string, { total: number }>;
  rosterExposure?: Record<string, number>;
};

type RankingsApi = {
  leagueName: string;
  isDynasty: boolean;
  isSuperFlex: boolean;
  teams: RankingsTeamApi[];
};

type DynastyRoadmapApi = {
  roadmap?: unknown;
};

let powerRankingsWorker: Worker<
  PowerRankingsJobData,
  PowerRankingsJobResult
> | null = null;

function getConnection(): ConnectionOptions {
  const connection = getRedisConnection();
  if (!connection) {
    throw new Error(
      "Redis is not configured. Power rankings worker requires REDIS_URL or REDIS_HOST/REDIS_PORT."
    );
  }
  return connection;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return baseUrl?.trim() || process.env.NEXTAUTH_URL?.trim() || "http://localhost:3000";
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; detail?: string }
    | null;

  if (!response.ok) {
    const message =
      payload?.error ||
      payload?.detail ||
      `${response.status} ${response.statusText}`.trim();
    throw new Error(message);
  }

  return payload as T;
}

async function updateLeagueSettings(
  platformLeagueId: string,
  updater: (settings: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  try {
    const leagues = await prisma.league.findMany({
      where: { platformLeagueId },
      select: { id: true, settings: true },
    });

    await Promise.all(
      leagues.map((league) =>
        prisma.league.update({
          where: { id: league.id },
          data: {
            settings: toPrismaJsonInput(updater(asObject(league.settings))),
          },
        })
      )
    );
  } catch (error) {
    console.error("[power-rankings-worker] failed to persist cache", error);
  }
}

function buildRoadmapRequest(team: RankingsTeamApi, rankings: RankingsApi) {
  const positionValues = team.positionValues ?? {};
  const rosterExposure = team.rosterExposure ?? {};
  const positions = Object.keys(positionValues);
  const maxTotal = Math.max(
    1,
    ...positions.map((position) => positionValues[position]?.total ?? 0)
  );

  const positionStrengths: Record<string, number> = {};
  const weakPositions: string[] = [];

  for (const position of positions) {
    const total = positionValues[position]?.total ?? 0;
    const score = Math.round((total / maxTotal) * 100);
    positionStrengths[position] = score;
    if (score < 40) {
      weakPositions.push(position);
    }
  }

  const topAssets = positions
    .sort(
      (left, right) =>
        (positionValues[right]?.total ?? 0) - (positionValues[left]?.total ?? 0)
    )
    .slice(0, 3)
    .map(
      (position) =>
        `${position} group (${(rosterExposure[position] ?? 0).toFixed(0)}% exposure)`
    );

  const rosterSignals = positions.map((position) => ({
    position,
    playerName: `${position} group`,
    age: null,
    marketValue: positionValues[position]?.total ?? 0,
    impactScore: positionStrengths[position] ?? 50,
    trend30Day: 0,
  }));

  const projection = team.portfolioProjection ?? { year1: 50, year3: 45, year5: 40 };
  const avgAge =
    projection.year5 >= projection.year1 ? 23 : projection.year5 < 30 ? 28 : 30;

  return {
    leagueType: rankings.isDynasty ? "Dynasty" : "Redraft",
    isSF: rankings.isSuperFlex,
    goal: team.composite >= 60 ? "compete" : "rebuild",
    rosterSignals,
    avgAge,
    totalValue: team.totalRosterValue ?? 0,
    positionStrengths,
    weakPositions,
    topAssets,
    leagueName: rankings.leagueName,
  };
}

async function processPowerRankingsJob(
  job: Job<PowerRankingsJobData, PowerRankingsJobResult>
): Promise<PowerRankingsJobResult> {
  const { jobType, leagueId, rosterId, managerName } = job.data;
  const baseUrl = normalizeBaseUrl(job.data.baseUrl);

  switch (jobType) {
    case "refresh-rankings": {
      await job.updateProgress(10);

      const sleeperLeagueUrl = `https://api.sleeper.app/v1/league/${encodeURIComponent( // db-first-exception: background ranking refresh worker pending DB snapshot source
        leagueId
      )}`;
      const sleeperRostersUrl = `${sleeperLeagueUrl}/rosters`;
      const sleeperUsersUrl = `${sleeperLeagueUrl}/users`;

      const [league, rosters, users] = await Promise.all([
        fetchJson<unknown>(sleeperLeagueUrl),
        fetchJson<unknown>(sleeperRostersUrl),
        fetchJson<unknown>(sleeperUsersUrl),
      ]);

      await job.updateProgress(40);

      const rankings = await fetchJson<unknown>(
        `${baseUrl}/api/rankings/league-v2?leagueId=${encodeURIComponent(leagueId)}`
      );

      await job.updateProgress(90);

      await updateLeagueSettings(leagueId, (settings) => ({
        ...settings,
        rankingsCache: {
          league,
          rosters,
          users,
          rankings,
        },
        cachedAt: new Date().toISOString(),
      }));

      await job.updateProgress(100);

      return {
        ok: true,
        jobType,
        leagueId,
        rankings,
        processedAt: new Date().toISOString(),
      };
    }

    case "psychology": {
      if (rosterId == null) {
        throw new Error("rosterId required for psychology jobs");
      }

      await job.updateProgress(20);

      const rankings = await fetchJson<RankingsApi>(
        `${baseUrl}/api/rankings/league-v2?leagueId=${encodeURIComponent(leagueId)}`
      );
      const team = rankings.teams.find((entry) => entry.rosterId === rosterId);

      if (!team) {
        throw new Error("Requested roster was not found in rankings data");
      }

      const psychology = await fetchJson<unknown>(
        `${baseUrl}/api/rankings/manager-psychology`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leagueId,
            rosterId,
            username: team.username ?? managerName ?? undefined,
            teamData: team,
          }),
        }
      );

      await job.updateProgress(80);

      await updateLeagueSettings(leagueId, (settings) => {
        const psychologyCache = asObject(settings.psychologyCache);
        return {
          ...settings,
          psychologyCache: {
            ...psychologyCache,
            [String(rosterId)]: psychology,
          },
          psychologyCachedAt: new Date().toISOString(),
        };
      });

      await job.updateProgress(100);

      return {
        ok: true,
        jobType,
        leagueId,
        psychology,
        processedAt: new Date().toISOString(),
      };
    }

    case "dynasty-roadmap": {
      if (rosterId == null) {
        throw new Error("rosterId required for dynasty roadmap jobs");
      }

      await job.updateProgress(20);

      const rankings = await fetchJson<RankingsApi>(
        `${baseUrl}/api/rankings/league-v2?leagueId=${encodeURIComponent(leagueId)}`
      );
      const team = rankings.teams.find((entry) => entry.rosterId === rosterId);

      if (!team) {
        throw new Error("Requested roster was not found in rankings data");
      }

      const roadmapResponse = await fetchJson<DynastyRoadmapApi>(
        `${baseUrl}/api/rankings/dynasty-roadmap`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildRoadmapRequest(team, rankings)),
        }
      );

      await job.updateProgress(80);

      const roadmap = roadmapResponse.roadmap ?? roadmapResponse;

      await updateLeagueSettings(leagueId, (settings) => {
        const roadmapCache = asObject(settings.dynastyRoadmapCache);
        return {
          ...settings,
          dynastyRoadmapCache: {
            ...roadmapCache,
            [String(rosterId)]: roadmap,
          },
          dynastyRoadmapCachedAt: new Date().toISOString(),
        };
      });

      await job.updateProgress(100);

      return {
        ok: true,
        jobType,
        leagueId,
        roadmap,
        processedAt: new Date().toISOString(),
      };
    }
  }
}

export function startPowerRankingsWorker(): Worker<
  PowerRankingsJobData,
  PowerRankingsJobResult
> | null {
  if (!isRedisConfigured()) {
    console.warn("[power-rankings-worker] Redis not configured. Worker disabled.");
    return null;
  }

  if (powerRankingsWorker) {
    return powerRankingsWorker;
  }

  powerRankingsWorker = new Worker<PowerRankingsJobData, PowerRankingsJobResult>(
    "power-rankings",
    processPowerRankingsJob,
    {
      connection: getConnection(),
      concurrency: 2,
    }
  );

  powerRankingsWorker.on("completed", (job) => {
    console.log("[power-rankings-worker] completed", job.id);
  });

  powerRankingsWorker.on("failed", (job, error) => {
    console.error("[power-rankings-worker] failed", job?.id, error?.message);
  });

  powerRankingsWorker.on("error", (error) => {
    console.error("[power-rankings-worker] error", error);
  });

  return powerRankingsWorker;
}

export async function stopPowerRankingsWorker(): Promise<void> {
  if (!powerRankingsWorker) return;
  await powerRankingsWorker.close();
  powerRankingsWorker = null;
}

export function getPowerRankingsWorker(): Worker<
  PowerRankingsJobData,
  PowerRankingsJobResult
> | null {
  return powerRankingsWorker;
}
