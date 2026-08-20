import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { assertLeagueMember } from "@/lib/league-access"
import { listAwards } from "@/lib/awards-engine/AwardQueryService"
import { AWARD_TYPES } from "@/lib/awards-engine/types"

export const dynamic = "force-dynamic"

/**
 * GET /api/leagues/[leagueId]/awards?season=&awardType=&limit=
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: "Missing leagueId" }, { status: 400 })
    try {
      await assertLeagueMember(leagueId, session.user.id)
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const url = new URL(req.url)
    const season = url.searchParams?.get("season") ?? undefined
    const awardTypeRaw = url.searchParams?.get("awardType")
    const isAwardType =
      awardTypeRaw != null && (AWARD_TYPES as readonly string[]).includes(awardTypeRaw)
    const awardType =
      awardTypeRaw == null ? undefined : isAwardType ? awardTypeRaw : null
    const limitParam = url.searchParams?.get("limit")
    const limit = limitParam != null ? Math.min(parseInt(limitParam, 10) || 50, 200) : 100
    if (awardType === null) {
      return NextResponse.json({ error: "Invalid awardType" }, { status: 400 })
    }

    const awards = await listAwards({ leagueId, season, awardType, limit })
    return NextResponse.json({ leagueId, awards })
  } catch (e) {
    console.error("[awards GET]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: "Failed to load awards" },
      { status: 500 }
    )
  }
}
