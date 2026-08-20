import { NextResponse } from "next/server"
import { z } from "zod"
import { getPlayoffBracketView, savePlayoffBracketPick } from "@/lib/playoffs/playoffService"
import { playoffEntryParamsSchema, requireWorldCupApiUser } from "../../../../_utils"

export const runtime = "nodejs"

const savePickSchema = z.object({
  seriesId: z.string().min(1),
  pickTeamName: z.string().trim().min(1).max(120),
})

export async function POST(request: Request, context: { params: { challengeId: string; entryId: string } }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = playoffEntryParamsSchema.safeParse(context.params)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = savePickSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    await savePlayoffBracketPick({
      challengeId: params.data.challengeId,
      entryId: params.data.entryId,
      userId: auth.user.id,
      seriesId: parsed.data.seriesId,
      pickTeamName: parsed.data.pickTeamName,
    })

    const view = await getPlayoffBracketView({
      challengeId: params.data.challengeId,
      user: auth.user,
      requestedEntryId: params.data.entryId,
    })

    return NextResponse.json({
      ok: true,
      view,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save pick",
      },
      { status: 400 }
    )
  }
}
