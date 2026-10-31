import { NextRequest, NextResponse } from "next/server"
import { getServedOrigin } from "@/lib/http/served-origin"
import { discoverPublicLeagues } from "@/lib/public-discovery"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type {
  DraftStatusFilter,
  DraftTypeFilter,
  DraftWhenFilter,
  DiscoveryFormat,
  DiscoverySort,
  EntryFeeFilter,
  LeagueStyleFilter,
  RankBandFilter,
  TimeZoneRegionFilter,
  VisibilityFilter,
} from "@/lib/public-discovery/types"
import { resolveUserCareerTier } from "@/lib/ranking/tier-visibility"
import { publicReputationForLeagues } from "@/lib/commish-reputation/reputationService"
import { paidLeagueGeoMessage, paidLeagueGeoVerdict } from "@/lib/geo/paidLeagueGeo"
import type { LeagueVibeFilter } from "@/lib/public-discovery/vibes"

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
    const requestedEntryFee = (sp?.get("entryFee") as EntryFeeFilter) ?? "all"
    const visibility = (sp?.get("visibility") as VisibilityFilter) ?? "public"
    const draftType = (sp?.get("draftType") as DraftTypeFilter) ?? "all"
    const draftStatus = (sp?.get("draftStatus") as DraftStatusFilter) ?? "all"
    const teamCountMin = parseIntParam(sp, "teamCountMin")
    const teamCountMax = parseIntParam(sp, "teamCountMax")
    const aiEnabled = sp?.get("aiEnabled") === "true"
    // Unknown values fall back to "any"/"all" inside discoverPublicLeagues.
    const draftWhen = (sp?.get("draftWhen") as DraftWhenFilter) ?? "any"
    const tzRegion = (sp?.get("tzRegion") as TimeZoneRegionFilter) ?? "any"
    const rankBand = (sp?.get("rankBand") as RankBandFilter) ?? "all"
    const vibe = (sp?.get("vibe") as LeagueVibeFilter) ?? "all"
    const viewerTimeZone = sp?.get("viewerTz")?.slice(0, 64) ?? null
    const page = Math.max(1, parseInt(sp?.get("page") ?? "1", 10))
    const limit = Math.min(24, Math.max(6, parseInt(sp?.get("limit") ?? "12", 10)))

    // Paid leagues are restricted in some states (lib/geo/restrictedStates). There, Find a League
    // shows free leagues only and says why; the join route refuses a paid join as well.
    const paidGeo = await paidLeagueGeoVerdict(req, viewerUserId)
    const paidLeaguesHidden = paidGeo.blocked ? { message: paidLeagueGeoMessage(paidGeo) } : null
    if (paidGeo.blocked && requestedEntryFee === "paid") {
      return NextResponse.json(
        { leagues: [], total: 0, page: 1, limit, totalPages: 0, hasMore: false, paidLeaguesHidden },
        { headers: { "Cache-Control": "private, no-store" } }
      )
    }
    const entryFee: EntryFeeFilter = paidGeo.blocked ? "free" : requestedEntryFee

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
        draftWhen,
        tzRegion,
        rankBand,
        vibe,
        viewerTimeZone,
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
    // Commish reputation badge, for commissioners who made it public on that league. A failed read
    // drops the badge, never the listing.
    const fantasyIds = result.leagues.filter((l) => l.source === "fantasy").map((l) => l.id)
    const reputations = await publicReputationForLeagues(fantasyIds).catch(() => new Map())
    if (reputations.size > 0) {
      result.leagues = result.leagues.map((l) =>
        l.source === "fantasy" && reputations.has(l.id) ? { ...l, commissionerReputation: reputations.get(l.id) } : l
      )
    }
    // ⚠ EVERY response is personal now. Signed in, rank bands, tier gating and the invite-only
    // flags are computed for this viewer; signed out, whether paid leagues appear depends on the
    // viewer's state. A shared cache keyed on the URL would hand one state's answer to another,
    // so nothing here may be cached publicly.
    return NextResponse.json(
      { ...result, paidLeaguesHidden },
      {
        headers: {
          "Cache-Control": "private, max-age=30",
          Vary: "Cookie",
        },
      }
    )
  } catch (err: unknown) {
    console.error("[discover/leagues]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Discovery failed" },
      { status: 500 }
    )
  }
}

