import { NextResponse } from "next/server"
import { z } from "zod"
import {
  getWorldCupCommissionerSettings,
  updateWorldCupCommissionerSettings,
} from "@/lib/world-cup/worldCupBracketEventService"
import {
  assertWorldCupManager,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../_utils"

export const runtime = "nodejs"

const patchSchema = z.object({
  enableSystemEvents: z.boolean().optional(),
  enableAiSummaries: z.boolean().optional(),
  enableUpsetAlerts: z.boolean().optional(),
  enableLeaderboardAlerts: z.boolean().optional(),
  enableChampionBustAlerts: z.boolean().optional(),
  enableLockReminders: z.boolean().optional(),
})

export async function GET(
  _request: Request,
  context: { params: Promise<{ challengeId: string }> }
) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupManager(
    _request,
    params.data.challengeId,
    auth.user
  )
  if (!access.ok) return access.response

  const settings = await getWorldCupCommissionerSettings(params.data.challengeId)
  return NextResponse.json({ settings })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ challengeId: string }> }
) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupManager(
    request,
    params.data.challengeId,
    auth.user
  )
  if (!access.ok) return access.response

  const body = await request.json().catch(() => ({}))
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    )
  }

  await updateWorldCupCommissionerSettings({
    challengeId: params.data.challengeId,
    ...parsed.data,
  })

  const settings = await getWorldCupCommissionerSettings(params.data.challengeId)
  return NextResponse.json({ ok: true, settings })
}
