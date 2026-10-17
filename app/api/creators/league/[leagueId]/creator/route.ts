import { NextRequest, NextResponse } from "next/server"
import { getServedOrigin } from "@/lib/http/served-origin"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { discoverPublicLeagues } from "@/lib/public-discovery"
import { getCreators } from "@/lib/creator-system"
import { prisma } from "@/lib/prisma"
import { resolveUserCareerTier } from "@/lib/ranking/tier-visibility"
import type { DiscoverySort } from "@/lib/public-discovery/types"

export const dynamic = "force-dynamic"

function getBaseUrl(req: NextRequest): string {
  // Config-derived, never the Host / X-Forwarded-Host header: these links are
  // returned to clients and emailed, and a spoofed header would point them at
  // an attacker's host. See lib/http/served-origin.ts.
  return getServedOrigin(req)
}

function normalizeSort(value: string | null): DiscoverySort {
  if (value === "newest" || value === "filling_fast" || value === "ranking_match") return value
  return "popularity"
}

export async function GET(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string; email?: string | null }
    } | null
    const viewerUserId = session?.user?.id ?? null
    const viewerTier = await resolveUserCareerTier(prisma as any, viewerUserId, 1)
    const adminAllow = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
    const viewerIsAdmin = !!session?.user?.email && adminAllow.includes(session.user.email.toLowerCase())

    const sp = req.nextUrl.searchParams
    const page = Math.max(1, Number.parseInt(sp?.get("page") ?? "1", 10) || 1)
    const limit = Math.min(24, Math.max(6, Number.parseInt(sp?.get("limit") ?? "12", 10) || 12))
    const query = sp?.get("q")?.trim() || null
    const sport = sp?.get("sport")?.trim() || null
    const sort = normalizeSort(sp?.get("sort"))
    const creatorLimit = Math.min(12, Math.max(3, Number.parseInt(sp?.get("creatorLimit") ?? "6", 10) || 6))
    const baseUrl = getBaseUrl(req)

    const [discoveryResult, creatorsResult] = await Promise.all([
      discoverPublicLeagues(
        {
          query,
          sport,
          format: "creator",
          sort,
          visibility: "public",
          page,
          limit,
        },
        baseUrl,
        {
          viewerTier,
          viewerUserId,
          viewerIsAdmin,
        }
      ),
      getCreators({
        visibility: "public",
        sport: sport ?? undefined,
        limit: creatorLimit,
        baseUrl,
        viewerTier,
      }),
    ])

    return NextResponse.json(
      {
        ok: true,
        leagues: discoveryResult.leagues,
        total: discoveryResult.total,
        page: discoveryResult.page,
        limit: discoveryResult.limit,
        totalPages: discoveryResult.totalPages,
        hasMore: discoveryResult.hasMore,
        viewerTier: discoveryResult.viewerTier,
        viewerTierName: discoveryResult.viewerTierName,
        featuredCreators: creatorsResult.creators,
      },
      {
        headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
      }
    )
  } catch (error) {
    console.error("[api/creator-leagues]", error)
    return NextResponse.json({ error: "Failed to load creator leagues." }, { status: 500 })
  }
}


