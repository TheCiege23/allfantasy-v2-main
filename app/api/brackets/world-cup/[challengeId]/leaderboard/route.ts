import { NextResponse } from "next/server"
import { getWorldCupChallengeView } from "@/lib/world-cup"
import {
  getWorldCupAdminState,
  getWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../_utils"

export const runtime = "nodejs"

export async function GET(request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const user = await getWorldCupApiUser()
  const isAdmin = await getWorldCupAdminState(request, user)
  const view = await getWorldCupChallengeView({
    challengeId: params.data.challengeId,
    user,
    isAdmin,
  })

  if (!view) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  return NextResponse.json({
    leaderboard: view.leaderboard,
    lastSyncedAt: view.challenge.lastSyncedAt,
    scoring: view.scoring,
  })
}
