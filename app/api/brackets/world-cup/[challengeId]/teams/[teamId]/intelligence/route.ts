import { NextResponse } from "next/server"
import { getWorldCupTeamIntelligence } from "@/lib/world-cup/worldCupTeamIntelligenceService"
import {
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../../../_utils"
import { z } from "zod"

export const runtime = "nodejs"

const paramsSchema = worldCupChallengeParamsSchema.extend({
  teamId: z.string().min(1),
})

export async function GET(request: Request, props: { params: Promise<unknown> }) {
  const rawParams = await props.params
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = paramsSchema.safeParse(rawParams)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge or team ID" }, { status: 400 })
  }

  const report = await getWorldCupTeamIntelligence(params.data.teamId)
  if (!report) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 })
  }

  return NextResponse.json({ report })
}
