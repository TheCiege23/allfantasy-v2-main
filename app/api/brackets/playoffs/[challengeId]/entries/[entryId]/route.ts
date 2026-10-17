import { NextResponse } from "next/server"
import { z } from "zod"
import { submitPlayoffBracketEntry } from "@/lib/playoffs/playoffService"
import { playoffEntryParamsSchema, requireWorldCupApiUser } from "../../../_utils"

export const runtime = "nodejs"

const submitEntrySchema = z.object({
  action: z.literal("submit_entry"),
})

export async function POST(request: Request, context: { params: Promise<{ challengeId: string; entryId: string }> }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = playoffEntryParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = submitEntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await submitPlayoffBracketEntry({
      challengeId: params.data.challengeId,
      entryId: params.data.entryId,
      userId: auth.user.id,
      user: auth.user,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to submit bracket entry",
      },
      { status: 400 }
    )
  }
}