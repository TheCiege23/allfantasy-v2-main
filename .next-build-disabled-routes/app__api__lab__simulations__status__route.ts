import { NextRequest, NextResponse } from "next/server";
import { simulationQueue, redis } from "@/lib/queues/bullmq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    if (!simulationQueue || !redis) {
      return NextResponse.json(
        { error: "Simulation queue is not configured. Add Redis settings first." },
        { status: 503 }
      );
    }

    const jobId = req.nextUrl.searchParams?.get("jobId");
    if (!jobId) {
      return NextResponse.json(
        { error: "jobId is required." },
        { status: 400 }
      );
    }

    const job = await simulationQueue.getJob(jobId);
    if (!job) {
      return NextResponse.json(
        { error: "Job not found." },
        { status: 404 }
      );
    }

    const state = await job.getState();
    const progress = job.progress ?? 0;
    const returnValue = job.returnvalue ?? null;
    const failedReason = job.failedReason ?? null;

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      state,
      progress,
      returnValue,
      failedReason,
    });
  } catch (error: unknown) {
    console.error("[simulations/status] error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Failed to read simulation status.";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
