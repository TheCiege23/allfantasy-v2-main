import { NextRequest, NextResponse } from "next/server"
import { getServedOrigin } from "@/lib/http/served-origin"
import { getTrendingLeagues } from "@/lib/public-discovery"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { resolveUserCareerTier } from "@/lib/ranking/tier-visibility"

export const dynamic = "force-dynamic"

function getBaseUrl(req: NextRequest): string {
  // Config-derived, never the Host / X-Forwarded-Host header: these links are
  // returned to clients and emailed, and a spoofed header would point them at
  // an attacker's host. See lib/http/served-origin.ts.
  return getServedOrigin(req)
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

    const sport = req.nextUrl.searchParams?.get("sport") ?? null
    const limit = Math.min(12, Math.max(1, parseInt(req.nextUrl.searchParams?.get("limit") ?? "6", 10)))
    const leagues = await getTrendingLeagues(limit, sport, getBaseUrl(req), {
      viewerTier,
      viewerUserId,
      viewerIsAdmin,
    })
    return NextResponse.json({ ok: true, leagues }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (err: unknown) {
    console.error("[discover/trending]", err)
    return NextResponse.json({ error: "Failed to load trending" }, { status: 500 })
  }
}

