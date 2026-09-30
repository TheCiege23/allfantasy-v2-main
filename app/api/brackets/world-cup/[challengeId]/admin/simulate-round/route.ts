import { NextResponse } from "next/server"
import { z } from "zod"
import { simulateWorldCupRound } from "@/lib/world-cup/worldCupSimulationService"
import {
  assertWorldCupSimulationAccess,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../../_utils"

export const runtime = "nodejs"

const bodySchema = z.object({
  round: z.enum(["round_of_32", "round_of_16", "quarterfinal", "semifinal", "third_place", "final"]),
  strategy: z.enum(["random", "higher_seed", "home", "away"]),
  dryRun: z.boolean().optional().default(false),
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

  console.info("[world-cup/simulate-round] request", {
    challengeId: params.data.challengeId,
    userId: auth.user.id,
    round: parsed.data.round,
    strategy: parsed.data.strategy,
    dryRun: parsed.data.dryRun,
  })

  try {
    const result = await simulateWorldCupRound({
      challengeId: params.data.challengeId,
      round: parsed.data.round,
      strategy: parsed.data.strategy,
      dryRun: parsed.data.dryRun,
    })

    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Simulation failed"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
