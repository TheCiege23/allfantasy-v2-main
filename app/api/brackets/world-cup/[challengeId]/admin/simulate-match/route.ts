import { NextResponse } from "next/server"
import { z } from "zod"
import { simulateWorldCupMatchResult } from "@/lib/world-cup/worldCupSimulationService"
import {
  assertWorldCupSimulationAccess,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../../_utils"

export const runtime = "nodejs"

const bodySchema = z.object({
  matchId: z.string().min(1),
  winnerTeamId: z.string().min(1).nullable().optional(),
  homeScore: z.number().int().min(0).max(20).nullable().optional(),
  awayScore: z.number().int().min(0).max(20).nullable().optional(),
  elapsedMinute: z.number().int().min(0).max(180).nullable().optional(),
  dryRun: z.boolean().optional().default(false),
  status: z.enum(["scheduled", "live", "final"]).optional().default("final"),
  confirmSimulation: z.literal(true),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ challengeId: string }> }
) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const access = await assertWorldCupSimulationAccess({
    request,
    challengeId: params.data.challengeId,
    user: auth.user,
    confirmSimulation: parsed.data.confirmSimulation,
  })
  if (!access.ok) return access.response

  console.info("[world-cup/simulate-match] request", {
    challengeId: params.data.challengeId,
    userId: auth.user.id,
    matchId: parsed.data.matchId,
    dryRun: parsed.data.dryRun,
    status: parsed.data.status,
  })

  try {
    const result = await simulateWorldCupMatchResult({
      challengeId: params.data.challengeId,
      matchId: parsed.data.matchId,
      winnerTeamId: parsed.data.winnerTeamId,
      homeScore: parsed.data.homeScore,
      awayScore: parsed.data.awayScore,
      elapsedMinute: parsed.data.elapsedMinute,
      dryRun: parsed.data.dryRun,
      status: parsed.data.status,
    })

    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Simulation failed"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
