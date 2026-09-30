import { NextResponse } from "next/server"
import { z } from "zod"
import { syncWorldCupFixtures } from "@/lib/world-cup/worldCupDataSyncService"
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
  dryRun: z.boolean().optional().default(false),
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

  const { provider, dryRun, seasonYear } = parsed.data

  try {
    const result = await syncWorldCupFixtures({
      provider,
      dryRun,
      seasonYear,
      challengeId: params.data.challengeId,
    })

    return NextResponse.json({
      ok: true,
      dryRun,
      provider,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      warnings: result.warnings,
      lockTimeInferred: result.lockTimeInferred,
      fixtureCount: result.fixtures.length,
      syncedAt: new Date().toISOString(),
    })
  } catch (error) {
    return worldCupProviderSyncErrorResponse(error, {
      route: "admin/sync-fixtures",
      provider,
      seasonYear,
      dryRun,
    })
  }
}
