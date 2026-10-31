import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getServedOrigin } from "@/lib/http/served-origin"
import { discoverPublicLeagues } from "@/lib/public-discovery"
import { buildFindLeagueRails } from "@/lib/public-discovery/findLeagueRails"
import { resolveUserCareerTier } from "@/lib/ranking/tier-visibility"

export const dynamic = "force-dynamic"

/**
 * GET /api/find-league/recommendations?sport=NFL
 *
 * The "picked for you" rows on /find-league. Reads the same discovery list the search grid
 * does (DB-first, tier policy applied) and splits it into rows — see findLeagueRails.ts.
 *
 * status: "ok" (signed in), "anonymous" (rows still returned, but without rank bands there is
 * no "At your level" row), "empty" (nothing has an open seat).
 */
export async function GET(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const viewerUserId = session?.user?.id ?? null
    const viewerTier = await resolveUserCareerTier(prisma as never, viewerUserId, 1)
    const sport = req.nextUrl.searchParams.get("sport") || null

    const result = await discoverPublicLeagues(
      { sport, sort: "ranking_match", visibility: "public", page: 1, limit: 24 },
      getServedOrigin(req),
      { viewerTier, viewerUserId }
    )
    const rails = buildFindLeagueRails(result.leagues)
    const status = rails.length === 0 ? "empty" : viewerUserId ? "ok" : "anonymous"

    // Personal when signed in (rank bands are this viewer's), so never shared-cached.
    return NextResponse.json(
      { status, rails },
      {
        headers: {
          "Cache-Control": viewerUserId ? "private, max-age=30" : "public, s-maxage=60, stale-while-revalidate=120",
          Vary: "Cookie",
        },
      }
    )
  } catch (err: unknown) {
    console.error("[find-league/recommendations]", err)
    return NextResponse.json({ status: "error", rails: [] }, { status: 500 })
  }
}
