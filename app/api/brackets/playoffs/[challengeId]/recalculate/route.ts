import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { playoffChallengeParamsSchema, requireWorldCupApiUser } from "../../_utils"
import { scoreAllEntriesForChallenge } from "@/lib/playoffs/playoffScoringService"
import { notifyRankImproved } from "@/lib/playoffs/playoffNotificationService"

export const runtime = "nodejs"

/**
 * POST /api/brackets/playoffs/[challengeId]/recalculate
 *
 * Rescores all entries for the challenge, updates ranks, and fires
 * rank-improvement notifications for any participants who moved up.
 * Restricted to the challenge owner.
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
    select: { id: true, ownerUserId: true, name: true },
  })

  if (!challenge) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  const isOwner = auth.user?.id === challenge.ownerUserId
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden — owner only" }, { status: 403 })
  }

  const startMs = Date.now()

  // Snapshot ranks before scoring so we can detect movement
  const preScoreEntries = await (prisma as any).playoffBracketEntry.findMany({
    where: { challengeId },
    select: { id: true, userId: true, rank: true },
  }) as Array<{ id: string; userId: string; rank: number | null }>

  const prevRanks = new Map(
    preScoreEntries.map((e) => [e.id, { userId: e.userId, rank: e.rank }])
  )

  const leaderboard = await scoreAllEntriesForChallenge({ challengeId })
  const durationMs = Date.now() - startMs

  console.log(
    `[recalculate] challengeId=${challengeId} entries=${leaderboard.length} durationMs=${durationMs}`
  )

  // Fire rank-improvement notifications non-blocking
  notifyRankImproved({
    challengeId,
    challengeName: (challenge as any).name ?? "Playoff Pool",
    prevRanks,
    newRanks: leaderboard,
  }).catch((err) => console.warn("[RecalculateRoute] notification error", err))

  return NextResponse.json({
    ok: true,
    challengeId,
    entriesScored: leaderboard.length,
    leaderboard,
    durationMs,
  })
}
