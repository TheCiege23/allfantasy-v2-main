import { NextResponse } from "next/server"
import { z } from "zod"
import { createPlayoffBracketEntry, getPlayoffBracketView } from "@/lib/playoffs/playoffService"
import { playoffChallengeParamsSchema, requireWorldCupApiUser } from "../_utils"

export const runtime = "nodejs"

const createEntrySchema = z.object({
  action: z.literal("create_entry"),
  name: z.string().trim().min(1).max(80).optional(),
})

export async function GET(request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = playoffChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  const view = await getPlayoffBracketView({
    challengeId: params.data.challengeId,
    user: auth.user,
  })

  if (!view) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  return NextResponse.json({ ok: true, view })
}

export async function POST(request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = playoffChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = createEntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await createPlayoffBracketEntry({
      challengeId: params.data.challengeId,
      user: auth.user,
      name: parsed.data.name,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create playoff entry",
      },
      { status: 400 }
    )
  }
}
