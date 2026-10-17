import { NextResponse } from "next/server"
import { z } from "zod"
import { WORLD_CUP_BRACKET_LOCKED_MESSAGE } from "@/lib/world-cup/worldCupBracketService"
import { saveWorldCupThirdPlaceAdvancers } from "@/lib/world-cup/worldCupGroupStageService"
import { requireWorldCupApiUser, worldCupEntryParamsSchema } from "../../../../_utils"

export const runtime = "nodejs"

const bodySchema = z
  .object({
    selectedTeamIds: z.array(z.string().min(1)).optional(),
    selectedGroupIds: z.array(z.string().min(1)).optional(),
  })
  .refine((body) => Boolean(body.selectedTeamIds?.length || body.selectedGroupIds?.length), {
    message: "Select third-place teams or groups.",
    path: ["selectedTeamIds"],
  })

export async function POST(request: Request, context: { params: Promise<{ challengeId: string; entryId: string }> }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = worldCupEntryParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const view = await saveWorldCupThirdPlaceAdvancers({
      challengeId: params.data.challengeId,
      entryId: params.data.entryId,
      selectedTeamIds: parsed.data.selectedTeamIds,
      selectedGroupIds: parsed.data.selectedGroupIds,
      userId: auth.user.id,
    })
    return NextResponse.json({ ok: true, view })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save third-place advancers"
    if (message === WORLD_CUP_BRACKET_LOCKED_MESSAGE || message.toLowerCase().includes("locked")) {
      return NextResponse.json({ error: WORLD_CUP_BRACKET_LOCKED_MESSAGE }, { status: 423 })
    }
    const status = message === "Entry not found" ? 404 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
