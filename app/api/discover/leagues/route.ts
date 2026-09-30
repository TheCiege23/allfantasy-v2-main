import { NextRequest, NextResponse } from "next/server"
import { getServedOrigin } from "@/lib/http/served-origin"
import { discoverPublicLeagues } from "@/lib/public-discovery"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type {
  DraftStatusFilter,
  DraftTypeFilter,
  DiscoveryFormat,
  DiscoverySort,
  EntryFeeFilter,
  LeagueStyleFilter,
  VisibilityFilter,
} from "@/lib/public-discovery/types"
import { resolveUserCareerTier } from "@/lib/ranking/tier-visibility"

export const dynamic = "force-dynamic"

function getBaseUrl(req: NextRequest): string {
  // Config-derived, never the Host / X-Forwarded-Host header: these links are
  // returned to clients and emailed, and a spoofed header would point them at
  // an attacker's host. See lib/http/served-origin.ts.
  return getServedOrigin(req)
}

function parseIntParam(sp: URLSearchParams, key: string): number | undefined {
  const v = sp?.get(key)
  if (v == null || v === "") return undefined
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? undefined : n
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
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
    const viewerIsAdmin = !!session?.user?.email && adminAllow.includes(session.user.email.toLowerCase())

    const sp = req.nextUrl.searchParams
    const query = sp?.get("q") ?? sp?.get("query") ?? null
    const sport = sp?.get("sport") ?? null
    const format = (sp?.get("format") as DiscoveryFormat) ?? "all"
    const style = (sp?.get("style") as LeagueStyleFilter) ?? "all"
    const sort = (sp?.get("sort") as DiscoverySort) ?? "popularity"
    const entryFee = (sp?.get("entryFee") as EntryFeeFilter) ?? "all"
    const visibility = (sp?.get("visibility") as VisibilityFilter) ?? "public"
    const draftType = (sp?.get("draftType") as DraftTypeFilter) ?? "all"
    const draftStatus = (sp?.get("draftStatus") as DraftStatusFilter) ?? "all"
    const teamCountMin = parseIntParam(sp, "teamCountMin")
    const teamCountMax = parseIntParam(sp, "teamCountMax")
    const aiEnabled = sp?.get("aiEnabled") === "true"
    const page = Math.max(1, parseInt(sp?.get("page") ?? "1", 10))
    const limit = Math.min(24, Math.max(6, parseInt(sp?.get("limit") ?? "12", 10)))

    const result = await discoverPublicLeagues(
      {
        query,
        sport,
        format,
        style,
        sort,
        entryFee,
        visibility,
        draftType,
        draftStatus,
        teamCountMin: teamCountMin ?? null,
        teamCountMax: teamCountMax ?? null,
        aiEnabled: aiEnabled || null,
        page,
        limit,
      },
      getBaseUrl(req),
      {
        viewerTier,
        viewerUserId,
        viewerIsAdmin,
      }
    )
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (err: unknown) {
    console.error("[discover/leagues]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Discovery failed" },
      { status: 500 }
    )
  }
}

