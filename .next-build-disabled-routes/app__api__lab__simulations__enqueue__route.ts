import { NextRequest, NextResponse } from "next/server"
import { simulationQueue } from "@/lib/queues/bullmq"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    if (!simulationQueue) {
      return NextResponse.json(
        { error: "Simulation queue is not configured. Add Redis settings first." },
        { status: 503 }
      )
    }

    let body: Record<string, unknown> = {}
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      )
    }

    const jobName =
      typeof body.jobName === "string" && body.jobName.trim()
        ? body.jobName.trim()
        : "simulation"

    const payload =
      body && typeof body === "object" && "payload" in body
        ? (body.payload as Record<string, unknown>)
        : body

    const job = await simulationQueue.add(jobName, payload, {
      removeOnComplete: 100,
      removeOnFail: 100,
    })

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      name: job.name,
    })
  } catch (error: any) {
    console.error("[simulations/enqueue] error:", error)
    return NextResponse.json(
      { error: error?.message || "Failed to enqueue simulation job." },
      { status: 500 }
    )
  }
}