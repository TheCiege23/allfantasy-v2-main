import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  extractLeagueCareerTier,
  isLeagueVisibleForCareerTier,
  resolveUserCareerTier,
} from "@/lib/ranking/tier-visibility"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string }
    } | null
    const viewerTier = await resolveUserCareerTier(prisma as any, session?.user?.id, 1)

    const { searchParams } = new URL(request.url)
    const tournamentId = searchParams?.get("tournamentId")
    const page = Math.max(1, parseInt(searchParams?.get("page") || "1", 10))
    const limit = Math.min(50, Math.max(5, parseInt(searchParams?.get("limit") || "20", 10)))
    const scoringMode = searchParams?.get("scoringMode")

    if (!tournamentId) {
      return NextResponse.json({ error: "tournamentId is required" }, { status: 400 })
    }

    const where: any = {
      tournamentId,
      isPrivate: false,
    }

    const allPublicLeagues = await (prisma as any).bracketLeague.findMany({
      where,
      include: {
        owner: { select: { displayName: true, avatarUrl: true } },
        _count: { select: { members: true, entries: true } },
        tournament: { select: { name: true, season: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    })

    let filtered = allPublicLeagues
    if (scoringMode) {
      filtered = allPublicLeagues.filter((lg: any) => {
        const rules = (lg.scoringRules || {}) as any
        const mode = rules.mode || rules.scoringMode || "fancred_edge"
        return mode === scoringMode
      })
    }

    const tierFiltered = filtered.filter((lg: any) => {
      const leagueTier = extractLeagueCareerTier(lg.scoringRules, viewerTier)
      return isLeagueVisibleForCareerTier(viewerTier, leagueTier)
    })

    const total = tierFiltered.length
    const start = (page - 1) * limit
    const paged = tierFiltered.slice(start, start + limit)

    const pools = paged.map((lg: any) => {
      const rules = (lg.scoringRules || {}) as any
      return {
        id: lg.id,
        name: lg.name,
        joinCode: lg.joinCode,
        ownerName: lg.owner?.displayName || "Anonymous",
        ownerAvatar: lg.owner?.avatarUrl || null,
        memberCount: lg._count.members,
        entryCount: lg._count.entries,
        maxManagers: lg.maxManagers,
        isPaidLeague: Boolean(rules.isPaidLeague),
        scoringMode: rules.mode || rules.scoringMode || "fancred_edge",
        tournamentName: lg.tournament?.name || "",
        season: lg.tournament?.season || 0,
        createdAt: lg.createdAt,
      }
    })

    return NextResponse.json(
      {
        ok: true,
        pools,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        viewerTier,
        hiddenByTierPolicy: Math.max(0, filtered.length - tierFiltered.length),
      },
      { headers: { "Cache-Control": "no-cache, no-store, must-revalidate" } }
    )
  } catch (err: any) {
    console.error("[bracket/public-pools] Error:", err)
    return NextResponse.json(
      { error: err.message || "Failed to fetch public pools" },
      { status: 500 }
    )
  }
}

