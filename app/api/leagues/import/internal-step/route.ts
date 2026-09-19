import { NextRequest, NextResponse } from "next/server"

import { requireCronAuth } from "@/app/api/cron/_auth"
import { prisma } from "@/lib/prisma"
import { finalizeLegacyImportJob, importLegacySeasonAtIndex } from "@/lib/import/processImportJob"
import { scheduleImportSeasonStep } from "@/lib/import/triggerImportChain"
import { isRetryableSleeperImportError } from "@/lib/import/sleeperImportRetry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
/** One season × many sports + rank calc — stay under Vercel max */
export const maxDuration = 300

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: {
    jobId?: string
    userId?: string
    sleeperUserId?: string
    seasons?: number[]
    seasonIndex?: number
    retryAttempt?: number
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { jobId, userId, sleeperUserId, seasons, seasonIndex } = body
  const retryAttempt = Number.isInteger(body.retryAttempt) && Number(body.retryAttempt) >= 0
    ? Number(body.retryAttempt)
    : 0
  if (
    !jobId ||
    !userId ||
    !sleeperUserId ||
    !Array.isArray(seasons) ||
    seasons.length === 0 ||
    typeof seasonIndex !== "number"
  ) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 })
  }

  try {
    await importLegacySeasonAtIndex(jobId, userId, sleeperUserId, seasons, seasonIndex)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[import/internal-step] season failed:", e)
    if (isRetryableSleeperImportError(e) && retryAttempt < 2) {
      await prisma.importJobSeason
        .update({
          where: { jobId_season: { jobId, season: seasons[seasonIndex]! } },
          data: { status: "pending", completedAt: null },
        })
        .catch(() => null)
      scheduleImportSeasonStep({
        jobId,
        userId,
        sleeperUserId,
        seasons,
        seasonIndex,
        retryAttempt: retryAttempt + 1,
      })
      return NextResponse.json(
        { ok: false, retrying: true, seasonIndex, retryAttempt: retryAttempt + 1 },
        { status: 202 },
      )
    }
    await prisma.legacyImportJob
      .update({
        where: { id: jobId },
        data: {
          status: "error",
          error: msg.slice(0, 2000),
          completedAt: new Date(),
        },
      })
      .catch(() => null)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  if (seasonIndex + 1 < seasons.length) {
    scheduleImportSeasonStep({
      jobId,
      userId,
      sleeperUserId,
      seasons,
      seasonIndex: seasonIndex + 1,
    })
  } else {
    await finalizeLegacyImportJob(jobId, userId, seasons.length)
  }

  return NextResponse.json({
    ok: true,
    seasonIndex,
    done: seasonIndex + 1 >= seasons.length,
  })
}
