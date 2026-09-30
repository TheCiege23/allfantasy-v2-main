import { NextRequest, NextResponse } from "next/server"
import { getServedOrigin } from "@/lib/http/served-origin"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  getPersonalizedRecommendations,
  getUserLeagueProfile,
  summarizeRecommendationProfile,
} from "@/lib/league-recommendations"
import { getRecommendedLeagues } from "@/lib/public-discovery"
import { prisma } from "@/lib/prisma"
import { resolveUserCareerTier } from "@/lib/ranking/tier-visibility"

export const dynamic = "force-dynamic"

function getBaseUrl(req: NextRequest): string {
  // Config-derived, never the Host / X-Forwarded-Host header: these links are
  // returned to clients and emailed, and a spoofed header would point them at
  // an attacker's host. See lib/http/served-origin.ts.
  return getServedOrigin(req)
}

/**
 * GET: Personalized league recommendations when user is logged in (favorite sports,
 * past leagues, draft participation, league types). Falls back to generic "filling fast"
 * recommendations when anonymous.
 */
export async function GET(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string; email?: string | null }
    } | null
    const userId = session?.user?.id ?? null
    const viewerTier = await resolveUserCareerTier(prisma as any, userId, 1)
    const adminAllow = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
    const viewerIsAdmin = !!session?.user?.email && adminAllow.includes(session.user.email.toLowerCase())
    const sport = req.nextUrl.searchParams?.get("sport") ?? null
    const limit = Math.min(24, Math.max(1, parseInt(req.nextUrl.searchParams?.get("limit") ?? "6", 10)))
    const aiExplain = req.nextUrl.searchParams?.get("aiExplain") === "1"
    const baseUrl = getBaseUrl(req)

    if (userId) {
      const profile = await getUserLeagueProfile(userId)
      const results = await getPersonalizedRecommendations(userId, baseUrl, {
        limit,
        sport,
        viewerTier,
        viewerIsAdmin,
        aiExplain,
        profile,
      })
      return NextResponse.json(
        {
          ok: true,
          personalized: true,
          profileSignals: summarizeRecommendationProfile(profile),
          aiExplanationEnabled: aiExplain,
          leagues: results.map((r) => ({
            league: r.league,
            explanation: r.explanation,
            reasons: r.reasons ?? [],
            matchedSignals: r.matchedSignals ?? [],
            explanationSource: r.explanationSource ?? "deterministic",
          })),
        },
        { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" } }
      )
    }

    const leagues = await getRecommendedLeagues(limit, sport || null, baseUrl, {
      viewerTier,
      viewerUserId: userId,
      viewerIsAdmin,
    })
    return NextResponse.json(
      {
        ok: true,
        personalized: false,
        aiExplanationEnabled: false,
        leagues: leagues.map((l) => ({
          league: l,
          explanation: null,
          reasons: [],
          matchedSignals: [],
          explanationSource: "deterministic",
        })),
      },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }
    )
  } catch (err: unknown) {
    console.error("[discover/recommendations]", err)
    return NextResponse.json({ error: "Failed to load recommendations" }, { status: 500 })
  }
}

