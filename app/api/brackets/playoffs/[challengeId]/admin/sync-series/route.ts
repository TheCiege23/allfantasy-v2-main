import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { hasPoolAdminAccess } from "@/lib/auth/admin"
import { prisma } from "@/lib/prisma"
import {
  syncPlayoffChallengeSeries,
  type PlayoffSeriesSyncMode,
  type PlayoffSeriesSyncProviderPreference,
} from "@/lib/playoffs/playoffSeriesSyncService"
import { playoffChallengeParamsSchema } from "../../../_utils"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type SessionUser = { id?: string | null; email?: string | null; name?: string | null }

const SYNC_MODES: PlayoffSeriesSyncMode[] = ["schedule_only", "teams_schedule_only", "results_only", "official_bracket", "autofill_results"]

async function canSyncChallenge(request: Request, challengeId: string): Promise<boolean> {
  const devOpen =
    process.env.NODE_ENV === "development" && !String(process.env.CRON_SECRET ?? "").trim()
  if (devOpen || requireCronAuth(request as any, "CRON_SECRET")) return true

  const session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  const userId = session?.user?.id
  if (!userId) return false
  if (hasPoolAdminAccess(session.user)) return true

  const challenge = await (prisma as any).playoffBracketChallenge.findUnique({
    where: { id: challengeId },
    select: { ownerUserId: true },
  })

  return challenge?.ownerUserId === userId
}

export async function POST(request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const params = playoffChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  if (!(await canSyncChallenge(request, params.data.challengeId))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const url = new URL(request.url)
    const providerParam = url.searchParams.get("provider")
    const modeParam = url.searchParams.get("mode")
    const providerPreference: PlayoffSeriesSyncProviderPreference =
      providerParam === "espn" || providerParam === "rolling_insights" ? providerParam : "auto"
    const mode: PlayoffSeriesSyncMode = SYNC_MODES.includes(modeParam as PlayoffSeriesSyncMode)
      ? modeParam as PlayoffSeriesSyncMode
      : "official_bracket"
    const result = await syncPlayoffChallengeSeries({
      challengeId: params.data.challengeId,
      providerPreference,
      mode,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to sync playoff series",
      },
      { status: 500 }
    )
  }
}
