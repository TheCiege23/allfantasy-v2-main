import { NextResponse } from "next/server"
import { searchWorldCupPlayers } from "@/lib/world-cup/worldCupRosterService"
import {
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../../_utils"
import { z } from "zod"

export const runtime = "nodejs"

const paramsSchema = worldCupChallengeParamsSchema
const querySchema = z.object({ q: z.string().min(2).max(100) })

export async function GET(request: Request, props: { params: Promise<unknown> }) {
  const rawParams = await props.params
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = paramsSchema.safeParse(rawParams)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge ID" }, { status: 400 })
  }

  const url = new URL(request.url)
  const query = querySchema.safeParse({ q: url.searchParams.get("q") ?? "" })
  if (!query.success) {
    return NextResponse.json({ error: "Query parameter 'q' must be at least 2 characters" }, { status: 400 })
  }

  const players = await searchWorldCupPlayers(query.data.q)
  return NextResponse.json({ players })
}
