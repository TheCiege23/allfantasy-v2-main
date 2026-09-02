import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { getServedOrigin } from "@/lib/http/served-origin"
import { authOptions } from "@/lib/auth";
import { getQueue } from "@/lib/queues/bullmq";
import type { PowerRankingsJobData } from "@/lib/workers/power-rankings-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postBodySchema = z.object({
  jobType: z.enum(["refresh-rankings", "psychology", "dynasty-roadmap"]),
  leagueId: z.string().min(1, "leagueId required"),
  rosterId: z.number().int().optional(),
  managerName: z.string().optional(),
});

function getPowerRankingsQueue() {
  return getQueue("power-rankings");
}

async function requireSession() {
  const session = (await getServerSession(authOptions as never)) as
    | { user?: { id?: string } }
    | null;

  if (!session?.user?.id) {
    return null;
  }

  return session;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const powerRankingsQueue = getPowerRankingsQueue();
    if (!powerRankingsQueue) {
      return NextResponse.json({ error: "Queue not available" }, { status: 503 });
    }

    const json = await req.json().catch(() => null);
    const parsed = postBodySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const payload: PowerRankingsJobData = {
      ...body,
      baseUrl: process.env.NEXTAUTH_URL?.trim() || getServedOrigin(req),
    };

    const job = await powerRankingsQueue.add(body.jobType, payload, {
      removeOnComplete: 100,
      removeOnFail: 100,
    });

    return NextResponse.json({ jobId: job.id, status: "queued" });
  } catch (error) {
    console.error("[power-rankings/worker] POST error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to enqueue power rankings job.",
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const powerRankingsQueue = getPowerRankingsQueue();
    if (!powerRankingsQueue) {
      return NextResponse.json({ error: "Queue not available" }, { status: 503 });
    }

    const jobId = req.nextUrl.searchParams?.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const job = await powerRankingsQueue.getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const status = await job.getState();
    const progress = typeof job.progress === "number" ? job.progress : 0;
    const result = job.returnvalue ?? null;
    const failedReason = job.failedReason ?? null;

    return NextResponse.json({
      jobId,
      status,
      progress,
      result,
      failedReason,
    });
  } catch (error) {
    console.error("[power-rankings/worker] GET error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read power rankings job status.",
      },
      { status: 500 }
    );
  }
}

