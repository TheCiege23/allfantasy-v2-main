import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireWorldCupApiUser } from "../../../../_utils"
import { scoreAllEntriesForChallenge } from "@/lib/playoffs/playoffScoringService"

export const runtime = "nodejs"

const resolveBodySchema = z.object({
  winnerTeamName: z.string().trim().min(1).max(120),
  /** Optionally override status — defaults to "final" */
  status: z.enum(["final", "in_progress"]).optional(),
})

const paramsSchema = z.object({
  challengeId: z.string().min(1),
  seriesId: z.string().min(1),
})

/**
 * POST /api/brackets/playoffs/[challengeId]/series/[seriesId]/resolve
 *
 * Marks a series as final with a winner and triggers a full challenge rescore.
 *
 * - In test-mode challenges: any authenticated member can resolve.
 * - In normal challenges: owner only.
 */
export async function POST(
  request: Request,
  context: { params: { challengeId: string; seriesId: string } }
) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = paramsSchema.safeParse(context.params)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = resolveBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  const { challengeId, seriesId } = params.data
  const { winnerTeamName, status = "final" } = parsed.data

  const challenge = await (prisma as any).playoffBracketChallenge.findUnique({
    where: { id: challengeId },
    select: { id: true, ownerUserId: true, isTestMode: true },
  })

  if (!challenge) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  const isOwner = auth.user?.id === challenge.ownerUserId
  if (!isOwner && !challenge.isTestMode) {
    return NextResponse.json({ error: "Forbidden — owner or test-mode only" }, { status: 403 })
  }

  const series = await (prisma as any).playoffBracketSeries.findUnique({
    where: { id: seriesId },
    select: {
      id: true,
      challengeId: true,
      homeTeamName: true,
      awayTeamName: true,
      winnerTeamName: true,
    },
  })

  if (!series || series.challengeId !== challengeId) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 })
  }

  const validTeams = [series.homeTeamName, series.awayTeamName]
  if (!validTeams.includes(winnerTeamName)) {
    return NextResponse.json(
      {
        error: `Winner must be one of: ${validTeams.join(", ")}`,
      },
      { status: 400 }
    )
  }

  await (prisma as any).playoffBracketSeries.update({
    where: { id: seriesId },
    data: { winnerTeamName, status },
  })

  // Rescore all entries after series resolution
  const leaderboard = await scoreAllEntriesForChallenge({ challengeId })

  return NextResponse.json({
    ok: true,
    challengeId,
    seriesId,
    winnerTeamName,
    status,
    leaderboard,
  })
}
