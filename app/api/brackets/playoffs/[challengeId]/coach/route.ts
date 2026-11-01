import { NextResponse } from "next/server"
import { requireWorldCupApiUser } from "../../_utils"
import { loadBracketCoach, CoachAccessError } from "@/lib/playoffs/bracketCoachService"
import { validCoachTimeZone } from "@/lib/playoffs/bracketCoach"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response
  const { challengeId } = await context.params
  const query = new URL(request.url).searchParams
  try {
    const coach = await loadBracketCoach({ challengeId, entryId: query.get("entryId"), rivalId: query.get("rivalId"), timeZone: validCoachTimeZone(query.get("timeZone")), user: auth.user })
    return NextResponse.json(coach, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof CoachAccessError ? error.message : "Bracket coach is temporarily unavailable" },
      { status: error instanceof CoachAccessError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } })
  }
}
