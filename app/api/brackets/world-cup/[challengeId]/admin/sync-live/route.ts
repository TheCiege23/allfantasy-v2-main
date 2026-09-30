import { NextResponse } from "next/server"
import { z } from "zod"
import { syncWorldCupLiveScores } from "@/lib/world-cup/worldCupDataSyncService"
import {
  notifyWorldCupLeaderboardUpdated,
  notifyWorldCupResultsUpdated,
} from "@/lib/world-cup/worldCupNotifications"
import {
  requireWorldCupApiUser,
  assertWorldCupAdminManager,
  worldCupChallengeParamsSchema,
  worldCupProviderSyncErrorResponse,
} from "../../../_utils"

export const runtime = "nodejs"

const bodySchema = z.object({
  provider: z
    .enum(["mock", "apifootball", "sportsdata", "manual"])
    .optional()
    .default("mock"),
  useLegacySingleProvider: z.boolean().optional().default(false),
  dryRun: z.boolean().optional().default(false),
  recalculate: z.boolean().optional().default(true),
  seasonYear: z.number().int().min(2022).max(2030).optional().default(2026),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ challengeId: string }> }
) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupAdminManager(
    request,
    params.data.challengeId,
    auth.user
  )
  if (!access.ok) return access.response

  const body = await request.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { provider, useLegacySingleProvider, dryRun, recalculate, seasonYear } = parsed.data

  try {
    const result = await syncWorldCupLiveScores({
      provider,
      dryRun,
      recalculate,
      seasonYear,
      challengeId: params.data.challengeId,
    })
    if (!dryRun && result.updated > 0) {
      const sourceId = `${provider}:${new Date().toISOString()}`
      await notifyWorldCupResultsUpdated({
        challengeId: params.data.challengeId,
        sourceId,
      })
      if (result.recalculated) {
        await notifyWorldCupLeaderboardUpdated({
          challengeId: params.data.challengeId,
          sourceId,
        })
      }
    }

    return NextResponse.json({
      ok: true,
      ...(useLegacySingleProvider ? { mode: "legacy_single_provider" as const } : {}),
      dryRun,
      provider,
      updated: result.updated,
      skipped: result.skipped,
      finalMatches: result.finalMatches,
      recalculated: result.recalculated,
      warnings: result.warnings,
      syncedAt: new Date().toISOString(),
    })
  } catch (error) {
    return worldCupProviderSyncErrorResponse(error, {
      route: "admin/sync-live",
      provider,
      seasonYear,
      dryRun,
    })
  }
}
