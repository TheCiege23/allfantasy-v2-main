import { NextResponse } from "next/server"
import { recalculateWorldCupChallenge } from "@/lib/world-cup"
import { notifyWorldCupLeaderboardUpdated } from "@/lib/world-cup/worldCupNotifications"
import {
  assertWorldCupAdminManager,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../_utils"

export const runtime = "nodejs"

export async function POST(request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupAdminManager(request, params.data.challengeId, auth.user)
  if (!access.ok) return access.response

  const leaderboard = await recalculateWorldCupChallenge(params.data.challengeId)
  await notifyWorldCupLeaderboardUpdated({
    challengeId: params.data.challengeId,
    sourceId: `manual:${Date.now()}`,
  })
  return NextResponse.json({ ok: true, leaderboard })
}
