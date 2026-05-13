import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { playoffChallengeParamsSchema, requireWorldCupApiUser } from "../../_utils"
import { scoreAllEntriesForChallenge } from "@/lib/playoffs/playoffScoringService"

export const runtime = "nodejs"

/**
 * POST /api/brackets/playoffs/[challengeId]/recalculate
 *
 * Rescores all entries for the challenge and updates ranks.
 * Restricted to the challenge owner or an admin user.
 */
export async function POST(request: Request, context: { params: { challengeId: string } }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = playoffChallengeParamsSchema.safeParse(context.params)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  const { challengeId } = params.data

  const challenge = await (prisma as any).playoffBracketChallenge.findUnique({
    where: { id: challengeId },
    select: { id: true, ownerUserId: true },
  })

  if (!challenge) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  const isOwner = auth.user?.id === challenge.ownerUserId
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden — owner only" }, { status: 403 })
  }

  const startMs = Date.now()
  const leaderboard = await scoreAllEntriesForChallenge({ challengeId })

  return NextResponse.json({
    ok: true,
    challengeId,
    entriesScored: leaderboard.length,
    leaderboard,
    durationMs: Date.now() - startMs,
  })
}
