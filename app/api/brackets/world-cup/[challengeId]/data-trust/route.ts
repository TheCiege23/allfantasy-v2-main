import { NextResponse } from "next/server"
import { getWorldCupDataTrustReport } from "@/lib/world-cup/worldCupDataTrustService"
import {
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../_utils"

export const runtime = "nodejs"

export async function GET(request: Request, props: { params: Promise<unknown> }) {
  const rawParams = await props.params
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse(rawParams)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge ID" }, { status: 400 })
  }

  const report = await getWorldCupDataTrustReport(params.data.challengeId)
  return NextResponse.json({ report })
}
