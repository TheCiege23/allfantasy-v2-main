import { NextResponse } from "next/server"
import { getWorldCupGroupStageView } from "@/lib/world-cup/worldCupGroupStageService"
import { requireWorldCupApiUser, worldCupEntryParamsSchema } from "../../../../_utils"

export const runtime = "nodejs"

export async function GET(request: Request, context: { params: Promise<{ challengeId: string; entryId: string }> }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = worldCupEntryParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  try {
    const view = await getWorldCupGroupStageView({
      challengeId: params.data.challengeId,
      entryId: params.data.entryId,
      userId: auth.user.id,
    })
    return NextResponse.json({ ok: true, view })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load group stage"
    const status = message === "Entry not found" ? 404 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
