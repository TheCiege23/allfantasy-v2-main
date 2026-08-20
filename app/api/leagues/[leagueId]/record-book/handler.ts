import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { assertLeagueMember } from "@/lib/league-access"
import { getRecordLeaderboard } from "@/lib/record-book-engine/RecordLeaderboardService"
import { RECORD_TYPES } from "@/lib/record-book-engine/types"
import { isSupportedSport, normalizeToSupportedSport } from "@/lib/sport-scope"

export const dynamic = "force-dynamic"

/**
 * GET /api/leagues/[leagueId]/record-book?recordType=&season=&sport=&limit=
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
    let access: { leagueSport: string }
    try {
      access = await assertLeagueMember(leagueId, session.user.id)
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const url = new URL(req.url)
    const recordTypeRaw = url.searchParams?.get("recordType")
    const isRecordType =
      recordTypeRaw != null && (RECORD_TYPES as readonly string[]).includes(recordTypeRaw)
    const recordType = recordTypeRaw == null ? undefined : isRecordType ? recordTypeRaw : null
    const season = url.searchParams?.get("season") ?? undefined
    const sportRaw = url.searchParams?.get("sport")
    const sport =
      sportRaw == null
        ? undefined
        : isSupportedSport(sportRaw)
          ? normalizeToSupportedSport(sportRaw)
          : null
    const limitParam = url.searchParams?.get("limit")
    const limit = limitParam != null ? Math.min(parseInt(limitParam, 10) || 50, 200) : 50
    if (recordType === null) {
      return NextResponse.json({ error: "Invalid recordType" }, { status: 400 })
    }
    if (sport === null) {
      return NextResponse.json({ error: "Invalid sport" }, { status: 400 })
    }
    if (sport && sport !== access.leagueSport) {
      return NextResponse.json({ error: "Sport must match league sport" }, { status: 400 })
    }

    const leaderboard = await getRecordLeaderboard({
      leagueId,
      recordType,
      season,
      sport: sport ?? access.leagueSport,
      limit,
    })
    return NextResponse.json({ leagueId, records: leaderboard })
  } catch (e) {
    console.error("[record-book GET]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: "Failed to load record book" },
      { status: 500 }
    )
  }
}
