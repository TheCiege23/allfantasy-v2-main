import { getServerSession } from "next-auth"
import { NextResponse } from "next/server"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { readAttributionFromCookieHeader } from "@/lib/analytics/attributionCookies"
import { recordAppOpen, resolveAppPlatform } from "@/lib/analytics/appOpen"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/analytics/app-open — one "app opened" ping a day from each device
 * (components/analytics/AppOpenPing.tsx). Feeds the people counts on /admin/apps.
 *
 * Always answers 200 `{ ok: true }`: a dropped or failed ping is analytics, never an
 * error the visitor sees. The user id comes from the server session only.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { platform?: unknown; iosIapBuild?: unknown; path?: unknown } | null
    const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null
    const platform = resolveAppPlatform(body?.platform, userAgent)
    if (!platform) return NextResponse.json({ ok: true, dropped: true })

    const session = (await getServerSession(authOptions as never).catch(() => null)) as { user?: { id?: string } } | null
    const { anonId } = readAttributionFromCookieHeader(req.headers.get("cookie"))
    const outcome = await recordAppOpen(prisma, {
      platform,
      sessionId: anonId ? anonId.slice(0, 128) : null,
      userId: session?.user?.id ? String(session.user.id).slice(0, 128) : null,
      iapBuild: typeof body?.iosIapBuild === "boolean" ? body.iosIapBuild : undefined,
      path: typeof body?.path === "string" ? body.path.slice(0, 500) : null,
      userAgent,
    })
    return NextResponse.json({ ok: true, outcome })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
