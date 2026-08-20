import { NextResponse } from "next/server"
import { z } from "zod"
import { createPlayoffBracketChallenge, listUserPlayoffChallenges } from "@/lib/playoffs/playoffService"
import { requireWorldCupApiUser } from "./_utils"

export const runtime = "nodejs"

const createPlayoffChallengeSchema = z.object({
  // name is optional — defaults to "NBA Playoff Pool" / "NHL Playoff Pool" in the service
  name: z.string().trim().min(2).max(80).optional(),
  sport: z.enum(["nba", "nhl"]),
  seasonYear: z.coerce.number().int().min(2024).max(2100).optional(),
  isTestMode: z.boolean().optional(),
})

/**
 * GET /api/brackets/playoffs?sport=nba|nhl
 *
 * Returns challenges the authenticated user owns or participates in,
 * optionally filtered by sport. Used by home/discover to resolve card hrefs.
 */
export async function GET(request: Request) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const sportFilter = url.searchParams.get("sport")?.toLowerCase() ?? null

  try {
    const allChallenges = await listUserPlayoffChallenges(auth.user.id)
    const challenges = sportFilter
      ? allChallenges.filter((c) => c.sport === sportFilter)
      : allChallenges
    return NextResponse.json({ ok: true, challenges })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list challenges" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => ({}))
  const parsed = createPlayoffChallengeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await createPlayoffBracketChallenge({
      user: auth.user,
      name: parsed.data.name,
      sport: parsed.data.sport,
      seasonYear: parsed.data.seasonYear,
      isTestMode: parsed.data.isTestMode,
    })

    return NextResponse.json({
      ok: true,
      challengeId: result.challengeId,
      entryId: result.entryId,
      redirectUrl: result.redirectUrl,
      sport: result.sport,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create playoff challenge",
      },
      { status: 500 }
    )
  }
}
