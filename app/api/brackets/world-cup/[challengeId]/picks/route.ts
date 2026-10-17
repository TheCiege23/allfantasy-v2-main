import { NextResponse } from "next/server"
import { z } from "zod"
import { getWorldCupChallengeView, saveWorldCupPicks } from "@/lib/world-cup"
import { requireWorldCupApiUser, worldCupChallengeParamsSchema } from "../../_utils"

export const runtime = "nodejs"

const saveWorldCupPicksSchema = z.object({
  picks: z
    .array(
      z.object({
        matchId: z.string().min(1),
        selectedTeamId: z.string().nullable().optional(),
        selectedSlotKey: z.string().nullable().optional(),
      })
    )
    .min(1)
    .max(64),
})

export async function GET(_request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const view = await getWorldCupChallengeView({
    challengeId: params.data.challengeId,
    user: auth.user,
  })
  if (!view) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  return NextResponse.json({ picks: view.picks, participant: view.participant })
}

export async function POST(request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = saveWorldCupPicksSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const view = await saveWorldCupPicks({
      challengeId: params.data.challengeId,
      userId: auth.user.id,
      picks: parsed.data.picks,
    })

    return NextResponse.json({ ok: true, view })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save picks"
    const status = message.toLowerCase().includes("locked") ? 409 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
