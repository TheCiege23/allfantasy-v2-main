import { NextResponse } from "next/server"
import { getPlayoffBracketView } from "@/lib/playoffs/playoffService"
import { nbaCupPublicLive } from "@/lib/playoffs/nbaCupPublicLive"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Public game results and numeric standings only, projected explicitly from an anonymous read. */
export async function GET(_request: Request, context: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await context.params
  if (!challengeId || challengeId.length > 150) return NextResponse.json({ error: "Invalid pool" }, { status: 400 })
  const view = await getPlayoffBracketView({ challengeId, user: null })
  if (!view || view.challenge.sport !== "nba_cup" || view.challenge.isTestMode) return NextResponse.json({ error: "Cup pool not found" }, { status: 404 })
  return NextResponse.json(nbaCupPublicLive(view), { headers: { "Cache-Control": "no-store" } })
}
