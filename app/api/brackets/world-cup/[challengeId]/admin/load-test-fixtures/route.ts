import { NextResponse } from "next/server"
import { z } from "zod"
import { loadWorldCupTestFixtures } from "@/lib/world-cup/worldCupSimulationService"
import {
  assertWorldCupAdminManager,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../../_utils"

export const runtime = "nodejs"

const bodySchema = z.object({
  confirmTestFixtures: z.literal(true),
  dryRun: z.boolean().optional().default(false),
})

export async function POST(request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupAdminManager(request, params.data.challengeId, auth.user)
  if (!access.ok) return access.response

  const body = await request.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const result = await loadWorldCupTestFixtures(params.data.challengeId, {
    dryRun: parsed.data.dryRun,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.warnings[0] ?? "Failed to load test fixtures" }, { status: 400 })
  }

  return NextResponse.json({ ok: true, result })
}
